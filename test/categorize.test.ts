import { describe, expect, it } from 'vitest';
import { categorizeWithoutLlm } from '../src/categorize';
import type { NormalizedTransaction } from '../src/plaid';
import { matchRule, SEED_RULES } from '../src/rules';

const transaction = (overrides: Partial<NormalizedTransaction>): NormalizedTransaction => ({
  accountLabel: 'Chase Sapphire ••1234',
  accountType: 'credit',
  bankCategory: null,
  date: '2026-10-20',
  description: '',
  id: crypto.randomUUID(),
  merchant: '',
  pendingTransactionId: null,
  spend: 10,
  status: 'posted',
  ...overrides,
});

describe('categorizeWithoutLlm', () => {
  it.each<{ name: string; input: Partial<NormalizedTransaction>; expected: ReturnType<typeof categorizeWithoutLlm> }>([
    {
      expected: { category: 'Uncategorized', review: true, source: 'venmo' },
      input: { accountType: 'depository', description: 'VENMO CASHOUT PPD', merchant: 'Venmo', spend: -40 },
      name: 'sends Venmo to review',
    },
    {
      expected: { category: 'Transfer', review: false, source: 'bank' },
      input: { accountType: 'depository', bankCategory: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', description: 'BILT PAYMENT', spend: 1200 },
      name: 'treats a credit card payment as a transfer',
    },
    {
      expected: { category: 'Eating Out', review: false, source: 'rule' },
      input: { description: 'UBER EATS PENDING' },
      name: 'prefers the longer matching rule',
    },
    {
      expected: { category: 'Transportation', review: false, source: 'rule' },
      input: { description: 'UBER *TRIP' },
      name: 'matches a plain Uber ride',
    },
    {
      expected: { category: 'Income', review: false, source: 'bank' },
      input: { accountType: 'depository', bankCategory: 'INCOME_WAGES', description: 'ACME CORP PAYROLL', spend: -5254.71 },
      name: 'treats a payroll deposit as income',
    },
    {
      expected: undefined,
      input: { description: 'SOME NEW PLACE' },
      name: 'leaves unknown merchants for the LLM',
    },
  ])('$name', ({ expected, input }) => {
    expect(categorizeWithoutLlm({ rules: SEED_RULES, transaction: transaction(input) })).toStrictEqual(expected);
  });
});

describe('matchRule', () => {
  it('is case-insensitive and checks the merchant name too', () => {
    expect(matchRule({ rules: SEED_RULES, transaction: { description: 'card purchase', merchant: 'spotify usa' } })?.category).toBe('Spotify');
  });
});
