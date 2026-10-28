import { describe, expect, it } from 'vitest';
import { findCorrections, isoDateToSerial, type LedgerRow, parseLedgerRows, planSync } from '../src/ledger';
import type { NormalizedTransaction } from '../src/teller';

const transaction = (overrides: Partial<NormalizedTransaction> = {}): NormalizedTransaction => ({
  accountLabel: 'Chase Sapphire ••1234',
  accountType: 'credit',
  date: '2026-10-20',
  description: 'STARBUCKS STORE 1234',
  id: crypto.randomUUID(),
  merchant: 'Starbucks',
  spend: 6.5,
  status: 'posted',
  tellerCategory: 'dining',
  ...overrides,
});

const row = (overrides: Partial<LedgerRow> = {}): LedgerRow => ({
  account: 'Chase Sapphire ••1234',
  amount: 6.5,
  autoCategory: 'Eating Out',
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
  it('inserts unseen transactions and leaves unchanged rows alone', () => {
    const existing = row();
    const fresh = transaction();
    const plan = planSync({
      fetched: [transaction({ id: existing.id }), fresh],
      ledger: [existing],
      syncedAccounts: new Set([existing.account]),
      windowStart: '2026-10-13',
    });
    expect(plan).toStrictEqual({ deletes: [], inserts: [fresh], updates: [] });
  });

  it('updates a pending row that posted with a new date and amount', () => {
    const existing = row({ amount: 40, date: '2026-10-19', status: 'pending' });
    const posted = transaction({ date: '2026-10-21', id: existing.id, spend: 48, status: 'posted' });
    const plan = planSync({
      fetched: [posted],
      ledger: [existing],
      syncedAccounts: new Set([existing.account]),
      windowStart: '2026-10-13',
    });
    expect(plan.updates).toStrictEqual([{ rowNumber: existing.rowNumber, transaction: posted }]);
  });

  it.each<{ name: string; pending: Partial<LedgerRow>; syncedAccounts: string[]; expected: number[] }>([
    { expected: [7], name: 'deletes a vanished pending row', pending: { rowNumber: 7 }, syncedAccounts: ['Chase Sapphire ••1234'] },
    { expected: [], name: 'keeps pending rows outside the window', pending: { date: '2026-09-01', rowNumber: 7 }, syncedAccounts: ['Chase Sapphire ••1234'] },
    { expected: [], name: 'keeps pending rows for accounts that failed to sync', pending: { rowNumber: 7 }, syncedAccounts: [] },
  ])('$name', ({ expected, pending, syncedAccounts }) => {
    const plan = planSync({
      fetched: [],
      ledger: [row({ status: 'pending', ...pending })],
      syncedAccounts: new Set(syncedAccounts),
      windowStart: '2026-10-13',
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
