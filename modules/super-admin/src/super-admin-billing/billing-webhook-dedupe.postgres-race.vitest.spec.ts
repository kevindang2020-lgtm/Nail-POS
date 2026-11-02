// billing-webhook-dedupe.postgres-race — BUILD_PLAN Phase 14 (Constitution 12 "webhook dedupe verified per provider"):
// the platform billing webhook ingest (POST /super-admin/billing/webhooks/ingest, Super Admin session — the provider's
// event relayed by an operator or a connector) on REAL Postgres with real concurrency. The same provider event delivered
// in sequence and racing over separate connections is ONE billing_webhook_events row, the invoice is paid once, and every
// repeat answers duplicate — none of them fails (a racing loser used to throw a unique violation → 400).
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyBillingRepository } from './billing.kysely.repository';

const url = process.env.PG_RACE_URL;
const TAG = `p14b${process.pid}`;
const T = randomUUID();

describe.skipIf(!url)('platform billing webhook ingest on real Postgres', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  beforeAll(async () => {
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, ${TAG}, ${TAG}, ${TAG}, ${TAG.toUpperCase().slice(0, 12)}, 'active')`.execute(dbs[0]);
  });
  afterAll(async () => {
    if (dbs[0]) {
      await sql`delete from billing_webhook_events where provider_event_id like ${TAG + '%'}`.execute(dbs[0]);
      await sql`delete from billing_invoices where tenant_id = ${T}`.execute(dbs[0]);
      await sql`delete from tenants where id = ${T}`.execute(dbs[0]);
    }
    await Promise.all(dbs.map((d) => d.destroy()));
  });

  it('one event, eight concurrent deliveries over four pools: one ledger row, invoice paid once, seven duplicates, no failure', async () => {
    const inv = `${TAG}-INV-1`;
    await sql`insert into billing_invoices (invoice_number, tenant_id, status, total_cents, amount_due_cents) values (${inv}, ${T}, 'open', 4900, 4900)`.execute(dbs[0]);
    const ev = { providerEventId: `${TAG}-evt-1`, eventType: 'invoice.payment_succeeded', invoiceNumber: inv };
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => new KyselyBillingRepository(dbs[i % 4]).ingestWebhook(ev)));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    const vals = out.map((o: any) => o.value);
    expect(vals.filter((v) => v.processed).length).toBe(1);
    expect(vals.filter((v) => v.duplicate).length).toBe(7);
    expect((await sql<any>`select count(*)::int n from billing_webhook_events where provider_event_id = ${ev.providerEventId}`.execute(dbs[0])).rows[0].n).toBe(1);
    expect((await sql<any>`select status, amount_paid_cents from billing_invoices where invoice_number = ${inv}`.execute(dbs[0])).rows[0]).toEqual({ status: 'paid', amount_paid_cents: '4900' });
    // and once more, later: still a duplicate
    expect(await new KyselyBillingRepository(dbs[1]).ingestWebhook(ev)).toMatchObject({ processed: false, duplicate: true });
  });
});
