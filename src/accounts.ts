import type { LedgerRow } from './ledger';

export const ACCOUNTS_SHEET = 'Accounts';

export const ACCOUNTS_HEADERS = ['Account (from bank)', 'Nickname', "Bank's product name"] as const;

export const parseNicknames = (rows: unknown[][]) => {
  const known = new Set<string>();
  const nicknames = new Map<string, string>();
  for (const [bankAccount, nickname] of rows) {
    if (typeof bankAccount !== 'string' || !bankAccount.trim()) {
      continue;
    }
    known.add(bankAccount);
    if (typeof nickname === 'string' && nickname.trim()) {
      nicknames.set(bankAccount, nickname.trim());
    }
  }
  return { known, nicknames };
};

export const displayAccount = ({ bankAccount, nicknames }: { bankAccount: string; nicknames: Map<string, string> }) =>
  nicknames.get(bankAccount) ?? bankAccount;

export const planRelabels = ({ ledger, nicknames }: { ledger: LedgerRow[]; nicknames: Map<string, string> }) =>
  ledger.flatMap((row) => {
    const account = displayAccount({ bankAccount: row.bankAccount, nicknames });
    return row.account === account ? [] : [{ account, bankAccount: row.bankAccount, rowNumber: row.rowNumber }];
  });
