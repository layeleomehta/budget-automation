import { type AccountInfo, accountsMatching } from './accounts';
import { isoDateToSerial, type LedgerRow } from './ledger';

export const BENEFITS_SHEET = 'Benefits';

export const BENEFITS_HEADERS = [
  'Card',
  'Benefit',
  'Value',
  'Period',
  'Resets / deadline',
  'Days left',
  'Used',
  'Remaining',
  'Status',
  'Done',
  'How to redeem',
] as const;

type Period =
  | { feePattern: RegExp; kind: 'anniversary' }
  | { kind: 'monthly' }
  | { kind: 'one-time'; deadline: string }
  | { kind: 'rolling-years'; years: number };

export type Benefit = {
  cardName: string;
  cardPattern: RegExp;
  creditPattern?: RegExp;
  howToRedeem: string;
  name: string;
  period: Period;
  value: number;
};

export type BenefitStatus = 'Missed' | 'Partly used' | 'Unused' | 'Used';

export type BenefitResult = {
  card: string;
  daysLeft?: number;
  done: boolean;
  howToRedeem: string;
  name: string;
  periodLabel: string;
  remaining: number;
  resetsOn?: string;
  status: BenefitStatus;
  used: number;
  value: number;
};

const SAPPHIRE_PREFERRED = { cardName: 'Chase Sapphire Preferred', cardPattern: /SAPPHIRE PREFERRED/i };

export const BENEFITS: Benefit[] = [
  {
    ...SAPPHIRE_PREFERRED,
    creditPattern: /HOTEL CREDIT/i,
    howToRedeem: 'Book a prepaid hotel through Chase Travel with the Sapphire. The credit posts automatically.',
    name: '$100 Chase Travel hotel credit',
    period: { feePattern: /ANNUAL MEMBERSHIP FEE/i, kind: 'anniversary' },
    value: 100,
  },
  {
    ...SAPPHIRE_PREFERRED,
    howToRedeem: 'Place a DoorDash grocery, convenience or retail order with DashPass active. The $10 comes off at checkout, so tick Done once used.',
    name: '$10 DoorDash promo',
    period: { kind: 'monthly' },
    value: 10,
  },
  {
    ...SAPPHIRE_PREFERRED,
    creditPattern: /GLOBAL ENTRY|TSA ?PRE|NEXUS/i,
    howToRedeem: 'Pay the TSA PreCheck, Global Entry or NEXUS application fee with the Sapphire. The credit posts automatically.',
    name: '$120 Global Entry / TSA PreCheck credit',
    period: { kind: 'rolling-years', years: 4 },
    value: 120,
  },
  {
    ...SAPPHIRE_PREFERRED,
    howToRedeem: 'Activate on chase.com under the Sapphire Preferred benefits page. Tick Done once activated.',
    name: 'Apple TV (1 year)',
    period: { deadline: '2026-12-31', kind: 'one-time' },
    value: 180,
  },
  {
    ...SAPPHIRE_PREFERRED,
    howToRedeem: 'Add the Sapphire to DoorDash and activate DashPass from the DoorDash app. Tick Done once activated.',
    name: 'DashPass membership',
    period: { deadline: '2029-12-31', kind: 'one-time' },
    value: 120,
  },
];

export type CardPerk = { cardName: string; cardPattern: RegExp; howToUse: string; perk: string };

const FREEDOM_UNLIMITED = { cardName: 'Chase Freedom Unlimited', cardPattern: /FREEDOM UNLIMITED/i };
const PRIME_VISA = { cardName: 'Chase Prime Visa', cardPattern: /PRIME VISA/i };
const BILT_BLUE = { cardName: 'Bilt Blue', cardPattern: /BILT/i };

