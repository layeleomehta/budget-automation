import { type Category, isCategory, UNCATEGORIZED } from './categories';
import type { Categorization } from './categorize';
import { isVenmo, merchantKey, type Rule } from './rules';
import type { NormalizedTransaction } from './teller';

export const TRANSACTIONS_SHEET = 'Transactions';

export const LEDGER_HEADERS = [
  'Date',
  'Account',
  'Merchant',
  'Description',
  'Amount',
  'Category',
  'Review',
  'Status',
  'Source',
  'Auto Category',
  'Transaction ID',
] as const;

export type LedgerRow = {
  account: string;
  amount: number;
  autoCategory: string;
  category: string;
  date: string;
  description: string;
  id: string;
  merchant: string;
  review: boolean;
  rowNumber: number;
  source: string;
  status: string;
};

const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

export const isoDateToSerial = (isoDate: string) => (Date.parse(`${isoDate}T00:00:00Z`) - SHEETS_EPOCH_MS) / DAY_MS;

const serialToIsoDate = (serial: number) => new Date(SHEETS_EPOCH_MS + Math.round(serial) * DAY_MS).toISOString().slice(0, 10);

const asString = (value: unknown) => (value === undefined || value === null ? '' : String(value));

export const parseLedgerRows = (rows: unknown[][]): LedgerRow[] =>
  rows.flatMap((row, index) => {
    const [date, account, merchant, description, amount, category, review, status, source, autoCategory, id] = row;
    if (!id) {
      return [];
    }
    return [
      {
        account: asString(account),
        amount: Number(amount) || 0,
        autoCategory: asString(autoCategory),
        category: asString(category),
        date: typeof date === 'number' ? serialToIsoDate(date) : asString(date),
        description: asString(description),
        id: asString(id),
        merchant: asString(merchant),
        review: review === true || review === 'TRUE',
        rowNumber: index + 2,
        source: asString(source),
        status: asString(status),
      },
    ];
  });

export const toLedgerValues = ({
  categorization,
  transaction,
}: {
  categorization: Categorization;
  transaction: NormalizedTransaction;
}) => [
  isoDateToSerial(transaction.date),
  transaction.accountLabel,
  transaction.merchant,
  transaction.description,
  transaction.spend,
  categorization.category,
  categorization.review,
  transaction.status,
  categorization.source,
  categorization.category,
  transaction.id,
];

export type SyncPlan = {
  deletes: number[];
  inserts: NormalizedTransaction[];
  updates: { rowNumber: number; transaction: NormalizedTransaction }[];
};

export const planSync = ({
  fetched,
  ledger,
  syncedAccounts,
  windowStart,
}: {
  fetched: NormalizedTransaction[];
  ledger: LedgerRow[];
  syncedAccounts: Set<string>;
  windowStart: string;
}): SyncPlan => {
  const ledgerById = new Map(ledger.map((row) => [row.id, row]));
  const fetchedIds = new Set(fetched.map((transaction) => transaction.id));
  const plan: SyncPlan = { deletes: [], inserts: [], updates: [] };

  for (const transaction of fetched) {
    const existing = ledgerById.get(transaction.id);
    if (!existing) {
      plan.inserts.push(transaction);
      continue;
    }
    const changed =
      existing.date !== transaction.date ||
      existing.status !== transaction.status ||
      Math.abs(existing.amount - transaction.spend) >= 0.005;
    if (changed) {
      plan.updates.push({ rowNumber: existing.rowNumber, transaction });
    }
  }

  plan.deletes = ledger
    .filter(
      (row) =>
        row.status === 'pending' &&
        row.date >= windowStart &&
        syncedAccounts.has(row.account) &&
        !fetchedIds.has(row.id),
    )
    .map((row) => row.rowNumber);

  return plan;
};

export type Correction = { category: Category; rowNumber: number };

export const findCorrections = ({ ledger, rules }: { ledger: LedgerRow[]; rules: Rule[] }) => {
  const corrections: Correction[] = [];
  const newRules: Rule[] = [];
  const knownPatterns = new Set(rules.map((rule) => rule.pattern.toUpperCase()));

  for (const row of ledger) {
    if (row.category === row.autoCategory || !isCategory(row.category) || row.category === UNCATEGORIZED) {
      continue;
    }
    corrections.push({ category: row.category, rowNumber: row.rowNumber });
    if (isVenmo(row)) {
      continue;
    }
    const pattern = merchantKey(row);
    if (pattern && !knownPatterns.has(pattern)) {
      knownPatterns.add(pattern);
      newRules.push({ category: row.category, pattern });
    }
  }

  return { corrections, newRules };
};
