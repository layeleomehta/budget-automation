import { renderLinkPage } from './link-page';
import { type Category, isCategory } from './categories';
import { parseRules } from './rules';
import { addManualTransaction, addRules, type Env, formatSheet, listReview, setCategory, getItem, listItems, monthBreakdown, plaidClient, redateTransactions, resetLedger, runSync, saveItem } from './sync';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { headers: { 'Content-Type': 'application/json' }, status });

const webhookUrl = ({ env, url }: { env: Env; url: URL }) =>
  `${url.origin}/plaid-webhook?key=${encodeURIComponent(env.ADMIN_KEY)}`;

const isItemRequest = (value: unknown): value is { institution: string; publicToken: string } => {
  const candidate = value as { institution?: unknown; publicToken?: unknown } | null;
  return typeof candidate?.institution === 'string' && typeof candidate.publicToken === 'string';
};

const SYNC_WEBHOOK_CODES = new Set(['SYNC_UPDATES_AVAILABLE', 'DEFAULT_UPDATE', 'INITIAL_UPDATE', 'HISTORICAL_UPDATE']);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) {
      return new Response('Not found', { status: 404 });
    }

    const route = `${request.method} ${url.pathname}`;

    if (route === 'GET /connect') {
      return new Response(renderLinkPage({ adminKey: env.ADMIN_KEY, itemId: url.searchParams.get('item') }), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (route === 'POST /link-token') {
      const itemId = url.searchParams.get('item');
      const item = itemId ? await getItem({ env, itemId }) : null;
      if (itemId && !item) {
        return json({ error: `Unknown item ${itemId}` }, 404);
      }
      const linkToken = await plaidClient(env).createLinkToken({
        ...(item ? { accessToken: item.accessToken } : {}),
        webhook: webhookUrl({ env, url }),
      });
      return json({ linkToken });
    }

    if (route === 'POST /items') {
      const body: unknown = await request.json().catch(() => null);
      if (!isItemRequest(body)) {
        return json({ error: 'Expected publicToken and institution' }, 400);
      }
      const { accessToken, itemId } = await plaidClient(env).exchangePublicToken(body.publicToken);
      await saveItem({ env, item: { accessToken, institution: body.institution, itemId } });
      return json({ institution: body.institution, itemId });
    }

    if (route === 'GET /items') {
      const items = await listItems(env);
      return json(items.map(({ institution, itemId }) => ({ institution, itemId })));
    }

    if (route === 'POST /plaid-webhook') {
      const body = (await request.json().catch(() => null)) as { webhook_code?: string; webhook_type?: string } | null;
      console.log('Plaid webhook', body);
      if (body?.webhook_type === 'TRANSACTIONS' && SYNC_WEBHOOK_CODES.has(body.webhook_code ?? '')) {
        ctx.waitUntil(runSync(env).then((summary) => console.log('Webhook sync', summary)));
      }
      return json({ received: true });
    }

    if (route === 'POST /sync') {
      return json(await runSync(env));
    }

    if (route === 'POST /manual-transaction') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      const valid =
        typeof body?.date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(body.date) &&
        typeof body.amount === 'number' &&
        typeof body.description === 'string' &&
        typeof body.bankAccount === 'string' &&
        isCategory(body.category);
      if (!valid) {
        return json({ error: 'Expected date, amount, description, bankAccount and category' }, 400);
      }
      return json(
        await addManualTransaction({
          amount: body.amount as number,
          bankAccount: body.bankAccount as string,
          category: body.category as Category,
          date: body.date as string,
          description: body.description as string,
          env,
        }),
      );
    }

    if (route === 'GET /review') {
      return json(await listReview(env));
    }

    if (route === 'POST /set-category') {
      const [date, match, category, id] = ['date', 'match', 'category', 'id'].map((name) => url.searchParams.get(name) ?? '');
      const byId = Boolean(id);
      const byMatch = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') && Boolean(match);
      if ((!byId && !byMatch) || !isCategory(category)) {
        return json({ error: 'Expected id, or date=YYYY-MM-DD and match, plus a valid category' }, 400);
      }
      return json(await setCategory({ category, date: date ?? '', env, id: id ?? '', match: match ?? '' }));
    }

    if (route === 'POST /rules') {
      const body: unknown = await request.json().catch(() => null);
      const rules = parseRules(Array.isArray(body) ? body.map((rule: { category?: unknown; pattern?: unknown }) => [rule?.pattern, rule?.category]) : []);
      if (rules.length === 0) {
        return json({ error: 'Expected [{ pattern, category }]' }, 400);
      }
      return json(await addRules({ env, rules }));
    }

    if (route === 'GET /month') {
      const month = url.searchParams.get('month') ?? '';
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return json({ error: 'Expected month=YYYY-MM' }, 400);
      }
      return json(await monthBreakdown({ env, month }));
    }

    if (route === 'POST /redate') {
      const [from, to, match] = ['from', 'to', 'match'].map((name) => url.searchParams.get(name) ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? '') || !match) {
        return json({ error: 'Expected from=YYYY-MM-DD, to=YYYY-MM-DD and match' }, 400);
      }
      return json(await redateTransactions({ env, from: from ?? '', match: match ?? '', to: to ?? '' }));
    }

    if (route === 'POST /format') {
      return json(await formatSheet(env));
    }

    if (route === 'POST /reset') {
      return json(await resetLedger(env));
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runSync(env).then((summary) => console.log('Scheduled sync', summary)));
  },
} satisfies ExportedHandler<Env>;
