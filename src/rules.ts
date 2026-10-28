import { type Category, isCategory } from './categories';
import type { NormalizedTransaction } from './plaid';

export type Rule = { category: Category; pattern: string };

export const SEED_RULES: Rule[] = [
  { category: 'Transfer', pattern: 'AUTOPAY' },
  { category: 'Transfer', pattern: 'PAYMENT THANK YOU' },
  { category: 'Transfer', pattern: 'CHASE CREDIT CRD' },
  { category: 'Spotify', pattern: 'SPOTIFY' },
  { category: 'Eating Out', pattern: 'UBER EATS' },
  { category: 'Eating Out', pattern: 'DOORDASH' },
  { category: 'Transportation', pattern: 'UBER' },
  { category: 'Transportation', pattern: 'LYFT' },
];

const searchableText = (transaction: Pick<NormalizedTransaction, 'description' | 'merchant'>) =>
  `${transaction.merchant} ${transaction.description}`.toUpperCase();

export const isVenmo = (transaction: Pick<NormalizedTransaction, 'description' | 'merchant'>) =>
  searchableText(transaction).includes('VENMO');

export const matchRule = ({
  rules,
  transaction,
}: {
  rules: Rule[];
  transaction: Pick<NormalizedTransaction, 'description' | 'merchant'>;
}): Rule | undefined => {
  const text = searchableText(transaction);
  return rules
    .toSorted((a, b) => b.pattern.length - a.pattern.length)
    .find((rule) => text.includes(rule.pattern.toUpperCase()));
};

export const merchantKey = (transaction: Pick<NormalizedTransaction, 'description' | 'merchant'>) =>
  (transaction.merchant || transaction.description)
    .toUpperCase()
    .replace(/[#*]?\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const parseRules = (rows: unknown[][]): Rule[] =>
  rows.flatMap(([pattern, category]) => {
    if (typeof pattern !== 'string' || !pattern.trim() || !isCategory(category)) {
      return [];
    }
    return [{ category, pattern: pattern.trim() }];
  });
