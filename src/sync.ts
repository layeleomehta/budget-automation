import { type Categorization, categorizeWithLlm, categorizeWithoutLlm, LLM_FAILURE } from './categorize';
import { createGoogleTokenProvider } from './google-auth';
import { findCorrections, isoDateToSerial, parseLedgerRows, planSync, toLedgerValues, TRANSACTIONS_SHEET } from './ledger';
import { createPlaidClient, type NormalizedTransaction, normalizeTransaction } from './plaid';
import { parseRules, type Rule } from './rules';
import { ensureSheetSetup, formatTransactionsSheet, RULES_SHEET } from './sheet-setup';
import { createSheetsClient } from './sheets';

export type Env = {
  ADMIN_KEY: string;
  ANTHROPIC_API_KEY: string;
  BUDGET_STATE: KVNamespace;
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
  PLAID_CLIENT_ID: string;
  PLAID_ENV: string;
  PLAID_SECRET: string;
  SPREADSHEET_ID: string;
};

export type Item = { accessToken: string; cursor?: string; institution: string; itemId: string };

const ITEM_PREFIX = 'item:';

export const plaidClient = (env: Env) =>
  createPlaidClient({ clientId: env.PLAID_CLIENT_ID, environment: env.PLAID_ENV, secret: env.PLAID_SECRET });

export const saveItem = ({ env, item }: { env: Env; item: Item }) =>
  env.BUDGET_STATE.put(`${ITEM_PREFIX}${item.itemId}`, JSON.stringify(item));

export const getItem = ({ env, itemId }: { env: Env; itemId: string }) =>
  env.BUDGET_STATE.get<Item>(`${ITEM_PREFIX}${itemId}`, 'json');

export const listItems = async (env: Env) => {
  const { keys } = await env.BUDGET_STATE.list({ prefix: ITEM_PREFIX });
  const values = await Promise.all(keys.map((key) => env.BUDGET_STATE.get<Item>(key.name, 'json')));
  return values.filter((value): value is Item => value !== null);
};

export const fetchChanges = async (env: Env) => {
  const plaid = plaidClient(env);
  const added: NormalizedTransaction[] = [];
  const modified: NormalizedTransaction[] = [];
  const removed: string[] = [];
  const cursors: { item: Item; nextCursor: string }[] = [];
  const errors: string[] = [];

  for (const item of await listItems(env)) {
    try {
      const changes = await plaid.syncTransactions({ accessToken: item.accessToken, cursor: item.cursor });
      const accounts = new Map(changes.accounts.map((account) => [account.account_id, account]));
      const normalize = (transaction: (typeof changes.added)[number]) =>
        normalizeTransaction({ account: accounts.get(transaction.account_id), institution: item.institution, transaction });
      added.push(...changes.added.map(normalize));
      modified.push(...changes.modified.map(normalize));
      removed.push(...changes.removed);
      cursors.push({ item, nextCursor: changes.nextCursor });
    } catch (error) {
      const message = `Plaid sync failed for ${item.institution} (${item.itemId}): ${String(error)}`;
      console.error(message);
      errors.push(message);
    }
  }

  return { added, cursors, errors, modified, removed };
};

const categorizeAll = async ({
  apiKey,
  rules,
  transactions,
}: {
  apiKey: string;
  rules: Rule[];
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

const sheetsClient = (env: Env) =>
  createSheetsClient({
    getAccessToken: createGoogleTokenProvider(env.GOOGLE_SERVICE_ACCOUNT_JSON),
    spreadsheetId: env.SPREADSHEET_ID,
  });

export const formatSheet = (env: Env) => formatTransactionsSheet(sheetsClient(env));

export const resetLedger = async (env: Env) => {
  const sheets = sheetsClient(env);
  const sheetId = (await sheets.getSheets()).find((sheet) => sheet.title === TRANSACTIONS_SHEET)?.sheetId;
  await sheets.clearValues(`${TRANSACTIONS_SHEET}!A2:K`);
  if (sheetId !== undefined) {
    await sheets.batchUpdate([
      { setDataValidation: { range: { endColumnIndex: 7, sheetId, startColumnIndex: 6, startRowIndex: 1 } } },
    ]);
  }
  const items = await listItems(env);
  await Promise.all(items.map(({ cursor: _cursor, ...item }) => saveItem({ env, item })));
  return { clearedCursors: items.length };
};

export const runSync = async (env: Env) => {
  const sheets = sheetsClient(env);
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

  const { added, cursors, errors, modified, removed } = await fetchChanges(env);
  const plan = planSync({ added, ledger, modified, removed });

  await sheets.updateValues({
    data: plan.updates.flatMap(({ rowNumber, transaction }) => [
      { range: `${TRANSACTIONS_SHEET}!A${rowNumber}`, values: [[isoDateToSerial(transaction.date)]] },
      { range: `${TRANSACTIONS_SHEET}!E${rowNumber}`, values: [[transaction.spend]] },
      { range: `${TRANSACTIONS_SHEET}!H${rowNumber}`, values: [[transaction.status]] },
      { range: `${TRANSACTIONS_SHEET}!K${rowNumber}`, values: [[transaction.id]] },
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

  await Promise.all(cursors.map(({ item, nextCursor }) => saveItem({ env, item: { ...item, cursor: nextCursor } })));

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
