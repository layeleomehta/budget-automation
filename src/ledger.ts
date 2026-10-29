import { type Category, isCategory, UNCATEGORIZED } from './categories';
import type { Categorization } from './categorize';
import { isVenmo, matchRule, merchantKey, type Rule } from './rules';
import type { NormalizedTransaction } from './plaid';

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
  'Bank Account',
] as const;

export type LedgerRow = {
  account: string;
  amount: number;
  autoCategory: string;
  bankAccount: string;
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
    const [date, account, merchant, description, amount, category, review, status, source, autoCategory, id, bankAccount] = row;
    if (!id) {
      return [];
    }
    return [
      {
        account: asString(account),
        amount: Number(amount) || 0,
        autoCategory: asString(autoCategory),
        bankAccount: asString(bankAccount) || asString(account),
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
  displayAccount,
  transaction,
}: {
  categorization: Categorization;
  displayAccount: string;
  transaction: NormalizedTransaction;
}) => [
  isoDateToSerial(transaction.date),
  displayAccount,
  transaction.merchant,
  transaction.description,
  transaction.spend,
  categorization.category,
  categorization.review,
  transaction.status,
  categorization.source,
  categorization.category,
  transaction.id,
  transaction.accountLabel,
];

export type SyncPlan = {
  deletes: number[];
  inserts: NormalizedTransaction[];
  updates: { rowNumber: number; transaction: NormalizedTransaction }[];
};

const rowChanged = ({ row, transaction }: { row: LedgerRow; transaction: NormalizedTransaction }) =>
  row.id !== transaction.id ||
  row.status !== transaction.status ||
  Math.abs(row.amount - transaction.spend) >= 0.005;

export const planSync = ({
  added,
  ledger,
  modified,
  removed,
}: {
  added: NormalizedTransaction[];
  ledger: LedgerRow[];
  modified: NormalizedTransaction[];
  removed: string[];
}): SyncPlan => {
  const ledgerById = new Map(ledger.map((row) => [row.id, row]));
  const incoming = new Map([...added, ...modified].map((transaction) => [transaction.id, transaction]));
  const replacedPendingIds = new Set<string>();
  const plan: SyncPlan = { deletes: [], inserts: [], updates: [] };

  for (const transaction of incoming.values()) {
    const existing =
      ledgerById.get(transaction.id) ??
      (transaction.pendingTransactionId ? ledgerById.get(transaction.pendingTransactionId) : undefined);
    if (!existing) {
      plan.inserts.push(transaction);
      continue;
    }
    if (existing.id !== transaction.id) {
      replacedPendingIds.add(existing.id);
    }
    if (rowChanged({ row: existing, transaction })) {
      plan.updates.push({ rowNumber: existing.rowNumber, transaction });
    }
  }

  plan.deletes = removed.flatMap((id) => {
    const row = ledgerById.get(id);
    return row && !replacedPendingIds.has(id) ? [row.rowNumber] : [];
  });

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

export type Recategorization = { category: Category; rowNumber: number; source: 'rule' | 'venmo' };

export const reapplyRules = ({
  ledger,
  rules,
  skipRows,
}: {
  ledger: LedgerRow[];
  rules: Rule[];
  skipRows: Set<number>;
}): Recategorization[] =>
  ledger.flatMap((row) => {
    if (row.source === 'manual' || skipRows.has(row.rowNumber)) {
      return [];
    }
    const next: Omit<Recategorization, 'rowNumber'> | undefined = isVenmo(row)
      ? { category: 'Misc', source: 'venmo' }
      : (() => {
          const rule = matchRule({ rules, transaction: row });
          return rule ? { category: rule.category, source: 'rule' as const } : undefined;
        })();
    if (!next || next.category === row.category) {
      return [];
    }
    return [{ ...next, rowNumber: row.rowNumber }];
  });
