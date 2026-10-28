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
      expected: { category: 'Misc', review: false, source: 'venmo' },
      input: { accountType: 'depository', description: 'VENMO CASHOUT PPD', merchant: 'Venmo', spend: -40 },
      name: 'nets Venmo against Misc',
    },
    {
      expected: { category: 'Transfer', review: false, source: 'bank' },
      input: { accountType: 'depository', bankCategory: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', description: 'BILT PAYMENT', spend: 1200 },
      name: 'treats a credit card payment as a transfer',
    },
    {
      expected: { category: 'Transfer', review: false, source: 'bank' },
      input: { bankCategory: 'RENT_AND_UTILITIES_RENT', description: 'Bilt Housing Payment', spend: 2400 },
      name: 'treats the Bilt card rent charge as a pass-through',
    },
    {
      expected: { category: 'Transfer', review: false, source: 'bank' },
      input: { bankCategory: 'INCOME_RENTAL', description: 'Payment - Bilt Housing', spend: -2400 },
      name: 'treats the Bilt card rent credit as a pass-through',
    },
    {
      expected: { category: 'Rent', review: false, source: 'bank' },
      input: { accountType: 'depository', bankCategory: 'RENT_AND_UTILITIES_RENT', description: 'BILT CARD HOUSING PPD ID: 1844372402', spend: 2400 },
      name: 'counts the checking rent debit as rent',
    },
    {
      expected: { category: 'Transfer', review: false, source: 'bank' },
      input: { bankCategory: 'INCOME_SALARY', description: 'AUTOMATIC PAYMENT - THANK', spend: -1438.26 },
      name: 'treats a mislabelled card payment credit as a transfer',
    },
    {
      expected: { category: 'Transfer', review: false, source: 'bank' },
      input: { bankCategory: 'LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT', description: 'Online Payment', spend: -73.98 },
      name: 'treats a card payment credit as a transfer',
    },
    {
      expected: { category: 'Transfer', review: false, source: 'bank' },
      input: { accountType: 'depository', bankCategory: 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS', description: 'Wealthfront EDI PYMNTS', spend: 5500 },
      name: 'treats an investment transfer as a transfer',
    },
    {
      expected: undefined,
      input: { bankCategory: 'TRAVEL_LODGING', description: 'ANNUAL HOTEL CREDIT', spend: -100 },
      name: 'leaves ordinary card refunds for the LLM',
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
    expect(matchRule({ rules: SEED_RULES, transaction: { description: 'card purchase', merchant: 'lyft ride' } })?.category).toBe('Transportation');
  });
});
