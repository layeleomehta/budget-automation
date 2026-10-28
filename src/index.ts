import { renderConnectPage } from './connect-page';
import { type Enrollment, type Env, fetchTransactions, runSync, saveEnrollment } from './sync';

const SCHEDULED_SYNC_DAYS = 14;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { headers: { 'Content-Type': 'application/json' }, status });

const isEnrollment = (value: unknown): value is Enrollment => {
  const candidate = value as Partial<Enrollment> | null;
  return (
    typeof candidate?.accessToken === 'string' &&
    typeof candidate.enrollmentId === 'string' &&
    typeof candidate.institution === 'string'
  );
};

const daysParam = (url: URL) => {
  const days = Number(url.searchParams.get('days') ?? SCHEDULED_SYNC_DAYS);
  return Number.isInteger(days) && days > 0 && days <= 730 ? days : SCHEDULED_SYNC_DAYS;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) {
      return new Response('Not found', { status: 404 });
    }

    const route = `${request.method} ${url.pathname}`;

    if (route === 'GET /connect') {
      return new Response(
        renderConnectPage({
          adminKey: env.ADMIN_KEY,
          applicationId: env.TELLER_APPLICATION_ID,
          environment: env.TELLER_ENVIRONMENT,
        }),
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }

    if (route === 'POST /enrollments') {
      const body: unknown = await request.json().catch(() => null);
      if (!isEnrollment(body)) {
        return json({ error: 'Expected accessToken, enrollmentId and institution' }, 400);
      }
      await saveEnrollment({ enrollment: body, env });
      return json({ saved: body.institution });
    }

    if (route === 'GET /preview') {
      const { errors, transactions } = await fetchTransactions({
        env,
        startDate: new Date(Date.now() - daysParam(url) * 86_400_000).toISOString().slice(0, 10),
      });
      return json({ errors, transactions: transactions.slice(0, 50) });
    }

    if (route === 'POST /sync') {
      return json(await runSync({ days: daysParam(url), env }));
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runSync({ days: SCHEDULED_SYNC_DAYS, env }).then((summary) => console.log('Scheduled sync', summary)),
    );
  },
} satisfies ExportedHandler<Env>;