export const CARD_PERKS: CardPerk[] = [
  { ...SAPPHIRE_PREFERRED, howToUse: 'Restaurants, gas and EV charging, streaming, and online groceries (not Walmart, Target or wholesale clubs).', perk: '3x points on dining, gas, streaming, online groceries' },
  { ...SAPPHIRE_PREFERRED, howToUse: 'Pay for Lyft rides with the Sapphire.', perk: '5x points on Lyft' },
  { ...SAPPHIRE_PREFERRED, howToUse: 'Book flights, hotels and rental cars through Chase Travel. Other travel earns 2x.', perk: '5x points on Chase Travel' },
  { ...SAPPHIRE_PREFERRED, howToUse: "Pay for the rental with the Sapphire and decline the rental company's collision coverage.", perk: 'Primary rental car insurance' },
  { ...SAPPHIRE_PREFERRED, howToUse: 'Pay for the trip with the Sapphire to be covered for trip cancellation, trip delay and baggage delay.', perk: 'Travel protections' },
  { ...SAPPHIRE_PREFERRED, howToUse: 'Move points to airline and hotel partners when that beats the Chase Travel price.', perk: 'Point transfers to airlines and hotels' },
  { ...SAPPHIRE_PREFERRED, howToUse: 'Buy electronics and other expensive items with the Sapphire.', perk: 'Purchase protection and extended warranty' },
  { ...SAPPHIRE_PREFERRED, howToUse: 'Use it abroad.', perk: 'No foreign transaction fees' },
  { ...FREEDOM_UNLIMITED, howToUse: "Default card for anything outside the Sapphire's 3x categories and Amazon.", perk: '1.5x on everything, 3x on dining and drugstores' },
  { ...FREEDOM_UNLIMITED, howToUse: 'Combine Freedom points into the Sapphire account so they can be transferred to partners.', perk: 'Points pool with the Sapphire' },
  { ...PRIME_VISA, howToUse: 'All Amazon and Whole Foods purchases, including the Prime membership.', perk: '5% back at Amazon and Whole Foods' },
  { ...PRIME_VISA, howToUse: 'Restaurants, gas stations and local transit.', perk: '2% back on dining, gas and transit' },
  { ...BILT_BLUE, howToUse: 'Pay rent through Bilt to earn points on it.', perk: 'Points on rent' },
  { ...BILT_BLUE, howToUse: 'Put big purchases on the 1st of the month (through Jan 1, 2027).', perk: 'Double points on the 1st' },
  { ...BILT_BLUE, howToUse: 'Eat at Bilt dining partners (listed in the Bilt app) and pay with the Bilt card.', perk: '4x at Bilt dining partners' },
  { ...BILT_BLUE, howToUse: 'Pay your monthly phone bill with the Bilt card.', perk: 'Cell phone protection' },
  { ...BILT_BLUE, howToUse: 'Use it abroad.', perk: 'No foreign transaction fees' },
];

export const linkedPerks = ({ accounts, perks }: { accounts: AccountInfo[]; perks: CardPerk[] }) =>
  perks.flatMap((perk) => {
    const cardAccounts = accountsMatching({ accounts, pattern: perk.cardPattern });
    return cardAccounts.length === 0
      ? []
      : [[cardAccounts.find((account) => account.nickname)?.nickname ?? perk.cardName, perk.perk, perk.howToUse]];
  });

const DAY_MS = 86_400_000;

const addYears = ({ isoDate, years }: { isoDate: string; years: number }) =>
  `${Number(isoDate.slice(0, 4)) + years}${isoDate.slice(4)}`;

const addDays = ({ days, isoDate }: { days: number; isoDate: string }) =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

const daysBetween = ({ from, to }: { from: string; to: string }) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

const firstOfNextMonth = (isoDate: string) => {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
};

export const benefitKey = ({ name, periodLabel }: { name: string; periodLabel: string }) => `${name}|${periodLabel}`;

const roundCents = (value: number) => Math.round(value * 100) / 100;

const periodWindow = ({ cardRows, period, today }: { cardRows: LedgerRow[]; period: Period; today: string }) => {
  if (period.kind === 'monthly') {
    const start = `${today.slice(0, 7)}-01`;
    return { end: firstOfNextMonth(today), label: today.slice(0, 7), start };
  }
  if (period.kind === 'one-time') {
    return { end: addDays({ days: 1, isoDate: period.deadline }), label: 'One-time', start: '' };
  }
  if (period.kind === 'rolling-years') {
    return { end: addDays({ days: 1, isoDate: today }), label: `Every ${period.years} years`, start: addYears({ isoDate: today, years: -period.years }) };
  }
  const feeDates = cardRows
    .filter((row) => row.amount > 0 && row.date <= today && period.feePattern.test(row.description))
    .map((row) => row.date)
    .toSorted();
  const start = feeDates.at(-1) ?? `${today.slice(0, 4)}-01-01`;
  const end = addYears({ isoDate: start, years: 1 });
  return { end, label: `${start} to ${addDays({ days: -1, isoDate: end })}`, start };
};

