import type { Category } from './categories';
import { ACCOUNTS_SHEET, displayAccount, parseNicknames, planRelabels } from './accounts';
import { type Categorization, categorizeWithLlm, categorizeWithoutLlm, LLM_FAILURE } from './categorize';
import { createGoogleTokenProvider } from './google-auth';
import { findCorrections, isoDateToSerial, reapplyRules, LEDGER_HEADERS, parseLedgerRows, planSync, toLedgerValues, TRANSACTIONS_SHEET } from './ledger';
import { accountLabel, createPlaidClient, type NormalizedTransaction, normalizeTransaction } from './plaid';
import { parseRules, type Rule } from './rules';
import { applyFilterOptions, ensureSheetSetup, formatTransactionsSheet, RULES_SHEET } from './sheet-setup';
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
  const productNames = new Map<string, string>();

  for (const item of await listItems(env)) {
    try {
      const changes = await plaid.syncTransactions({ accessToken: item.accessToken, cursor: item.cursor });
      const accounts = new Map(changes.accounts.map((account) => [account.account_id, account]));
      for (const account of changes.accounts) {
        productNames.set(accountLabel({ account, institution: item.institution }), account.official_name ?? '');
      }
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

  return { added, cursors, errors, modified, productNames, removed };
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

const newestFirst = (sheetId: number | undefined) => ({
  sortRange: {
    range: { endColumnIndex: LEDGER_HEADERS.length, sheetId, startColumnIndex: 0, startRowIndex: 1 },
    sortSpecs: [{ dimensionIndex: 0, sortOrder: 'DESCENDING' }],
  },
});

const filterOptions = (entries: { account: string; date: string }[]) => ({
  accounts: [...new Set(entries.map((entry) => entry.account).filter(Boolean))].toSorted((a, b) => a.localeCompare(b, 'en')),
  months: [...new Set(entries.map((entry) => entry.date.slice(0, 7)).filter((month) => /^\d{4}-\d{2}$/.test(month)))]
    .toSorted()
    .toReversed(),
});

export const formatSheet = async (env: Env) => {
  const sheets = sheetsClient(env);
  const result = await formatTransactionsSheet(sheets);
  const sheetId = (await sheets.getSheets()).find((sheet) => sheet.title === TRANSACTIONS_SHEET)?.sheetId;
  await sheets.batchUpdate([newestFirst(sheetId)]);
  const ledger = parseLedgerRows(await sheets.getValues(`${TRANSACTIONS_SHEET}!A2:L`));
  await applyFilterOptions({ ...filterOptions(ledger), sheets });
  return result;
};

export const addRules = async ({ env, rules }: { env: Env; rules: Rule[] }) => {
  const sheets = sheetsClient(env);
  const existing = new Set(parseRules(await sheets.getValues(`${RULES_SHEET}!A2:B`)).map((rule) => rule.pattern.toUpperCase()));
  const fresh = rules.filter((rule) => !existing.has(rule.pattern.toUpperCase()));
  if (fresh.length > 0) {
    await sheets.appendValues({
      range: `${RULES_SHEET}!A:B`,
      valueInputOption: 'RAW',
      values: fresh.map((rule) => [rule.pattern, rule.category]),
    });
  }
  return { added: fresh };
};

export const monthBreakdown = async ({ env, month }: { env: Env; month: string }) => {
  const ledger = parseLedgerRows(await sheetsClient(env).getValues(`${TRANSACTIONS_SHEET}!A2:L`));
  const rows = ledger.filter((row) => row.date.startsWith(month));
  const totals: Record<string, number> = {};
  for (const row of rows) {
    totals[row.category] = Math.round(((totals[row.category] ?? 0) + row.amount) * 100) / 100;
  }
  return {
    rows: rows.map(({ account, amount, category, date, description, merchant, status }) => ({
      account,
      amount,
      category,
      date,
      description,
      merchant,
      status,
    })),
    totals,
  };
};

export const listReview = async (env: Env) => {
  const ledger = parseLedgerRows(await sheetsClient(env).getValues(`${TRANSACTIONS_SHEET}!A2:L`));
  return ledger
    .filter((row) => row.review)
    .map(({ account, amount, category, date, description, id, merchant, source, status }) => ({
      account,
      amount,
      category,
      date,
      description,
      id,
      merchant,
      source,
      status,
    }));
};

export const setCategory = async ({
  category,
  date,
  env,
  id,
  match,
}: {
  category: Category;
  date: string;
  env: Env;
  id: string;
  match: string;
}) => {
  const sheets = sheetsClient(env);
  const ledger = parseLedgerRows(await sheets.getValues(`${TRANSACTIONS_SHEET}!A2:L`));
  const needle = match.toUpperCase();
  const rows = id
    ? ledger.filter((row) => row.id === id)
    : ledger.filter((row) => row.date === date && row.description.toUpperCase().includes(needle));
  await sheets.updateValues({
    data: rows.map((row) => ({
      range: `${TRANSACTIONS_SHEET}!F${row.rowNumber}:J${row.rowNumber}`,
      values: [[category, false, null, 'manual', category]],
    })),
    valueInputOption: 'RAW',
  });
  return rows.map(({ account, amount, description, rowNumber }) => ({ account, amount, category, description, rowNumber }));
};

export const redateTransactions = async ({
  env,
  from,
  match,
  to,
}: {
  env: Env;
  from: string;
  match: string;
  to: string;
}) => {
  const sheets = sheetsClient(env);
  const ledger = parseLedgerRows(await sheets.getValues(`${TRANSACTIONS_SHEET}!A2:L`));
  const needle = match.toUpperCase();
  const rows = ledger.filter((row) => row.date === from && row.description.toUpperCase().includes(needle));
  await sheets.updateValues({
    data: rows.map((row) => ({ range: `${TRANSACTIONS_SHEET}!A${row.rowNumber}`, values: [[isoDateToSerial(to)]] })),
    valueInputOption: 'RAW',
  });
  return rows.map(({ account, amount, category, description, rowNumber, status }) => ({
    account,
    amount,
    category,
    description,
    movedTo: to,
    rowNumber,
    status,
  }));
};

export const resetLedger = async (env: Env) => {
  const sheets = sheetsClient(env);
  const sheetId = (await sheets.getSheets()).find((sheet) => sheet.title === TRANSACTIONS_SHEET)?.sheetId;
  await sheets.clearValues(`${TRANSACTIONS_SHEET}!A2:L`);
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

  const [ledgerValues, ruleValues, accountValues] = await Promise.all([
    sheets.getValues(`${TRANSACTIONS_SHEET}!A2:L`),
    sheets.getValues(`${RULES_SHEET}!A2:B`),
    sheets.getValues(`${ACCOUNTS_SHEET}!A2:B`),
  ]);
  const ledger = parseLedgerRows(ledgerValues);
  const existingRules = parseRules(ruleValues);
  const { known: knownAccounts, nicknames } = parseNicknames(accountValues);

  const relabels = planRelabels({ ledger, nicknames });
  await sheets.updateValues({
    data: relabels.flatMap(({ account, bankAccount, rowNumber }) => [
      { range: `${TRANSACTIONS_SHEET}!B${rowNumber}`, values: [[account]] },
      { range: `${TRANSACTIONS_SHEET}!L${rowNumber}`, values: [[bankAccount]] },
    ]),
    valueInputOption: 'RAW',
  });

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

  const recategorized = reapplyRules({
    ledger,
    rules,
    skipRows: new Set(corrections.map((correction) => correction.rowNumber)),
  });
  await sheets.updateValues({
    data: recategorized.map(({ category, rowNumber, source }) => ({
      range: `${TRANSACTIONS_SHEET}!F${rowNumber}:J${rowNumber}`,
      values: [[category, false, null, source, category]],
    })),
    valueInputOption: 'RAW',
  });

  const { added, cursors, errors, modified, productNames, removed } = await fetchChanges(env);
  const plan = planSync({ added, ledger, modified, removed });

  const newAccounts = [...new Set([...ledger.map((row) => row.bankAccount), ...productNames.keys()])].filter(
    (bankAccount) => bankAccount && !knownAccounts.has(bankAccount),
  );
  if (newAccounts.length > 0) {
    await sheets.appendValues({
      range: `${ACCOUNTS_SHEET}!A:C`,
      valueInputOption: 'RAW',
      values: newAccounts.map((bankAccount) => [bankAccount, '', productNames.get(bankAccount) ?? '']),
    });
  }

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
      range: `${TRANSACTIONS_SHEET}!A:L`,
      valueInputOption: 'RAW',
      values: inserts.map((transaction) =>
        toLedgerValues({
          categorization: categorizations.get(transaction.id) ?? LLM_FAILURE,
          displayAccount: displayAccount({ bankAccount: transaction.accountLabel, nicknames }),
          transaction,
        }),
      ),
    });
  }

  if (inserts.length > 0 || plan.updates.length > 0 || plan.deletes.length > 0) {
    const sheetId = (await sheets.getSheets()).find((sheet) => sheet.title === TRANSACTIONS_SHEET)?.sheetId;
    await sheets.batchUpdate([
      ...plan.deletes
        .toSorted((a, b) => b - a)
        .map((rowNumber) => ({
          deleteDimension: { range: { dimension: 'ROWS', endIndex: rowNumber, sheetId, startIndex: rowNumber - 1 } },
        })),
      newestFirst(sheetId),
    ]);
  }

  await applyFilterOptions({
    ...filterOptions([
      ...ledger.map((row) => ({ account: displayAccount({ bankAccount: row.bankAccount, nicknames }), date: row.date })),
      ...inserts.map((transaction) => ({
        account: displayAccount({ bankAccount: transaction.accountLabel, nicknames }),
        date: transaction.date,
      })),
    ]),
    sheets,
  });

  await Promise.all(cursors.map(({ item, nextCursor }) => saveItem({ env, item: { ...item, cursor: nextCursor } })));

  return {
    corrected: corrections.length,
    recategorized: recategorized.length,
    relabeled: relabels.length,
    deleted: plan.deletes.length,
    errors,
    inserted: inserts.length,
    learnedRules: newRules.length,
    needsReview: inserts.filter((transaction) => categorizations.get(transaction.id)?.review).length,
    updated: plan.updates.length,
  };
};
