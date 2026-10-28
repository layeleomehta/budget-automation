import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { ALL_CATEGORIES, type Category, INCOME, TRANSFER, UNCATEGORIZED } from './categories';
import type { NormalizedTransaction } from './plaid';
import { isVenmo, matchRule, type Rule } from './rules';

export type CategorizationSource = 'bank' | 'llm' | 'llm-error' | 'manual' | 'rule' | 'venmo';

export type Categorization = { category: Category; review: boolean; source: CategorizationSource };

const CREDIT_CARD_PAYMENT = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT';

const isCardPaymentOrPassThrough = (transaction: NormalizedTransaction) => {
  if (transaction.bankCategory === CREDIT_CARD_PAYMENT) {
    return true;
  }
  if (transaction.accountType !== 'credit') {
    return false;
  }
  const text = `${transaction.merchant} ${transaction.description}`.toUpperCase();
  return text.includes('BILT HOUSING') || (transaction.spend < 0 && /^(LOAN_|INCOME_)/.test(transaction.bankCategory ?? ''));
};

export const categorizeWithoutLlm = ({
  rules,
  transaction,
}: {
  rules: Rule[];
  transaction: NormalizedTransaction;
}): Categorization | undefined => {
  if (isVenmo(transaction)) {
    return { category: 'Misc', review: false, source: 'venmo' };
  }
  const rule = matchRule({ rules, transaction });
  if (rule) {
    return { category: rule.category, review: false, source: 'rule' };
  }
  if (isCardPaymentOrPassThrough(transaction) || transaction.bankCategory?.startsWith('TRANSFER_OUT_INVESTMENT')) {
    return { category: TRANSFER, review: false, source: 'bank' };
  }
  if (transaction.accountType === 'depository' && transaction.bankCategory === 'RENT_AND_UTILITIES_RENT') {
    return { category: 'Rent', review: false, source: 'bank' };
  }
  if (
    transaction.accountType === 'depository' &&
    transaction.spend < 0 &&
    transaction.bankCategory?.startsWith('INCOME')
  ) {
    return { category: INCOME, review: false, source: 'bank' };
  }
  return undefined;
};

const LLM_MODEL = 'claude-haiku-5-5';
const LLM_BATCH_SIZE = 50;

const LLM_RESULT_SCHEMA = z.object({
  results: z.array(
    z.object({
      category: z.enum(ALL_CATEGORIES),
      confident: z.boolean(),
      id: z.string(),
    }),
  ),
});

const SYSTEM_PROMPT = `You categorize one person's bank and credit card transactions for their monthly budget.

Each transaction has an id, merchant, raw bank description, amount, account type, and the bank's own category guess. A positive amount is money spent; a negative amount is money coming in (a refund, credit, or deposit).

Categories:
- Rent: apartment rent.
- Utilities: electricity, gas, water.
- Wifi: home internet.
- Phone Plan: mobile phone service.
- Spotify: Spotify subscription.
- Gym: gym membership.
- Groceries: supermarkets and grocery stores.
- Eating Out: restaurants, bars, cafes, coffee, food delivery.
- Shopping: clothes, Amazon, retail, household goods, electronics.
- Transportation: everyday rideshare, transit, gas, parking, tolls.
- Travel: flights, hotels, short-term rentals, rental cars, and other trip bookings.
- Health: pharmacy, doctor, dentist, therapy, prescriptions.
- Misc: activities, entertainment, subscriptions not listed above, and anything else that is clearly spending.
- Income: paychecks and employer deposits.
- Transfer: credit card payments and money moved between the person's own accounts. These are not spending.
- Uncategorized: you cannot tell what this is.

A refund belongs to the category of the purchase it refunds. Return one result per transaction id. Set confident to false when the merchant is ambiguous or you are guessing.`;

export const categorizeWithLlm = async ({
  apiKey,
  transactions,
}: {
  apiKey: string;
  transactions: NormalizedTransaction[];
}): Promise<Map<string, Categorization>> => {
  const client = new Anthropic({ apiKey });
  const results = new Map<string, Categorization>();

  for (let start = 0; start < transactions.length; start += LLM_BATCH_SIZE) {
    const batch = transactions.slice(start, start + LLM_BATCH_SIZE).map((transaction) => ({
      account: transaction.accountType,
      amount: transaction.spend,
      bankCategory: transaction.bankCategory,
      description: transaction.description,
      id: transaction.id,
      merchant: transaction.merchant,
    }));

    try {
      const response = await client.messages.parse({
        max_tokens: 8000,
        messages: [{ content: JSON.stringify(batch), role: 'user' }],
        model: LLM_MODEL,
        output_config: { effort: 'low', format: zodOutputFormat(LLM_RESULT_SCHEMA) },
        system: SYSTEM_PROMPT,
      });
      for (const result of response.parsed_output?.results ?? []) {
        results.set(result.id, {
          category: result.category,
          review: !result.confident || result.category === UNCATEGORIZED,
          source: 'llm',
        });
      }
    } catch (error) {
      console.error('LLM categorization failed', { batchStart: start, error: String(error) });
    }
  }

  return results;
};

export const LLM_FAILURE: Categorization = { category: UNCATEGORIZED, review: true, source: 'llm-error' };
