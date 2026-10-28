export type TellerAccount = {
  id: string;
  institution: { id: string; name: string };
  last_four: string;
  name: string;
  status: string;
  subtype: string;
  type: 'credit' | 'depository';
};

export type TellerTransaction = {
  account_id: string;
  amount: string;
  date: string;
  description: string;
  details?: {
    category: string | null;
    counterparty: { name: string | null; type: string | null } | null;
    processing_status: string;
  };
  id: string;
  status: 'pending' | 'posted';
  type: string;
};

export type NormalizedTransaction = {
  accountLabel: string;
  accountType: TellerAccount['type'];
  date: string;
  description: string;
  id: string;
  merchant: string;
  spend: number;
  status: TellerTransaction['status'];
  tellerCategory: string | null;
};

export type TellerFetch = (input: string, init?: RequestInit) => Promise<Response>;

export class TellerError extends Error {
  public readonly status: number;

  public constructor({ message, status }: { message: string; status: number }) {
    super(message);
    this.status = status;
  }
}

const PAGE_SIZE = 250;

export const createTellerClient = ({ accessToken, fetcher }: { accessToken: string; fetcher: TellerFetch }) => {
  const get = async <T>(path: string): Promise<T> => {
    const response = await fetcher(`https://api.teller.io${path}`, {
      headers: { Authorization: `Basic ${btoa(`${accessToken}:`)}` },
    });
    if (!response.ok) {
      throw new TellerError({
        message: `Teller GET ${path} failed with ${response.status}: ${await response.text()}`,
        status: response.status,
      });
    }
    return (await response.json()) as T;
  };

  const listTransactions = async ({ accountId, startDate }: { accountId: string; startDate: string }) => {
    const transactions: TellerTransaction[] = [];
    let fromId: string | undefined;
    for (;;) {
      const params = new URLSearchParams({ count: String(PAGE_SIZE), start_date: startDate });
      if (fromId) {
        params.set('from_id', fromId);
      }
      const page = await get<TellerTransaction[]>(`/accounts/${accountId}/transactions?${params}`);
      transactions.push(...page);
      const last = page.at(-1);
      if (page.length < PAGE_SIZE || !last) {
        return transactions;
      }
      fromId = last.id;
    }
  };

  return {
    listAccounts: () => get<TellerAccount[]>('/accounts'),
    listTransactions,
  };
};

export const accountLabel = (account: TellerAccount) =>
  `${account.institution.name} ${account.name} ••${account.last_four}`;

export const normalizeTransaction = ({
  account,
  spendSign,
  transaction,
}: {
  account: TellerAccount;
  spendSign: number;
  transaction: TellerTransaction;
}): NormalizedTransaction => ({
  accountLabel: accountLabel(account),
  accountType: account.type,
  date: transaction.date,
  description: transaction.description,
  id: transaction.id,
  merchant: transaction.details?.counterparty?.name ?? '',
  spend: Math.round(Number(transaction.amount) * spendSign * 100) / 100,
  status: transaction.status,
  tellerCategory: transaction.details?.category ?? null,
});
