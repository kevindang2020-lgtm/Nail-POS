// reviews.postgres-race — Reviews & Reputation guide (Oct 30 2026, migration 752) on REAL Postgres with REAL concurrency (four
// sessions). PGlite is one session, so these are the only tests that show:
//   • eight managers hiding the same review at once with the same loaded version → ONE hide, ONE trail event, seven conflicts
//   • one manager's Hide retried eight times at once (same request key) → ONE hide, the retries answer "already done"
//   • a customer double-submitting the same rating (same visit, technician, customer) → ONE review row
//   • a completion event replayed eight times → ONE review request per visit
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { ReviewsCenter, ReviewsCenterError } from './reviews-center';

const url = process.env.PG_RACE_URL;
const TAG = `rvr${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const T = randomUUID(), B = randomUUID(), TECH = randomUUID(), CUST = randomUUID(), OWNER = randomUUID();

describe.skipIf(!url)('Reviews moderation and review uniqueness on real Postgres', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const centers = dbs.map((d) => new ReviewsCenter(d));
  const ctx = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.marketing.view', 'pos.marketing.manage'] } as any;
  const q = async (s: any) => (await s.execute(dbs[0])).rows as any[];
  const audit = async () => undefined;
  let ticket = '';
  const newReview = async () => String((await q(sql`insert into reviews (tenant_id, branch_id, rating, comment, technician_id) values (${T}, ${B}, 2, 'Polish chipped', ${TECH}) returning id`))[0].id);
  const outcome = (o: PromiseSettledResult<any>) => (o.status === 'fulfilled' ? (o.value.replayed ? 'replayed' : 'applied') : o.reason instanceof ReviewsCenterError ? o.reason.code : `ERR:${String(o.reason?.message ?? o.reason)}`);

  beforeAll(async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, ${TAG}, ${TAG}, ${TAG.toUpperCase().slice(0, 12)}, 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York')`);
    await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${TECH}, ${T}, ${B}, 'Race', 'Tech', 'Race Tech')`);
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status) values (${CUST}, ${T}, ${B}, 'Race', 'Customer', 'Race Customer', 'active')`);
    ticket = String((await q(sql`insert into tickets (tenant_id, branch_id, customer_id, status, total_cents, paid_at) values (${T}, ${B}, ${CUST}, 'paid', 4500, now()) returning id`))[0].id);
  }, 120_000);
  afterAll(async () => { await Promise.all(dbs.map((d) => d.destroy())); });

  it('eight managers hide the same review at once (same loaded version) → one hide, one trail event, seven version conflicts', async () => {
    const rid = await newReview();
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => centers[i % 4].moderate(ctx, rid, { action: 'hide', reasonCode: 'abusive_language', expectedVersion: 0, idempotencyKey: `${TAG}-m${i}` }, audit)));
    const kinds = out.map(outcome);
    expect(kinds.filter((k) => k === 'applied').length).toBe(1);
    expect(kinds.filter((k) => k === 'VERSION_CONFLICT').length).toBe(7);
    expect(Number((await q(sql`select count(*)::int as n from review_moderation_events where tenant_id = ${T} and review_id = ${rid}`))[0].n)).toBe(1);
    expect(Number((await q(sql`select moderation_version from reviews where id = ${rid}`))[0].moderation_version)).toBe(1);
  });

  it('one Hide retried eight times at once (same request key) → one hide; every retry answers "already done"', async () => {
    const rid = await newReview();
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => centers[i % 4].moderate(ctx, rid, { action: 'hide', reasonCode: 'spam', expectedVersion: 0, idempotencyKey: `${TAG}-same` }, audit)));
    const kinds = out.map(outcome);
    expect(kinds.filter((k) => k === 'applied').length).toBe(1);
    expect(kinds.filter((k) => k === 'replayed').length).toBe(7);
    expect(Number((await q(sql`select count(*)::int as n from review_moderation_events where tenant_id = ${T} and review_id = ${rid}`))[0].n)).toBe(1);
  });

  it('a customer double-submits the same rating eight times at once → one review row (the database decides)', async () => {
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => sql`insert into reviews (tenant_id, branch_id, customer_id, ticket_id, technician_id, rating) values (${T}, ${B}, ${CUST}, ${ticket}, ${TECH}, 5)`.execute(dbs[i % 4])));
    expect(out.filter((o) => o.status === 'fulfilled').length).toBe(1);
    expect(Number((await q(sql`select count(*)::int as n from reviews where tenant_id = ${T} and ticket_id = ${ticket}`))[0].n)).toBe(1);
  });

  it('a completion event replayed eight times → one review request for the visit', async () => {
    const key = `${T}|${ticket}|${CUST}|sms`;
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => sql`insert into review_requests (tenant_id, customer_id, channel, idempotency_key, scheduled_for) values (${T}, ${CUST}, 'sms', ${key}, now()) on conflict (tenant_id, idempotency_key) do nothing`.execute(dbs[i % 4])));
    expect(out.every((o) => o.status === 'fulfilled')).toBe(true);
    expect(Number((await q(sql`select count(*)::int as n from review_requests where tenant_id = ${T} and idempotency_key = ${key}`))[0].n)).toBe(1);
  });
});
