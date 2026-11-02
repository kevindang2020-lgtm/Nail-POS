// business-setup-faq.postgres-race — AI Business Setup guide FAQ02 / FAQ04 on REAL Postgres with REAL concurrency
// (four Kysely instances = four sessions; PGlite is one session and cannot show a race):
//   • 8 simultaneous "Add FAQ" taps with ONE request key → one FAQ, one revision, one event
//   • two managers approve the same version at the same moment → exactly one approval, the other a version conflict;
//     one 'approved' event, the version moved once
//   • approve racing archive on the same version → exactly one wins; the FAQ is never "approved and archived"
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { BusinessSetupCenter, BusinessSetupError, type BsCtx } from './business-setup-center';

const url = process.env.PG_RACE_URL;
const TAG = `bsr${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const T = randomUUID(), B = randomUUID(), U = randomUUID();

describe.skipIf(!url)('AI Business Setup FAQs on real Postgres', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const centers = dbs.map((d) => new BusinessSetupCenter(d));
  const ctx: BsCtx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['ai.use', 'ai.manage'] };
  const q1 = async (s: any) => (await s.execute(dbs[0])).rows[0];
  const code = (o: PromiseSettledResult<any>) => (o.status === 'fulfilled' ? 'ok' : o.reason instanceof BusinessSetupError ? o.reason.code : String(o.reason?.message ?? o.reason));

  beforeAll(async () => {
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, ${TAG}, ${TAG}, ${TAG.toUpperCase().slice(-12)}, 'active')`.execute(dbs[0]);
    await sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York')`.execute(dbs[0]);
  });
  afterAll(async () => { await Promise.all(dbs.map((d) => d.destroy())); });

  it('FAQ02: 8 simultaneous Add FAQ taps with one key → one FAQ, one revision, one event', async () => {
    const key = `${TAG}-create-0001`;
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => centers[i % 4].createFaq(ctx, { question: 'Do you take walk-ins?', answer: 'Yes.', idempotencyKey: key })));
    expect(out.map(code)).toEqual(Array(8).fill('ok'));
    const ids = new Set(out.map((o: any) => o.value.id)); expect(ids.size).toBe(1);
    const fid = [...ids][0];
    expect(await q1(sql`select (select count(*) from ai_receptionist_faqs where tenant_id = ${T})::int f, (select count(*) from ai_receptionist_faq_revisions where faq_id = ${fid})::int r,
      (select count(*) from ai_receptionist_faq_events where faq_id = ${fid})::int e`)).toEqual({ f: 1, r: 1, e: 1 });
  });

  it('FAQ04: two approvals of the same version at once → one approval, one version conflict', async () => {
    const { id } = await centers[0].createFaq(ctx, { question: 'Where can I park?', answer: 'Behind the salon.', idempotencyKey: `${TAG}-create-0002` });
    const out = await Promise.allSettled([0, 1, 2, 3].map((i) => centers[i].faqAction(ctx, id, { action: 'approve', expectedVersion: 1, idempotencyKey: `${TAG}-appr-${i}-0000` })));
    expect(out.map(code).sort()).toEqual(['AI_FAQ_VERSION_CONFLICT', 'AI_FAQ_VERSION_CONFLICT', 'AI_FAQ_VERSION_CONFLICT', 'ok']);
    expect(await q1(sql`select status, version::int v, (select count(*) from ai_receptionist_faq_events e where e.faq_id = f.id and e.action = 'approved')::int n from ai_receptionist_faqs f where f.id = ${id}`))
      .toEqual({ status: 'approved', v: 2, n: 1 });
  });

  it('approve racing archive on the same version → exactly one wins; never approved-and-archived', async () => {
    const { id } = await centers[0].createFaq(ctx, { question: 'Do you sell gift cards?', answer: 'Yes, at the front desk.', idempotencyKey: `${TAG}-create-0003` });
    const out = await Promise.allSettled([
      centers[0].faqAction(ctx, id, { action: 'approve', expectedVersion: 1, idempotencyKey: `${TAG}-mix-a-0000` }),
      centers[1].faqAction(ctx, id, { action: 'archive', expectedVersion: 1, reason: 'Not offered', idempotencyKey: `${TAG}-mix-b-0000` }),
      centers[2].faqAction(ctx, id, { action: 'approve', expectedVersion: 1, idempotencyKey: `${TAG}-mix-c-0000` }),
      centers[3].faqAction(ctx, id, { action: 'archive', expectedVersion: 1, reason: 'Not offered', idempotencyKey: `${TAG}-mix-d-0000` }),
    ]);
    expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const r = await q1(sql`select status, is_active, version::int v, archived_at is not null archived from ai_receptionist_faqs where id = ${id}`);
    expect(r.v).toBe(2);
    expect(r.status === 'approved' ? r.is_active && !r.archived : !r.is_active && r.archived).toBe(true);
  });
});
