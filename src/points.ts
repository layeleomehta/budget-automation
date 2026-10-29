import { type AccountInfo, accountsMatching } from './accounts';
import { INCOME, TRANSFER } from './categories';
import type { LedgerRow } from './ledger';

export const POINTS_SHEET = 'Points';

const CENTS_PER_POINT = 1;

type EarnRule = { matches: (row: LedgerRow) => boolean; rate: number };

export type CardEarning = {
  baseRate: number;
  cardName: string;
  cardPattern: RegExp;
  minimumRate?: (row: LedgerRow) => number;
  rules: EarnRule[];
};

const text = (row: LedgerRow) => `${row.merchant} ${row.description}`.toUpperCase();
const describes = (pattern: RegExp) => (row: LedgerRow) => pattern.test(text(row));
const inCategory = (category: string) => (row: LedgerRow) => row.category === category;

const CHASE_TRAVEL = describes(/CHASE TRAVEL/);
const LYFT = describes(/\bLYFT\b/);
const GAS_AND_EV = describes(/CHEVRON|SHELL OIL|\bARCO\b|EXXON|\bMOBIL\b|VALERO|TESLA|CHARGEPOINT|EVGO|ELECTRIFY AMERICA/);
const STREAMING = describes(/NETFLIX|HULU|DISNEY PLUS|DISNEYPLUS|SPOTIFY|HBO ?MAX|YOUTUBE ?TV|YOUTUBE PREMIUM|PEACOCK|PARAMOUNT/);
const ONLINE_GROCERY = describes(/INSTACART|AMAZON FRESH/);
const DRUGSTORE = describes(/\bCVS\b|WALGREENS|RITE AID/);
const AMAZON_AND_WHOLE_FOODS = describes(/AMAZON|AMZN|WHOLE ?FOODS|WHOLEFDS|AUDIBLE/);
const DINING = inCategory('Eating Out');
const TRAVEL = inCategory('Travel');
const TRANSPORTATION = inCategory('Transportation');

export const CARD_EARNINGS: CardEarning[] = [
  {
    baseRate: 1,
    cardName: 'Chase Sapphire Preferred',
    cardPattern: /SAPPHIRE PREFERRED/i,
    rules: [
      { matches: CHASE_TRAVEL, rate: 5 },
      { matches: LYFT, rate: 5 },
      { matches: DINING, rate: 3 },
      { matches: GAS_AND_EV, rate: 3 },
      { matches: STREAMING, rate: 3 },
      { matches: ONLINE_GROCERY, rate: 3 },
      { matches: TRAVEL, rate: 2 },
      { matches: TRANSPORTATION, rate: 2 },
    ],
  },
  {
    baseRate: 1.5,
    cardName: 'Chase Freedom Unlimited',
    cardPattern: /FREEDOM UNLIMITED/i,
    rules: [
      { matches: CHASE_TRAVEL, rate: 5 },
      { matches: DINING, rate: 3 },
      { matches: DRUGSTORE, rate: 3 },
      { matches: LYFT, rate: 2 },
    ],
  },
  {
    baseRate: 1,
    cardName: 'Chase Prime Visa',
    cardPattern: /PRIME VISA/i,
    rules: [
      { matches: AMAZON_AND_WHOLE_FOODS, rate: 5 },
      { matches: CHASE_TRAVEL, rate: 5 },
      { matches: DINING, rate: 2 },
      { matches: GAS_AND_EV, rate: 2 },
      { matches: TRANSPORTATION, rate: 2 },
    ],
  },
  {
    baseRate: 1,
    cardName: 'Bilt',
    cardPattern: /BILT/i,
    minimumRate: (row) => (row.date.endsWith('-01') && row.date <= '2027-01-01' ? 2 : 0),
    rules: [{ matches: LYFT, rate: 3 }],
  },
];

const EARNS_NOTHING = describes(/ANNUAL MEMBERSHIP FEE|INTEREST CHARGE|LATE FEE|HOTEL CREDIT|GLOBAL ENTRY|TSA ?PRE|NEXUS/);
const CARD_PAYMENT_OR_RENT = describes(/PAYMENT|AUTOPAY|BILT HOUSING/);

const isMoneyMovement = (row: LedgerRow) =>
  row.category === INCOME || (row.category === TRANSFER && (row.amount < 0 || CARD_PAYMENT_OR_RENT(row)));

export const earnRate = ({ card, row }: { card: CardEarning; row: LedgerRow }) => {
  if (isMoneyMovement(row) || EARNS_NOTHING(row)) {
    return 0;
  }
  const rate = card.rules.find((rule) => rule.matches(row))?.rate ?? card.baseRate;
  return Math.max(rate, card.minimumRate?.(row) ?? 0);
};

export type MonthlyPoints = { byCard: Map<string, number>; month: string; total: number };

export const computeMonthlyPoints = ({
  accounts,
  cards,
  ledger,
}: {
  accounts: AccountInfo[];
  cards: CardEarning[];
  ledger: LedgerRow[];
}) => {
  const linked = cards.flatMap((card) => {
    const cardAccounts = accountsMatching({ accounts, pattern: card.cardPattern });
    if (cardAccounts.length === 0) {
      return [];
    }
    return [
      {
        bankAccounts: new Set(cardAccounts.map((account) => account.bankAccount)),
        card,
        label: cardAccounts.find((account) => account.nickname)?.nickname ?? card.cardName,
      },
    ];
  });

  const months = new Map<string, Map<string, number>>();
  for (const row of ledger) {
    const owner = linked.find(({ bankAccounts }) => bankAccounts.has(row.bankAccount));
    const month = row.date.slice(0, 7);
    if (!owner || !/^\d{4}-\d{2}$/.test(month)) {
      continue;
    }
    const byCard = months.get(month) ?? new Map<string, number>();
    byCard.set(owner.label, (byCard.get(owner.label) ?? 0) + row.amount * earnRate({ card: owner.card, row }));
    months.set(month, byCard);
  }

  const rows: MonthlyPoints[] = [...months.keys()]
    .toSorted()
    .toReversed()
    .map((month) => {
      const byCard = new Map(
        linked.map(({ label }) => [label, Math.round(months.get(month)?.get(label) ?? 0)] as const),
      );
      return { byCard, month, total: [...byCard.values()].reduce((sum, points) => sum + points, 0) };
    });

  return { cards: linked.map(({ label }) => label), rows };
};

export const toPointsValues = ({ cards, rows }: { cards: string[]; rows: MonthlyPoints[] }) => [
  ['Month', ...cards, 'Total points', 'Approx. value (1¢/pt)'],
  ...rows.map((row) => [
    row.month,
    ...cards.map((card) => row.byCard.get(card) ?? 0),
    row.total,
    (row.total * CENTS_PER_POINT) / 100,
  ]),
];
