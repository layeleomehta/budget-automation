import { describe, expect, it } from 'vitest';
import { findCorrections, isoDateToSerial, type LedgerRow, parseLedgerRows, planSync, reapplyRules } from '../src/ledger';
import type { NormalizedTransaction } from '../src/plaid';

const transaction = (overrides: Partial<NormalizedTransaction> = {}): NormalizedTransaction => ({
  accountLabel: 'Chase Sapphire ••1234',
  accountType: 'credit',
  bankCategory: 'FOOD_AND_DRINK_COFFEE',
  date: '2026-10-20',
  description: 'STARBUCKS STORE 1234',
  id: crypto.randomUUID(),
  merchant: 'Starbucks',
  pendingTransactionId: null,
  spend: 6.5,
  status: 'posted',
  ...overrides,
});

const row = (overrides: Partial<LedgerRow> = {}): LedgerRow => ({
  account: 'Chase Sapphire ••1234',
  amount: 6.5,
  autoCategory: 'Eating Out',
  bankAccount: 'Chase Sapphire ••1234',
  category: 'Eating Out',
  date: '2026-10-20',
  description: 'STARBUCKS STORE 1234',
  id: crypto.randomUUID(),
  merchant: 'Starbucks',
  review: false,
  rowNumber: 2,
  source: 'llm',
  status: 'posted',
  ...overrides,
});

describe('planSync', () => {
  it('inserts new transactions and skips unchanged ones already in the ledger', () => {
    const existing = row();
    const fresh = transaction();
    const plan = planSync({
      added: [transaction({ id: existing.id }), fresh],
      ledger: [existing],
      modified: [],
      removed: [],
    });
    expect(plan).toStrictEqual({ deletes: [], inserts: [fresh], updates: [] });
  });

  it('replaces a pending row in place when its posted version arrives', () => {
    const pending = row({ amount: 40, date: '2026-10-19', rowNumber: 4, status: 'pending' });
    const posted = transaction({ date: '2026-10-21', pendingTransactionId: pending.id, spend: 48 });
    const plan = planSync({ added: [posted], ledger: [pending], modified: [], removed: [pending.id] });
    expect(plan).toStrictEqual({ deletes: [], inserts: [], updates: [{ rowNumber: 4, transaction: posted }] });
  });

  it('updates a modified transaction', () => {
    const existing = row({ amount: 20, rowNumber: 6 });
    const changed = transaction({ id: existing.id, spend: 24 });
    const plan = planSync({ added: [], ledger: [existing], modified: [changed], removed: [] });
    expect(plan.updates).toStrictEqual([{ rowNumber: 6, transaction: changed }]);
  });

  it.each<{ name: string; ledgerIds: string[]; removed: string[]; expected: number[] }>([
    { expected: [7], ledgerIds: ['gone'], name: 'deletes a removed transaction', removed: ['gone'] },
    { expected: [], ledgerIds: [], name: 'ignores removals for rows it never wrote', removed: ['unknown'] },
  ])('$name', ({ expected, ledgerIds, removed }) => {
    const plan = planSync({
      added: [],
      ledger: ledgerIds.map((id) => row({ id, rowNumber: 7 })),
      modified: [],
      removed,
    });
    expect(plan.deletes).toStrictEqual(expected);
  });
});

describe('findCorrections', () => {
  it('learns a merchant rule when the category was changed by hand', () => {
    const corrected = row({ autoCategory: 'Misc', category: 'Eating Out', rowNumber: 5 });
    expect(findCorrections({ ledger: [corrected], rules: [] })).toStrictEqual({
      corrections: [{ category: 'Eating Out', rowNumber: 5 }],
      newRules: [{ category: 'Eating Out', pattern: 'STARBUCKS' }],
    });
  });

  it('records a Venmo correction without learning a rule', () => {
    const venmo = row({ autoCategory: 'Uncategorized', category: 'Eating Out', description: 'VENMO CASHOUT', merchant: '', rowNumber: 9 });
    expect(findCorrections({ ledger: [venmo], rules: [] })).toStrictEqual({
      corrections: [{ category: 'Eating Out', rowNumber: 9 }],
      newRules: [],
    });
  });

  it('ignores untouched rows', () => {
    expect(findCorrections({ ledger: [row()], rules: [] })).toStrictEqual({ corrections: [], newRules: [] });
  });
});

describe('parseLedgerRows', () => {
  it('converts serial dates back to ISO dates', () => {
    const id = crypto.randomUUID();
    const [parsed] = parseLedgerRows([[isoDateToSerial('2026-10-27'), 'acct', 'm', 'd', 12.5, 'Misc', true, 'posted', 'llm', 'Misc', id]]);
    expect(parsed).toMatchObject({ date: '2026-10-27', id, review: true, rowNumber: 2 });
  });
});

describe('reapplyRules', () => {
  const rules = [{ category: 'Groceries' as const, pattern: 'TARGET' }];

  it.each<{ name: string; input: Partial<LedgerRow>; skip: number[]; expected: unknown[] }>([
    {
      expected: [{ category: 'Groceries', rowNumber: 3, source: 'rule' }],
      input: { category: 'Shopping', description: 'TARGET 00012', merchant: 'Target', rowNumber: 3 },
      name: 'moves a row to the category its rule names',
      skip: [],
    },
    {
      expected: [{ category: 'Misc', rowNumber: 4, source: 'venmo' }],
      input: { category: 'Uncategorized', description: 'Venmo', merchant: '', rowNumber: 4 },
      name: 'sends Venmo to Misc',
      skip: [],
    },
    {
      expected: [],
      input: { category: 'Shopping', description: 'TARGET', source: 'manual' },
      name: 'never overrides a manual edit',
      skip: [],
    },
    {
      expected: [],
      input: { category: 'Shopping', description: 'TARGET', rowNumber: 8 },
      name: 'skips rows corrected in this sync',
      skip: [8],
    },
    {
      expected: [],
      input: { category: 'Groceries', description: 'TARGET' },
      name: 'leaves rows already in the right category',
      skip: [],
    },
  ])('$name', ({ expected, input, skip }) => {
    expect(reapplyRules({ ledger: [row(input)], rules, skipRows: new Set(skip) })).toStrictEqual(expected);
  });
});
