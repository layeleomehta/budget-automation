import { describe, expect, it } from 'vitest';
import type { AccountInfo } from '../src/accounts';
import type { LedgerRow } from '../src/ledger';
import { CARD_EARNINGS, computeMonthlyPoints, earnRate, toPointsValues } from '../src/points';

const row = (overrides: Partial<LedgerRow>): LedgerRow => ({
  account: '',
  amount: 100,
  autoCategory: 'Misc',
  bankAccount: '',
  category: 'Misc',
  date: '2026-10-20',
  description: 'X',
  id: crypto.randomUUID(),
  merchant: '',
  review: false,
  rowNumber: 2,
  source: 'llm',
  status: 'posted',
  ...overrides,
});

const card = (cardName: string) => {
  const found = CARD_EARNINGS.find((candidate) => candidate.cardName === cardName);
  if (!found) {
    throw new Error(`No card named ${cardName}`);
  }
  return found;
};

describe('earnRate', () => {
  it.each<{ name: string; cardName: string; input: Partial<LedgerRow>; expected: number }>([
    { cardName: 'Chase Sapphire Preferred', expected: 3, input: { category: 'Eating Out', description: 'DD *DOORDASH BOLLYWOOD' }, name: 'Sapphire earns 3x on dining' },
    { cardName: 'Chase Sapphire Preferred', expected: 5, input: { category: 'Travel', description: 'CL *Chase Travel' }, name: 'Sapphire earns 5x on Chase Travel' },
    { cardName: 'Chase Sapphire Preferred', expected: 5, input: { category: 'Transportation', description: 'Lyft' }, name: 'Sapphire earns 5x on Lyft' },
    { cardName: 'Chase Sapphire Preferred', expected: 2, input: { category: 'Transportation', description: 'CLIPPER TRANSIT FARE' }, name: 'Sapphire earns 2x on transit' },
    { cardName: 'Chase Sapphire Preferred', expected: 3, input: { category: 'Transportation', description: 'TESLA, INC.' }, name: 'Sapphire earns 3x on EV charging' },
    { cardName: 'Chase Sapphire Preferred', expected: 1, input: { category: 'Phone Plan', description: 'MINT MOBILE' }, name: 'a phone bill is not gas' },
    { cardName: 'Chase Sapphire Preferred', expected: 1, input: { category: 'Shopping', description: 'TARGET' }, name: 'Sapphire earns 1x elsewhere' },
    { cardName: 'Chase Sapphire Preferred', expected: 0, input: { category: 'Misc', description: 'ANNUAL MEMBERSHIP FEE' }, name: 'the annual fee earns nothing' },
    { cardName: 'Chase Sapphire Preferred', expected: 0, input: { amount: -500, category: 'Transfer', description: 'Payment Thank You-Mobile' }, name: 'card payments earn nothing' },
    { cardName: 'Chase Sapphire Preferred', expected: 5, input: { category: 'Transfer', description: 'CL *Chase Travel' }, name: 'an off-budget work trip still earns points' },
    { cardName: 'Chase Freedom Unlimited', expected: 1.5, input: { category: 'Misc', description: 'APPLE.COM/BILL' }, name: 'Freedom earns 1.5x by default' },
    { cardName: 'Chase Freedom Unlimited', expected: 3, input: { category: 'Health', description: 'WALGREENS #1234' }, name: 'Freedom earns 3x at drugstores' },
    { cardName: 'Chase Prime Visa', expected: 5, input: { category: 'Shopping', description: 'AMAZON MKTPL*AB12' }, name: 'Prime Visa earns 5% at Amazon' },
    { cardName: 'Chase Prime Visa', expected: 2, input: { category: 'Eating Out', description: 'BLUE BOTTLE COFFEE' }, name: 'Prime Visa earns 2% on dining' },
    { cardName: 'Bilt', expected: 2, input: { date: '2026-11-01', description: 'SEXTANT COFFEE' }, name: 'Bilt doubles points on the 1st' },
    { cardName: 'Bilt', expected: 1, input: { date: '2027-02-01', description: 'SEXTANT COFFEE' }, name: 'Bilt double points end after Jan 1, 2027' },
    { cardName: 'Bilt', expected: 0, input: { category: 'Transfer', description: 'Bilt Housing Payment' }, name: 'Bilt rent pass-through earns nothing' },
  ])('$name', ({ cardName, expected, input }) => {
    expect(earnRate({ card: card(cardName), row: row(input) })).toBe(expected);
  });
});

describe('computeMonthlyPoints', () => {
  it('totals points per card per month, newest month first, with refunds subtracting', () => {
    const accounts: AccountInfo[] = [
      { bankAccount: 'Chase CREDIT CARD ••9944', nickname: 'Sapphire', productName: 'Chase Sapphire Preferred' },
      { bankAccount: 'Chase CREDIT CARD ••2404', nickname: '', productName: 'Prime Visa' },
      { bankAccount: 'Chase TOTAL CHECKING ••7256', nickname: 'Checking', productName: '' },
    ];
    const ledger = [
      row({ amount: 40, bankAccount: 'Chase CREDIT CARD ••9944', category: 'Eating Out', date: '2026-09-03' }),
      row({ amount: 100, bankAccount: 'Chase CREDIT CARD ••9944', category: 'Eating Out', date: '2026-10-03' }),
      row({ amount: -20, bankAccount: 'Chase CREDIT CARD ••9944', category: 'Eating Out', date: '2026-10-05' }),
      row({ amount: 60, bankAccount: 'Chase CREDIT CARD ••2404', category: 'Shopping', date: '2026-10-07', description: 'AMAZON.COM' }),
      row({ amount: 900, bankAccount: 'Chase TOTAL CHECKING ••7256', category: 'Misc', date: '2026-10-08' }),
    ];
    expect(toPointsValues(computeMonthlyPoints({ accounts, cards: CARD_EARNINGS, ledger }))).toStrictEqual([
      ['Month', 'Sapphire', 'Chase Prime Visa', 'Total points', 'Approx. value (1¢/pt)'],
      ['2026-10', 240, 300, 540, 5.4],
      ['2026-09', 120, 0, 120, 1.2],
    ]);
  });
});
