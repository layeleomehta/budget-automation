export type PlaidAccount = {
  account_id: string;
  mask: string | null;
  name: string;
  official_name: string | null;
  subtype: string | null;
  type: 'credit' | 'depository' | 'investment' | 'loan' | 'other';
};

export type PlaidTransaction = {
  account_id: string;
  amount: number;
  date: string;
  merchant_name: string | null;
  name: string;
  pending: boolean;
  pending_transaction_id: string | null;
  personal_finance_category: { detailed: string; primary: string } | null;
  transaction_id: string;
};

export type NormalizedTransaction = {
  accountLabel: string;
  accountType: PlaidAccount['type'];
  bankCategory: string | null;
  date: string;
  description: string;
  id: string;
  merchant: string;
  pendingTransactionId: string | null;
  spend: number;
  status: 'pending' | 'posted';
};

export type SyncChanges = {
  accounts: PlaidAccount[];
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  nextCursor: string;
  removed: string[];
};

type SyncPage = {
  accounts: PlaidAccount[];
  added: PlaidTransaction[];
  has_more: boolean;
  modified: PlaidTransaction[];
  next_cursor: string;
  removed: { transaction_id: string }[];
};

export class PlaidError extends Error {
  public readonly code: string;

  public constructor({ code, message }: { code: string; message: string }) {
    super(message);
    this.code = code;
  }
}

const HOSTS: Record<string, string> = {
  production: 'https://production.plaid.com',
  sandbox: 'https://sandbox.plaid.com',
};

const SYNC_PAGE_SIZE = 500;
const MAX_PAGINATION_RESTARTS = 3;

export const createPlaidClient = ({
  clientId,
  environment,
  secret,
}: {
  clientId: string;
  environment: string;
  secret: string;
}) => {
  const host = HOSTS[environment];
  if (!host) {
    throw new Error(`Unknown PLAID_ENV "${environment}"`);
  }

  const post = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
    const response = await fetch(`${host}${path}`, {
      body: JSON.stringify({ client_id: clientId, secret, ...body }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const json = (await response.json()) as T & { error_code?: string; error_message?: string };
    if (!response.ok) {
      throw new PlaidError({
        code: json.error_code ?? String(response.status),
        message: `Plaid ${path} failed: ${json.error_code} ${json.error_message}`,
      });
    }
    return json;
  };

  const createLinkToken = async ({ accessToken, webhook }: { accessToken?: string; webhook: string }) => {
    const { link_token: linkToken } = await post<{ link_token: string }>('/link/token/create', {
      client_name: 'Budget Automation',
      country_codes: ['US'],
      language: 'en',
      user: { client_user_id: 'budget-owner' },
      webhook,
      ...(accessToken ? { access_token: accessToken } : { products: ['transactions'], transactions: { days_requested: 90 } }),
    });
    return linkToken;
  };

  const exchangePublicToken = async (publicToken: string) => {
    const { access_token: accessToken, item_id: itemId } = await post<{ access_token: string; item_id: string }>(
      '/item/public_token/exchange',
      { public_token: publicToken },
    );
    return { accessToken, itemId };
  };

  const syncTransactions = async ({ accessToken, cursor }: { accessToken: string; cursor: string | undefined }) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const changes: SyncChanges = { accounts: [], added: [], modified: [], nextCursor: cursor ?? '', removed: [] };
        for (;;) {
          const page = await post<SyncPage>('/transactions/sync', {
            access_token: accessToken,
            count: SYNC_PAGE_SIZE,
            ...(changes.nextCursor ? { cursor: changes.nextCursor } : {}),
          });
          changes.accounts = page.accounts;
          changes.added.push(...page.added);
          changes.modified.push(...page.modified);
          changes.removed.push(...page.removed.map((removed) => removed.transaction_id));
          changes.nextCursor = page.next_cursor;
          if (!page.has_more) {
            return changes;
          }
        }
      } catch (error) {
        const restartable =
          error instanceof PlaidError &&
          error.code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' &&
          attempt < MAX_PAGINATION_RESTARTS;
        if (!restartable) {
          throw error;
        }
      }
    }
  };

  return { createLinkToken, exchangePublicToken, syncTransactions };
};

export const accountLabel = ({ account, institution }: { account: PlaidAccount; institution: string }) =>
  `${institution} ${account.name}${account.mask ? ` ••${account.mask}` : ''}`;

export const normalizeTransaction = ({
  account,
  institution,
  transaction,
}: {
  account: PlaidAccount | undefined;
  institution: string;
  transaction: PlaidTransaction;
}): NormalizedTransaction => ({
  accountLabel: account ? accountLabel({ account, institution }) : institution,
  accountType: account?.type ?? 'other',
  bankCategory: transaction.personal_finance_category?.detailed ?? null,
  date: transaction.date,
  description: transaction.name,
  id: transaction.transaction_id,
  merchant: transaction.merchant_name ?? '',
  pendingTransactionId: transaction.pending_transaction_id,
  spend: Math.round(transaction.amount * 100) / 100,
  status: transaction.pending ? 'pending' : 'posted',
});
