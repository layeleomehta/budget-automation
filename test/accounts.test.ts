import { describe, expect, it } from 'vitest';
import { parseNicknames, planRelabels } from '../src/accounts';
import type { LedgerRow } from '../src/ledger';

const row = (overrides: Partial<LedgerRow>): LedgerRow => ({
  account: 'Chase CREDIT CARD ••9944',
  amount: 10,
  autoCategory: 'Misc',
  bankAccount: 'Chase CREDIT CARD ••9944',
  category: 'Misc',
  date: '2026-10-20',
  description: 'X',
  id: crypto.randomUUID(),
  merchant: 'X',
  review: false,
  rowNumber: 2,
  source: 'llm',
  status: 'posted',
  ...overrides,
});

describe('parseNicknames', () => {
  it('keeps every listed account and only non-blank nicknames', () => {
    const { known, nicknames } = parseNicknames([
      ['Chase CREDIT CARD ••9944', ' Sapphire '],
      ['Chase CREDIT CARD ••8015', ''],
      ['', 'ignored'],
    ]);
    expect([...known]).toStrictEqual(['Chase CREDIT CARD ••9944', 'Chase CREDIT CARD ••8015']);
    expect([...nicknames]).toStrictEqual([['Chase CREDIT CARD ••9944', 'Sapphire']]);
  });
});

describe('planRelabels', () => {
  it.each<{ name: string; input: Partial<LedgerRow>; nicknames: [string, string][]; expected: unknown[] }>([
    {
      expected: [{ account: 'Sapphire', bankAccount: 'Chase CREDIT CARD ••9944', rowNumber: 2 }],
      input: {},
      name: 'renames rows to a new nickname',
      nicknames: [['Chase CREDIT CARD ••9944', 'Sapphire']],
    },
    {
      expected: [{ account: 'Sapphire Reserve', bankAccount: 'Chase CREDIT CARD ••9944', rowNumber: 2 }],
      input: { account: 'Sapphire' },
      name: 'follows a changed nickname',
      nicknames: [['Chase CREDIT CARD ••9944', 'Sapphire Reserve']],
    },
    {
      expected: [{ account: 'Chase CREDIT CARD ••9944', bankAccount: 'Chase CREDIT CARD ••9944', rowNumber: 2 }],
      input: { account: 'Sapphire' },
      name: 'restores the bank name when a nickname is cleared',
      nicknames: [],
    },
    {
      expected: [],
      input: { account: 'Sapphire' },
      name: 'leaves rows that already match alone',
      nicknames: [['Chase CREDIT CARD ••9944', 'Sapphire']],
    },
  ])('$name', ({ expected, input, nicknames }) => {
    expect(planRelabels({ ledger: [row(input)], nicknames: new Map(nicknames) })).toStrictEqual(expected);
  });
});
