export const BUDGET_CATEGORIES = [
  'Rent',
  'Utilities',
  'Wifi',
  'Phone Plan',
  'Spotify',
  'Gym',
  'Groceries',
  'Eating Out',
  'Shopping',
  'Transportation',
  'Travel',
  'Health',
  'Misc',
] as const;

export const INCOME = 'Income';
export const TRANSFER = 'Transfer';
export const UNCATEGORIZED = 'Uncategorized';

export const ALL_CATEGORIES = [...BUDGET_CATEGORIES, INCOME, TRANSFER, UNCATEGORIZED] as const;

export type Category = (typeof ALL_CATEGORIES)[number];

export const isCategory = (value: unknown): value is Category =>
  typeof value === 'string' && (ALL_CATEGORIES as readonly string[]).includes(value);
