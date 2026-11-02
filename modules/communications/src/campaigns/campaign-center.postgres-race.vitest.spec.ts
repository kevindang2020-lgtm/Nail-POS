// campaign-center.postgres-race — Campaign Center guide §10 / §18 on REAL Postgres with real concurrency (four sessions):
//   • eight Launch taps at once → ONE move to scheduled, ONE "campaign.launched" audit row, seven "already launched"
//   • Launch racing an edit of the approved message → never "scheduled with content nobody approved": either the launch wins
//     (and the edit is refused: no longer a draft) or the edit wins (and the launch is refused: approval stale)
//   • eight executor claims for the same recipient + message version → ONE send-ledger row (the 320 unique index)
//   • two approvals at once → one consistent plan (same version as the campaign row)
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { CampaignCenter, campaignSendReadiness } from './campaign-center';

const url = process.env.PG_RACE_URL;
const TAG = `ccr${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const T = randomUUID(), B = randomUUID(), OWNER = randomUUID();
const ctx: any = { tenantId: T, branchId: null, userId: OWNER, role: 'OWNER', permissions: ['pos.marketing.view', 'pos.marketing.manage', 'pos.customers.view'] };

describe.skipIf(!url)('Campaign Center on real Postgres: launch / edit / approve / ledger races', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const centers = dbs.map((d) => new CampaignCenter(d));
  const q = async (s: any) => (await s.execute(dbs[0])).rows as any[];
  const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e: any) { return e?.code ?? String(e?.message ?? e); } };

  async function readyCampaign(name: string) {
    const cust = randomUUID();
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status, marketing_sms_opt_in) values (${cust}, ${T}, ${B}, 'Race', 'Person', 'Race Person', ${'+1609' + String(Math.floor(1e6 + Math.random() * 8.9e6))}, 'active', true)`);
    const draft = (await q(sql`insert into segment_audience_drafts (tenant_id, channel, ruleset_version, segment, selection_mode, selected_count, eligible_count, idempotency_key, expires_at)
      values (${T}, 'sms', 'segments-v1', 'returning', 'selected', 1, 1, ${TAG + randomUUID()}, now() + interval '1 day') returning id`))[0].id;
    await q(sql`insert into segment_audience_members (draft_id, tenant_id, customer_id, eligibility) values (${draft}, ${T}, ${cust}, 'eligible')`);
    const c = await centers[0].createDraft(ctx, { name, channel: 'sms', messageBody: 'Hello from {salon_name}' });
    await centers[0].setAudience(ctx, c.id, { draftId: String(draft) });
    await centers[0].approve(ctx, c.id);
    return { id: c.id, cust };
  }

  beforeAll(async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, 'Race Salon', ${TAG}, ${TAG.slice(-9).toUpperCase()}, 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York')`);
    await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Race Owner', ${TAG + '@race.test'}, 'active', 'OWNER')`);
  }, 120_000);
  afterAll(async () => { await Promise.all(dbs.map((d) => d.destroy())); });

  it('eight Launch taps over four sessions → one scheduled move, one audit row, seven refusals', async () => {
    const c = await readyCampaign('Launch race');
    const out = await Promise.all(Array.from({ length: 8 }, (_, i) => code(centers[i % 4].launch(ctx, c.id, { confirm: true }))));
    expect(out.filter((x) => x === 'ok').length).toBe(1);
    expect(out.filter((x) => x === 'CAMPAIGN_ALREADY_LAUNCHED').length).toBe(7);
    expect((await q(sql`select status from campaigns where id = ${c.id}`))[0].status).toBe('scheduled');
    expect(Number((await q(sql`select count(*)::int as n from audit_events where tenant_id = ${T} and resource_id = ${c.id} and action = 'campaign.launched'`))[0].n)).toBe(1);
  });

  it('Launch racing an edit of the approved message never schedules unapproved content', async () => {
    for (let round = 0; round < 4; round++) {
      const c = await readyCampaign('Edit race ' + round);
      const [l, e] = await Promise.all([code(centers[1].launch(ctx, c.id, { confirm: true })), code(centers[2].updateDraft(ctx, c.id, { messageBody: 'Changed text ' + round }))]);
      const row = (await q(sql`select status, content_hash, approved_content_hash from campaigns where id = ${c.id}`))[0];
      if (l === 'ok') { expect(e).toBe('CAMPAIGN_NOT_EDITABLE'); expect(row.status).toBe('scheduled'); expect(row.content_hash).toBe(row.approved_content_hash); }
      else { expect(l).toBe('CAMPAIGN_APPROVAL_STALE'); expect(e).toBe('ok'); expect(row.status).toBe('draft'); expect((await campaignSendReadiness(dbs[0], T, c.id)).ok).toBe(false); }
    }
  });

  it('eight executor claims for one recipient + version → one ledger row', async () => {
    const c = await readyCampaign('Ledger race');
    const out = await Promise.all(Array.from({ length: 8 }, (_, i) => sql<any>`insert into ai_marketing_campaign_sends (tenant_id, campaign_id, customer_id, channel, message_version, status)
        values (${T}, ${c.id}, ${c.cust}, 'sms', 1, 'queued') on conflict (tenant_id, campaign_id, customer_id, channel, message_version) do nothing returning id`.execute(dbs[i % 4]).then((r) => r.rows.length)));
    expect(out.reduce((a, b) => a + b, 0)).toBe(1);
    expect(Number((await q(sql`select count(*)::int as n from ai_marketing_campaign_sends where campaign_id = ${c.id}`))[0].n)).toBe(1);
  });

  it('two approvals at once leave one plan whose version matches the campaign', async () => {
    const c = await readyCampaign('Approve race');
    await centers[0].updateDraft(ctx, c.id, { messageBody: 'Version two' });
    const out = await Promise.all([code(centers[1].approve(ctx, c.id)), code(centers[2].approve(ctx, c.id))]);
    expect(out).toEqual(['ok', 'ok']);   // both may approve (row-locked one after the other); the second sees no content change
    const row = (await q(sql`select message_version from campaigns where id = ${c.id}`))[0];
    const plan = (await q(sql`select message_version, body from ai_marketing_campaign_plans where campaign_id = ${c.id}`))[0];
    expect(Number(row.message_version)).toBe(2);
    expect(Number(plan.message_version)).toBe(2);
    expect(plan.body).toBe('Version two');
    expect((await campaignSendReadiness(dbs[0], T, c.id)).ok).toBe(true);
  });
});