const statusOf = ({ pastDeadline, used, value }: { pastDeadline: boolean; used: number; value: number }): BenefitStatus => {
  if (used >= value) {
    return 'Used';
  }
  if (used > 0) {
    return 'Partly used';
  }
  return pastDeadline ? 'Missed' : 'Unused';
};

const STATUS_ORDER: BenefitStatus[] = ['Unused', 'Partly used', 'Used', 'Missed'];

export const computeBenefits = ({
  accounts,
  benefits,
  done,
  ledger,
  today,
}: {
  accounts: AccountInfo[];
  benefits: Benefit[];
  done: Set<string>;
  ledger: LedgerRow[];
  today: string;
}): BenefitResult[] => {
  const results = benefits.flatMap((benefit) => {
    const cardAccounts = accountsMatching({ accounts, pattern: benefit.cardPattern });
    const cardBankAccounts = new Set(cardAccounts.map((account) => account.bankAccount));
    const cardRows = ledger.filter((row) => cardBankAccounts.has(row.bankAccount) || benefit.cardPattern.test(row.account));
    if (cardAccounts.length === 0 && cardRows.length === 0) {
      return [];
    }

    const window = periodWindow({ cardRows, period: benefit.period, today });
    const credits = benefit.creditPattern
      ? cardRows.filter(
          (row) =>
            row.amount < 0 &&
            row.date >= window.start &&
            row.date < window.end &&
            (benefit.creditPattern?.test(`${row.merchant} ${row.description}`) ?? false),
        )
      : [];
    const isDone = done.has(benefitKey({ name: benefit.name, periodLabel: window.label }));
    const credited = roundCents(credits.reduce((sum, row) => sum - row.amount, 0));
    const used = isDone ? benefit.value : Math.min(benefit.value, credited);

    const lastCredit = credits.map((row) => row.date).toSorted().at(-1);
    const resetsOn =
      benefit.period.kind === 'rolling-years'
        ? lastCredit && addYears({ isoDate: lastCredit, years: benefit.period.years })
        : benefit.period.kind === 'one-time'
          ? benefit.period.deadline
          : window.end;
    const pastDeadline = benefit.period.kind === 'one-time' && today > benefit.period.deadline;

    return [
      {
        card: cardAccounts.find((account) => account.nickname)?.nickname ?? benefit.cardName,
        ...(resetsOn ? { daysLeft: daysBetween({ from: today, to: resetsOn }), resetsOn } : {}),
        done: isDone,
        howToRedeem: benefit.howToRedeem,
        name: benefit.name,
        periodLabel: window.label,
        remaining: roundCents(benefit.value - used),
        status: statusOf({ pastDeadline, used, value: benefit.value }),
        used,
        value: benefit.value,
      },
    ];
  });

  return results.toSorted(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
      (a.daysLeft ?? Number.POSITIVE_INFINITY) - (b.daysLeft ?? Number.POSITIVE_INFINITY),
  );
};

export const parseDoneBenefits = (rows: unknown[][]) =>
  new Set(
    rows.flatMap(([, name, , periodLabel, , , , , , done]) =>
      typeof name === 'string' && (done === true || done === 'TRUE')
        ? [benefitKey({ name, periodLabel: String(periodLabel ?? '') })]
        : [],
    ),
  );

export const toBenefitValues = (results: BenefitResult[]) =>
  results.map((result) => [
    result.card,
    result.name,
    result.value,
    result.periodLabel,
    result.resetsOn ? isoDateToSerial(result.resetsOn) : '',
    result.daysLeft ?? '',
    result.used,
    result.remaining,
    result.status,
    result.done,
    result.howToRedeem,
  ]);
