# budget-automation

Cloudflare Worker that pulls bank and card transactions from Plaid, categorizes them, and writes them to the budget Google Sheet. It syncs whenever Plaid sends a transactions webhook, and hourly as a fallback.

- **Transactions** tab: append-only ledger. Change a row's Category to correct it; the next sync marks it `manual`, clears Review, and adds a merchant rule.
- **Rules** tab: `Pattern → Category`, case-insensitive substring match, longest pattern wins. Edit freely.
- **Month View** tab: type a month in `B1` (`2026-10`) to see category totals, income, savings rate, and that month's transactions.
- Use the **Needs review** filter view on Transactions to triage Venmos and anything the model wasn't sure about.

Amounts are spending-positive: purchases are positive, refunds/reimbursements/paychecks are negative. Categorize an incoming Venmo as whatever it paid back (e.g. Eating Out) and it nets against that category. `Transfer` rows (card payments) are excluded from totals.

## Setup

1. `pnpm install`
2. **Google**: in a GCP project, enable the Sheets API, create a service account and a JSON key, and share the budget sheet with the service account's email as Editor.
3. **Secrets**:
   ```
   pnpm wrangler secret put PLAID_CLIENT_ID
   pnpm wrangler secret put PLAID_SECRET                  # production secret
   pnpm wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON   # paste the whole JSON key
   pnpm wrangler secret put ANTHROPIC_API_KEY
   pnpm wrangler secret put ADMIN_KEY                     # any long random string
   pnpm wrangler secret put SPREADSHEET_ID                # the id from the sheet URL
   ```
4. Deploy by pushing to `main` (GitHub Actions), or `pnpm run deploy`.
5. Open `https://budget-automation.<subdomain>.workers.dev/connect?key=<ADMIN_KEY>` and connect each bank. The Plaid webhook is registered automatically.
6. Run the first sync: `curl -X POST 'https://…/sync?key=<ADMIN_KEY>'`. The first sync pulls the last 90 days.

If a bank needs you to log in again, `GET /items?key=…` lists connected items; open `/connect?key=…&item=<itemId>` to repair it without using a new Plaid Item.

## Development

```
pnpm typecheck
pnpm test
```
