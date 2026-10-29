import { describe, expect, it } from 'vitest';
import type { AccountInfo } from '../src/accounts';
import { BENEFITS, benefitKey, CARD_PERKS, computeBenefits, linkedPerks, parseDoneBenefits } from '../src/benefits';
import type { LedgerRow } from '../src/ledger';

const SAPPHIRE: AccountInfo = { bankAccount: 'Chase CREDIT CARD ••9944', nickname: 'Sapphire', productName: 'Chase Sapphire Preferred' };

const row = (overrides: Partial<LedgerRow>): LedgerRow => ({
  account: 'Sapphire',
  amount: 10,
  autoCategory: 'Misc',
  bankAccount: SAPPHIRE.bankAccount,
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

const benefit = (name: string) => {
  const found = BENEFITS.find((candidate) => candidate.name === name);
  if (!found) {
    throw new Error(`No benefit named ${name}`);
  }
  return found;
};

const HOTEL = benefit('$100 Chase Travel hotel credit');
const DOORDASH = benefit('$10 DoorDash promo');
const APPLE_TV = benefit('Apple TV (1 year)');
const GLOBAL_ENTRY = benefit('$120 Global Entry / TSA PreCheck credit');

describe('computeBenefits', () => {
  it.each<{
    name: string;
    benefits: typeof BENEFITS;
    done?: string[];
    ledger: Partial<LedgerRow>[];
    today: string;
    expected: Record<string, unknown>;
  }>([
    {
      benefits: [HOTEL],
      expected: { daysLeft: 277, periodLabel: '2026-08-02 to 2027-08-01', remaining: 0, resetsOn: '2027-08-02', status: 'Used', used: 100 },
      ledger: [
        { amount: 95, date: '2026-08-02', description: 'ANNUAL MEMBERSHIP FEE' },
        { amount: -100, date: '2026-08-30', description: 'ANNUAL HOTEL CREDIT' },
      ],
      name: 'counts a hotel credit inside the card year that starts at the annual fee',
      today: '2026-10-29',
    },
    {
      benefits: [HOTEL],
      expected: { remaining: 100, status: 'Unused', used: 0 },
      ledger: [
        { amount: -100, date: '2026-07-30', description: 'ANNUAL HOTEL CREDIT' },
        { amount: 95, date: '2026-08-02', description: 'ANNUAL MEMBERSHIP FEE' },
      ],
      name: 'ignores a hotel credit from the previous card year',
      today: '2026-10-29',
    },
    {
      benefits: [HOTEL],
      expected: { periodLabel: '2026-01-01 to 2026-12-31', status: 'Unused' },
      ledger: [{ amount: 12, description: 'COFFEE' }],
      name: 'falls back to the calendar year without an annual fee',
      today: '2026-10-29',
    },
    {
      benefits: [DOORDASH],
      done: [benefitKey({ name: DOORDASH.name, periodLabel: '2026-10' })],
      expected: { daysLeft: 3, done: true, resetsOn: '2026-11-01', status: 'Used', used: 10 },
      ledger: [{}],
      name: 'keeps a manual tick for the current month',
      today: '2026-10-29',
    },
    {
      benefits: [DOORDASH],
      done: [benefitKey({ name: DOORDASH.name, periodLabel: '2026-10' })],
      expected: { done: false, periodLabel: '2026-11', status: 'Unused' },
      ledger: [{}],
      name: 'resets a monthly tick when the month changes',
      today: '2026-11-01',
    },
    {
      benefits: [APPLE_TV],
      expected: { daysLeft: 63, resetsOn: '2026-12-31', status: 'Unused' },
      ledger: [{}],
      name: 'counts down to a one-time activation deadline',
      today: '2026-10-29',
    },
    {
      benefits: [APPLE_TV],
      expected: { status: 'Missed' },
      ledger: [{}],
      name: 'marks a one-time benefit missed after its deadline',
      today: '2027-01-01',
    },
    {
      benefits: [GLOBAL_ENTRY],
      expected: { resetsOn: '2030-09-12', status: 'Used', used: 120 },
      ledger: [
        { amount: 120, date: '2026-09-10', description: 'TSA PRECHECK ENROLLMENT' },
        { amount: -120, date: '2026-09-12', description: 'TSA PRECHECK CREDIT' },
      ],
      name: 'counts the Global Entry credit and not the fee it reimburses',
      today: '2026-10-29',
    },
  ])('$name', ({ benefits, done, expected, ledger, today }) => {
    const [result] = computeBenefits({ accounts: [SAPPHIRE], benefits, done: new Set(done), ledger: ledger.map(row), today });
    expect(result).toMatchObject(expected);
  });

  it('skips benefits for cards that are not linked', () => {
    const freedom: AccountInfo = { bankAccount: 'Chase CREDIT CARD ••1111', nickname: 'Freedom', productName: 'Chase Freedom Unlimited' };
    expect(
      computeBenefits({ accounts: [freedom], benefits: BENEFITS, done: new Set(), ledger: [row({ account: 'Freedom', bankAccount: freedom.bankAccount })], today: '2026-10-29' }),
    ).toStrictEqual([]);
  });

  it('lists benefits to use before used ones, soonest deadline first', () => {
    const results = computeBenefits({
      accounts: [SAPPHIRE],
      benefits: BENEFITS,
      done: new Set(),
      ledger: [row({ amount: 95, date: '2026-08-02', description: 'ANNUAL MEMBERSHIP FEE' }), row({ amount: -100, date: '2026-08-30', description: 'ANNUAL HOTEL CREDIT' })],
      today: '2026-10-29',
    });
    expect(results.map((result) => [result.name, result.status])).toStrictEqual([
      ['$10 DoorDash promo', 'Unused'],
      ['Apple TV (1 year)', 'Unused'],
      ['DashPass membership', 'Unused'],
      ['$120 Global Entry / TSA PreCheck credit', 'Unused'],
      ['$100 Chase Travel hotel credit', 'Used'],
    ]);
  });
});

describe('parseDoneBenefits', () => {
  it('reads ticked rows keyed by benefit and period', () => {
    expect([
      ...parseDoneBenefits([
        ['Sapphire', '$10 DoorDash promo', 10, '2026-10', '', '', 10, 0, 'Used', true, ''],
        ['Sapphire', 'Apple TV (1 year)', 180, 'One-time', '', '', 0, 180, 'Unused', false, ''],
      ]),
    ]).toStrictEqual([benefitKey({ name: '$10 DoorDash promo', periodLabel: '2026-10' })]);
  });
});

describe('linkedPerks', () => {
  it('lists perks only for linked cards, under their nicknames', () => {
    const perks = linkedPerks({
      accounts: [{ bankAccount: 'Chase CREDIT CARD ••2404', nickname: 'Amazon card', productName: 'Prime Visa' }],
      perks: CARD_PERKS,
    });
    expect(perks.map(([card, perk]) => [card, perk])).toStrictEqual([
      ['Amazon card', '5% back at Amazon and Whole Foods'],
      ['Amazon card', '2% back on dining, gas and transit'],
    ]);
  });
});
