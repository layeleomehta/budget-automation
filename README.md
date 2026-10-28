# budget-automation

Cloudflare Worker that pulls bank and card transactions from Teller every hour, categorizes them, and writes them to the budget Google Sheet.

- **Transactions** tab: append-only ledger. Change a row's Category to correct it; the next sync marks it `manual`, clears Review, and adds a merchant rule.
- **Rules** tab: `Pattern → Category`, case-insensitive substring match, longest pattern wins. Edit freely.
- **Month View** tab: type a month in `B1` (`2026-10`) to see category totals, income, savings rate, and that month's transactions.
- Use the **Needs review** filter view on Transactions to triage Venmos and anything the model wasn't sure about.

Amounts are spending-positive: purchases are positive, refunds/reimbursements/paychecks are negative. Categorize an incoming Venmo as whatever it paid back (e.g. Eating Out) and it nets against that category. `Transfer` rows (card payments) are excluded from totals.

## Setup

1. `pnpm install`
2. **Teller**: create an application at teller.io and download the certificate and private key.
   ```
   pnpm wrangler mtls-certificate upload --cert certificate.pem --key private_key.pem --name teller
   ```
   Put the returned id in `wrangler.jsonc` (`TELLER_CERT`) and set `TELLER_APPLICATION_ID`.
3. **KV**: `pnpm wrangler kv namespace create ENROLLMENTS` and put the id in `wrangler.jsonc`.
4. **Google**: in a GCP project, enable the Sheets API, create a service account and a JSON key, and share the budget sheet with the service account's email as Editor.
5. **Secrets**:
   ```
   pnpm wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON   # paste the whole JSON key
   pnpm wrangler secret put ANTHROPIC_API_KEY
   pnpm wrangler secret put ADMIN_KEY                     # any long random string
   pnpm wrangler secret put SPREADSHEET_ID                # the id from the sheet URL
   ```
6. `pnpm run deploy`
7. Open `https://budget-automation.<subdomain>.workers.dev/connect?key=<ADMIN_KEY>` and connect Chase.
8. Check amount signs: open `/preview?key=<ADMIN_KEY>&days=14`. Purchases should have a positive `spend`. If a whole account type is backwards, flip `CREDIT_SPEND_SIGN` or `DEPOSITORY_SPEND_SIGN` and redeploy.
9. Backfill: `curl -X POST 'https://…/sync?key=<ADMIN_KEY>&days=90'`. After that the hourly cron syncs the last 14 days.

## Development

```
pnpm typecheck
pnpm test
```
