import { type Categorization, categorizeWithLlm, categorizeWithoutLlm, LLM_FAILURE } from './categorize';
import { createGoogleTokenProvider } from './google-auth';
import { findCorrections, isoDateToSerial, parseLedgerRows, planSync, toLedgerValues, TRANSACTIONS_SHEET } from './ledger';
import { parseRules } from './rules';
import { ensureSheetSetup, RULES_SHEET } from './sheet-setup';
import { createSheetsClient } from './sheets';
import { accountLabel, createTellerClient, type NormalizedTransaction, normalizeTransaction, type TellerAccount } from './teller';

export type Env = {
  ADMIN_KEY: string;
  ANTHROPIC_API_KEY: string;
  CREDIT_SPEND_SIGN: string;
  DEPOSITORY_SPEND_SIGN: string;
  ENROLLMENTS: KVNamespace;
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
  SPREADSHEET_ID: string;
  TELLER_APPLICATION_ID: string;
  TELLER_CERT: Fetcher;
  TELLER_ENVIRONMENT: string;
};

export type Enrollment = { accessToken: string; enrollmentId: string; institution: string };

const ENROLLMENT_PREFIX = 'enrollment:';

export const saveEnrollment = ({ enrollment, env }: { enrollment: Enrollment; env: Env }) =>
  env.ENROLLMENTS.put(`${ENROLLMENT_PREFIX}${enrollment.enrollmentId}`, JSON.stringify(enrollment));

const listEnrollments = async (env: Env) => {
  const { keys } = await env.ENROLLMENTS.list({ prefix: ENROLLMENT_PREFIX });
  const values = await Promise.all(keys.map((key) => env.ENROLLMENTS.get<Enrollment>(key.name, 'json')));
  return values.filter((value): value is Enrollment => value !== null);
};

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

const spendSign = ({ account, env }: { account: TellerAccount; env: Env }) =>
  Number(account.type === 'credit' ? env.CREDIT_SPEND_SIGN : env.DEPOSITORY_SPEND_SIGN);

export const fetchTransactions = async ({ env, startDate }: { env: Env; startDate: string }) => {
  const transactions: NormalizedTransaction[] = [];
  const syncedAccounts = new Set<string>();
  const errors: string[] = [];

  for (const enrollment of await listEnrollments(env)) {
    try {
      const teller = createTellerClient({
        accessToken: enrollment.accessToken,
        fetcher: (input, init) => env.TELLER_CERT.fetch(input, init),
      });
      const accounts = (await teller.listAccounts()).filter((account) => account.status === 'open');
      const perAccount = await Promise.all(
        accounts.map(async (account) => {
          const raw = await teller.listTransactions({ accountId: account.id, startDate });
          return { account, raw };
        }),
      );
      for (const { account, raw } of perAccount) {
        syncedAccounts.add(accountLabel(account));
        transactions.push(...raw.map((transaction) => normalizeTransaction({ account, spendSign: spendSign({ account, env }), transaction })));
      }
    } catch (error) {
      const message = `Teller sync failed for ${enrollment.institution} (${enrollment.enrollmentId}): ${String(error)}`;
      console.error(message);
      errors.push(message);
    }
  }

  return { errors, syncedAccounts, transactions };
};

const categorizeAll = async ({
  apiKey,
  rules,
  transactions,
}: {
  apiKey: string;
  rules: ReturnType<typeof parseRules>;
  transactions: NormalizedTransaction[];
}) => {
  const results = new Map<string, Categorization>();
  const forLlm: NormalizedTransaction[] = [];
  for (const transaction of transactions) {
    const categorization = categorizeWithoutLlm({ rules, transaction });
    if (categorization) {
      results.set(transaction.id, categorization);
    } else {
      forLlm.push(transaction);
    }
  }
  if (forLlm.length > 0) {
    const llmResults = await categorizeWithLlm({ apiKey, transactions: forLlm });
    for (const transaction of forLlm) {
      results.set(transaction.id, llmResults.get(transaction.id) ?? LLM_FAILURE);
    }
  }
  return results;
};

export const runSync = async ({ days, env }: { days: number; env: Env }) => {
  const sheets = createSheetsClient({
    getAccessToken: createGoogleTokenProvider(env.GOOGLE_SERVICE_ACCOUNT_JSON),
    spreadsheetId: env.SPREADSHEET_ID,
  });
  await ensureSheetSetup(sheets);

  const [ledgerValues, ruleValues] = await Promise.all([
    sheets.getValues(`${TRANSACTIONS_SHEET}!A2:K`),
    sheets.getValues(`${RULES_SHEET}!A2:B`),
  ]);
  const ledger = parseLedgerRows(ledgerValues);
  const existingRules = parseRules(ruleValues);

  const { corrections, newRules } = findCorrections({ ledger, rules: existingRules });
  await sheets.updateValues({
    data: corrections.map((correction) => ({
      range: `${TRANSACTIONS_SHEET}!G${correction.rowNumber}:J${correction.rowNumber}`,
      values: [[false, null, 'manual', correction.category]],
    })),
    valueInputOption: 'RAW',
  });
  if (newRules.length > 0) {
    await sheets.appendValues({
      range: `${RULES_SHEET}!A:B`,
      valueInputOption: 'RAW',
      values: newRules.map((rule) => [rule.pattern, rule.category]),
    });
  }
  const rules = [...existingRules, ...newRules];

  const windowStart = daysAgo(days);
  const { errors, syncedAccounts, transactions } = await fetchTransactions({ env, startDate: windowStart });
  const plan = planSync({ fetched: transactions, ledger, syncedAccounts, windowStart });

  await sheets.updateValues({
    data: plan.updates.flatMap(({ rowNumber, transaction }) => [
      { range: `${TRANSACTIONS_SHEET}!A${rowNumber}`, values: [[isoDateToSerial(transaction.date)]] },
      { range: `${TRANSACTIONS_SHEET}!E${rowNumber}`, values: [[transaction.spend]] },
      { range: `${TRANSACTIONS_SHEET}!H${rowNumber}`, values: [[transaction.status]] },
    ]),
    valueInputOption: 'RAW',
  });

  const categorizations = await categorizeAll({ apiKey: env.ANTHROPIC_API_KEY, rules, transactions: plan.inserts });
  const inserts = plan.inserts.toSorted((a, b) => a.date.localeCompare(b.date, 'en'));
  if (inserts.length > 0) {
    await sheets.appendValues({
      range: `${TRANSACTIONS_SHEET}!A:K`,
      valueInputOption: 'RAW',
      values: inserts.map((transaction) =>
        toLedgerValues({ categorization: categorizations.get(transaction.id) ?? LLM_FAILURE, transaction }),
      ),
    });
  }

  if (plan.deletes.length > 0) {
    const sheetId = (await sheets.getSheets()).find((sheet) => sheet.title === TRANSACTIONS_SHEET)?.sheetId;
    await sheets.batchUpdate(
      plan.deletes
        .toSorted((a, b) => b - a)
        .map((rowNumber) => ({
          deleteDimension: { range: { dimension: 'ROWS', endIndex: rowNumber, sheetId, startIndex: rowNumber - 1 } },
        })),
    );
  }

  return {
    corrected: corrections.length,
    deleted: plan.deletes.length,
    errors,
    inserted: inserts.length,
    learnedRules: newRules.length,
    needsReview: inserts.filter((transaction) => categorizations.get(transaction.id)?.review).length,
    updated: plan.updates.length,
  };
};
