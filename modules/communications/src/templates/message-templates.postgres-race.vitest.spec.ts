// message-templates.postgres-race — Message Templates (740) on REAL Postgres with REAL concurrency (CI race lane, PG_RACE_URL).
// Four Kysely instances = four sessions:
//   • 8 editors save the same template from the same starting version at once → exactly ONE wins (one new version),
//     the other 7 get TEMPLATE_VERSION_CONFLICT — never a silent overwrite, never a duplicate version number
//   • the same Test Send (one Idempotency-Key) clicked 6 times at once → ONE provider call, ONE test row
//   • 6 owners connect different templates to Appointment Reminders at once → exactly ONE active binding remains
// Fresh random salon per run (the race database is shared). Ledgers stay (append-only history), nothing else is touched.
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { MessageTemplatesCenter, TemplatesError, type TemplatesContext } from './message-templates';

const url = process.env.PG_RACE_URL;
const TAG = `mtr${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const T = randomUUID(), OWNER = randomUUID();
const ALL = ['pos.communications.view', 'pos.communications.send', 'pos.communications.manage', 'pos.customers.view'];
const ctx: TemplatesContext = { tenantId: T, branchId: null, userId: OWNER, role: 'OWNER', permissions: ALL };

describe.skipIf(!url)('Message Templates on real Postgres: concurrent edits, duplicate test clicks, simultaneous binds', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const calls: string[] = [];
  const sender = {
    // a slow provider makes the duplicate clicks overlap for real
    sendSms: async (r: { to: string }) => { calls.push(r.to); await new Promise((res) => setTimeout(res, 50)); return { sent: true, status: 'sent', providerId: 'SM' + calls.length, notificationId: undefined }; },
    send: async () => ({ sent: false, status: 'blocked', reason: 'not_used' }),
  };
  const centers = dbs.map((d) => new MessageTemplatesCenter(d, sender as any));
  const on = (i: number) => centers[i % centers.length];
  const q = async (s: any) => (await s.execute(dbs[0])).rows as any[];
  const codeOf = (o: PromiseSettledResult<unknown>) => (o.status === 'fulfilled' ? 'ok' : o.reason instanceof TemplatesError ? o.reason.code : String((o.reason as Error)?.message ?? o.reason));

  beforeAll(async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, ${'Race Salon'}, ${TAG}, ${TAG.slice(-10).toUpperCase()}, 'active')`);
    await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Race Owner', ${TAG + '@race.test'}, 'active', 'OWNER')`);
  }, 60_000);
  afterAll(async () => { await Promise.all(dbs.map((d) => d.destroy())); });

  it('8 simultaneous saves from the same version: exactly one wins, 7 conflicts, versions 1 and 2 only', async () => {
    const c = await centers[0].create(ctx, { name: 'Race me', channel: 'sms', category: 'general', body: 'Hi {customer_first_name}' });
    const rv = c.template.recordVersion;
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, k) => on(k).update(ctx, c.template.id, { recordVersion: rv, body: `Hi {customer_first_name} — edit ${k}` })));
    const codes = out.map(codeOf);
    expect(codes.filter((x) => x === 'ok')).toHaveLength(1);
    expect(codes.filter((x) => x === 'TEMPLATE_VERSION_CONFLICT')).toHaveLength(7);
    const v = await q(sql`select version from pos_message_template_versions where tenant_id = ${T} and template_id = ${c.template.id} order by version`);
    expect(v.map((r) => Number(r.version))).toEqual([1, 2]);
    const winner = out.findIndex((o) => o.status === 'fulfilled');
    expect((await centers[0].detail(ctx, c.template.id)).template.bodyPreview).toBe(`Hi {customer_first_name} — edit ${winner}`);
  });

  it('one Test Send key clicked 6 times at once: one provider call, one test row', async () => {
    const c = await centers[0].create(ctx, { name: 'Test me', channel: 'sms', body: 'Hello from {salon_name}' });
    const key = `${TAG}-test-key-1`;
    const before = calls.length;
    const out = await Promise.allSettled(Array.from({ length: 6 }, (_, k) => on(k).testSend(ctx, c.template.id, { to: '+16095550123', confirm: true }, key)));
    expect(out.map(codeOf)).toEqual(Array(6).fill('ok'));
    expect(calls.length - before).toBe(1);
    const rows = await q(sql`select status from pos_message_template_tests where tenant_id = ${T} and idempotency_key = ${key}`);
    expect(rows).toEqual([{ status: 'submitted' }]);
    expect(out.filter((o: any) => o.value.duplicate === false)).toHaveLength(1);
  });

  it('6 owners connect different templates to Appointment Reminders at once: exactly one active binding', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await centers[0].create(ctx, { name: `Reminder ${i}`, channel: 'sms', category: 'appointment_reminder', body: `Hi {customer_first_name}, see you {appointment_date} (${i})` })).template.id);
    const out = await Promise.allSettled(ids.map((tid, k) => on(k).bind(ctx, { workflow: 'appointment_reminder', channel: 'sms', templateId: tid })));
    // every attempt either won or lost cleanly (a unique-index loser is a database error, never a second active row)
    expect(out.map(codeOf)).toEqual(Array(6).fill('ok'));   // serialized per (salon, workflow, channel): each replaces the previous one
    const active = await q(sql`select template_id from pos_message_template_bindings where tenant_id = ${T} and workflow = 'appointment_reminder' and channel = 'sms' and active`);
    expect(active).toHaveLength(1);
    expect(ids).toContain(active[0].template_id);
  });
});
