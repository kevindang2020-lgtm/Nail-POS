// reputation-settings-center.pgtest — Review & Reputation Settings guide (Nov 1 2026; migration 769) on the REAL schema.
// ST = state & provenance · WR = safe writes · PC = approval vs automatic reply · HI = history · FC = fail-closed · HL = health.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ReputationSettingsCenter, ReputationSettingsError } from './reputation-settings-center';
import { KyselySettings } from './ai-review-reputation.kysely';
import { resolveSettings, rowsToLayers, PLATFORM_DEFAULTS } from './ai-review-reputation-settings';
import { autoResponseDecision } from './ai-review-reputation-drafting';
import { analyzeReview } from './ai-review-reputation-core';

const P = 'c7690000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), X = id(4), OWNER = id(10), MGR = id(11);
const ctx = (o: any = {}) => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.ai_review_reputation.view', 'pos.ai_review_reputation.manage'], ...o }) as any;
let db: any; const clock = Date.now();
let ent: any = { allowed: true, reason: 'ok', subscriptionStatus: 'active' };
let mode: 'off' | 'observe' | 'enforce' = 'observe';
let rss: ReputationSettingsCenter;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const audits: any[] = [];
const audit = async (_t: any, m: any) => { audits.push(m); };
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof ReputationSettingsError ? e.code : (e as Error).message; } }
const v = async () => (await rss.state(ctx())).salonRow.version;
const val = (s: any, k: string) => s.settings.find((x: any) => x.key === k);
/** what drafting and the checkout hook read: the real port + the one resolver */
const live = async () => { const rows = await new KyselySettings(db).load(ctx()); return resolveSettings({ platform: PLATFORM_DEFAULTS, ...rowsToLayers(rows as any, { branchId: B }) }); };

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  rss = new ReputationSettingsCenter(db, async () => ent, () => mode, () => clock);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'rss-769', 'RSS769', 'active'), (${X}, 'X', 'Other', 'rss-769x', 'RSS769X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York')`);
  await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Owner', 'o@rss.test', 'active', 'OWNER'), (${MGR}, ${T}, 'Manager', 'm@rss.test', 'active', 'MANAGER')`);
  await q(sql`insert into tenant_ai_reputation_settings (tenant_id, level, enabled, config) values (${X}, 'tenant', false, '{"responseTone":"warm"}')`);   // another salon
});

describe('Review & Reputation Settings — state', () => {
  it('ST-01 nothing stored: the eight controls show the platform defaults (photographed values), source Default, version 0', async () => {
    const s: any = await rss.state(ctx());
    expect(s.settings.map((x: any) => [x.key, x.value, x.source])).toEqual([['enabled', true, 'default'], ['responseTone', 'professional', 'default'], ['approvalRequired', true, 'default'],
      ['autoResponse', false, 'default'], ['requestsEnabled', false, 'default'], ['channel', 'sms', 'default'], ['delayMinutes', 120, 'default'], ['oneReminder', false, 'default']]);
    expect(s.salonRow.version).toBe(0);
    expect(s.runtime).toMatchObject({ approval: 'always_enforced', autoResponse: 'off', reminder: 'off', propagation: 'live', reviewRequests: { scheduling: 'off', sender: 'not_running' } });
    expect(s.sms.configured).toBe(false);
  });
  it('ST-02 the subscription is shown apart from the switch; only enforce mode blocks', async () => {
    ent = { allowed: false, reason: 'trial_expired', subscriptionStatus: 'trialing' };
    expect((await rss.state(ctx())).assistant.operational).toBe('operational');
    mode = 'enforce';
    expect((await rss.state(ctx())).assistant.operational).toBe('subscription_blocked');
    mode = 'observe'; ent = { allowed: true, reason: 'ok', subscriptionStatus: 'active' };
  });
});

describe('Review & Reputation Settings — safe writes', () => {
  it('WR-01 a partial save MERGES (a tone change keeps the request policy), bumps the version, writes history + audit, and drafting reads it live', async () => {
    await rss.save(ctx(), { values: { requestsEnabled: true, delayMinutes: 90 }, expectedVersion: 0, reason: 'start asking' }, audit);
    const r: any = await rss.save(ctx(), { values: { responseTone: 'warm' }, expectedVersion: 1 }, audit);
    expect(r.version).toBe(2);
    expect(val(r.state, 'responseTone')).toMatchObject({ value: 'warm', source: 'tenant' });
    expect(val(r.state, 'requestsEnabled').value).toBe(true);
    expect(val(r.state, 'delayMinutes').value).toBe(90);
    const eff = await live();
    expect(eff.config.responseTone).toBe('warm');
    expect(eff.config.reviewRequest).toMatchObject({ enabled: true, delayMinutes: 90, quietHoursStart: 21 });
    expect(audits.at(-1)).toMatchObject({ type: 'settings_changed', changed: ['responseTone'], version: 2 });
    expect(r.state.runtime.reviewRequests).toMatchObject({ scheduling: 'on_checkout', sender: 'not_running' });
  });
  it('WR-02 a stale version is refused; nothing changed; Nothing-changed is refused', async () => {
    expect(await code(rss.save(ctx(), { values: { responseTone: 'luxury' }, expectedVersion: 1 }, audit))).toBe('RSS_STALE_VERSION');
    expect(await code(rss.save(ctx(), { values: { responseTone: 'warm' }, expectedVersion: 2 }, audit))).toBe('RSS_NO_CHANGE');
    expect(val(await rss.state(ctx()), 'responseTone').value).toBe('warm');
  });
  it('WR-03 invalid values are refused (tone, channel, delay range, unknown key)', async () => {
    for (const values of [{ responseTone: 'sarcastic' }, { channel: 'fax' }, { delayMinutes: 20000 }, { delayMinutes: 1.5 }, { surprise: true }])
      expect(await code(rss.save(ctx(), { values, expectedVersion: 2 }, audit))).toBe('RSS_INVALID_VALUE');
  });
  it('WR-04 Disable is stored as false and stops AI drafts; Enable stores inherit; the other salon is untouched', async () => {
    await rss.save(ctx(), { values: { enabled: false }, expectedVersion: 2 }, audit);
    expect((await live()).enabled).toBe(false);
    expect(audits.at(-1).type).toBe('assistant_disabled');
    await rss.save(ctx(), { values: { enabled: true }, expectedVersion: 3 }, audit);
    expect((await q(sql`select enabled from tenant_ai_reputation_settings where tenant_id = ${T} and level = 'tenant'`))[0].enabled).toBeNull();
    expect((await live()).enabled).toBe(true);
    expect((await q(sql`select enabled, config->>'responseTone' as tone from tenant_ai_reputation_settings where tenant_id = ${X}`))[0]).toEqual({ enabled: false, tone: 'warm' });
  });
  it('WR-05 a failing audit rolls the whole save back (fail-closed)', async () => {
    const before = await v();
    const r = await code(rss.save(ctx(), { values: { oneReminder: true }, expectedVersion: before }, async () => { throw new Error('AUDIT_DOWN'); }));
    expect(r).toBe('AUDIT_DOWN');
    expect(await v()).toBe(before);
    expect(val(await rss.state(ctx()), 'oneReminder').value).toBe(false);
  });
});

describe('Review & Reputation Settings — approval vs automatic reply', () => {
  it('PC-01 automatic replies cannot be saved while approval is required; with approval off they save but nothing runs them', async () => {
    expect(await code(rss.save(ctx(), { values: { autoResponse: true }, expectedVersion: await v() }, audit))).toBe('RSS_POLICY_CONFLICT');
    const r: any = await rss.save(ctx(), { values: { autoResponse: true, approvalRequired: false }, expectedVersion: await v() }, audit);
    expect(r.state.runtime.autoResponse).toBe('saved_not_running');
    // turning approval back on while automatic replies are on is refused too — neither box bypasses the other
    expect(await code(rss.save(ctx(), { values: { approvalRequired: true }, expectedVersion: await v() }, audit))).toBe('RSS_POLICY_CONFLICT');
    await rss.save(ctx(), { values: { autoResponse: false, approvalRequired: true }, expectedVersion: await v() }, audit);
  });
  it('PC-02 the automatic-reply gate itself refuses while approval is required (defense in depth)', async () => {
    const cfg = resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: { config: { autoResponse: { enabled: true } as any } } }).config;
    expect(autoResponseDecision(analyzeReview({ text: 'perfect, highly recommend', rating: 5 }), 5, cfg).reason).toBe('approval_required');
  });
});

describe('Review & Reputation Settings — history', () => {
  it('HI-01 newest first; search, type and pages; before → after per control; history rows are append-only', async () => {
    const h: any = await rss.history(ctx(), { pageSize: 10 });
    expect(h.total).toBe(6);   // 2 (WR-01) + 2 (WR-04) + 2 (PC-01); refused and rolled-back saves leave nothing
    expect(h.items[0].changes.map((c: any) => c.key).sort()).toEqual(['approvalRequired', 'autoResponse']);
    expect((await rss.history(ctx(), { type: 'assistant_disabled' })).total).toBe(1);
    expect((await rss.history(ctx(), { q: 'start asking' })).items[0].changes).toEqual(expect.arrayContaining([{ key: 'delayMinutes', before: null, after: 90, beforeKnown: true }]));
    const d: any = await rss.event(ctx(), h.items[0].id);
    expect(d.propagation.mode).toBe('live');
    expect(await code(q(sql`update ai_reputation_config_versions set reason = 'x' where tenant_id = ${T}`))).toMatch(/append-only/);
    expect(await code(rss.history(ctx(), { preset: 'custom', from: '2026-11-05', to: '2026-11-01' }))).toBe('RSS_INVALID_PERIOD');
    expect((await rss.history(ctx({ tenantId: X }), {})).total).toBe(0);
  });
});

describe('Review & Reputation Settings — health and fail-closed', () => {
  it('HL-01 a reply published without any approval is a FAILED check; the check writes only its own run', async () => {
    const R = id(500);
    await q(sql`insert into reviews (id, tenant_id, branch_id, rating, comment, source) values (${R}, ${T}, ${B}, 5, 'great', 'google')`);
    await q(sql`insert into review_response_drafts (tenant_id, review_id, status, current_text) values (${T}, ${R}, 'published', 'Thanks!')`);
    const before = (await q(sql`select count(*)::int as n from review_response_drafts where tenant_id = ${T}`))[0].n;
    const c: any = await rss.check(ctx());
    const by = (k: string) => c.checks.find((x: any) => x.key === k);
    expect(by('approval_enforced')).toMatchObject({ state: 'FAILED', count: 1 });
    expect(by('requests_sender').state).toBe('WARNING');          // requests on, nothing sends them
    expect(by('policy_conflict').state).toBe('PASSED');
    expect(by('tenant_isolation').state).toBe('PASSED');
    expect(c.overall).toBe('FAILED');
    expect((await rss.check(ctx())).reused).toBe(true);
    expect((await q(sql`select count(*)::int as n from review_response_drafts where tenant_id = ${T}`))[0].n).toBe(before);
  });
  it('HL-02 dry run: last 7 days of paid visits through the request service\'s own preview — would ask / skipped by reason / quiet-hours shifts; nothing is scheduled or sent', async () => {
    const T3 = id(30), B3 = id(31);
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T3}, 'S3', 'Dry', 'rss-769d', 'RSS769D', 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B3}, ${T3}, 'Dry Main', 'America/New_York')`);
    const cust = async (n: number, phone: string | null, optIn: boolean) => { await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, marketing_sms_opt_in)
      values (${id(n)}, ${T3}, ${B3}, 'C', ${String(n)}, ${'C ' + n}, ${phone}, ${optIn})`); return id(n); };
    const A = await cust(40, '+16095550140', true), A2 = await cust(41, '+16095550141', true), OUT = await cust(42, '+16095550142', false), NOPH = await cust(43, null, true), COOL = await cust(44, '+16095550144', true);
    const day = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    let k = 0;
    const tk = async (customer: string | null, at: string, tenant = T3, branch = B3) => q(sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, paid_at)
      values (${id(60 + ++k)}, ${tenant}, ${branch}, ${customer}, 'paid', 5000, ${'D' + k}, ${at}::timestamptz)`);
    await tk(A, `${day}T18:00:00Z`);                         // 1 pm New York + 2 h: sent as planned
    await tk(A2, `${day}T23:30:00Z`);                        // 6:30 pm + 2 h = 8:30 pm: still before quiet hours
    await tk(COOL, `${day}T19:00:00Z`);
    await tk(OUT, `${day}T18:00:00Z`); await tk(NOPH, `${day}T18:00:00Z`);
    await tk(A, new Date(Date.now() - 12 * 86400000).toISOString());   // older than 7 days: not considered
    await q(sql`insert into review_requests (tenant_id, branch_id, customer_id, channel, status, idempotency_key, scheduled_for, created_at) values (${T3}, ${B3}, ${COOL}, 'sms', 'sent', 'old-cool-1', now() - interval '3 days', now() - interval '3 days')`);
    const ctx3 = ctx({ tenantId: T3, branchId: B3 });
    // A2 again but late: 8:30 pm + 2 h = 10:30 pm → moved out of quiet hours
    await tk(await cust(45, '+16095550145', true), `${day}T01:30:00Z`);
    const reqBefore = (await q(sql`select count(*)::int as n from review_requests where tenant_id = ${T3}`))[0].n;
    const c: any = await rss.check(ctx3);
    const dry = c.checks.find((x: any) => x.key === 'request_dry_run');
    expect(dry.detail).toMatchObject({ days: 7, visits: 6, capped: false, wouldAsk: 3, skipped: 3, quietHoursShifted: 1, channel: 'sms', channelReady: false, requestsEnabled: false });
    expect(dry.detail.byReason).toEqual({ opted_out: 1, no_contact_method: 1, frequency_cap: 1 });   // the service's own order: contact, consent, value, cap, cooldown
    expect(dry).toMatchObject({ state: 'WARNING', count: 3 });   // SMS would be the channel and no sender is configured
    expect((await q(sql`select count(*)::int as n from review_requests where tenant_id = ${T3}`))[0].n).toBe(reqBefore);   // nothing scheduled
    expect((await q(sql`select count(*)::int as n from notifications where tenant_id = ${T3}`))[0].n).toBe(0);              // nothing sent
  });
  it('HL-03 integration freshness: the review providers\' real sync times (a later failure counts as failing) and the publish queue', async () => {
    const T4 = id(70);
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T4}, 'S4', 'Fresh', 'rss-769f', 'RSS769F', 'active')`);
    await q(sql`insert into integration_connections (tenant_id, provider_key, category, connection_status, last_successful_sync_at, last_failed_sync_at) values
      (${T4}, 'google_business_profile', 'reviews', 'active', '2026-11-10T12:00:00Z', '2026-11-11T12:00:00Z'),
      (${T4}, 'facebook_pages', 'reviews', 'active', '2026-11-11T08:00:00Z', null),
      (${T4}, 'yelp', 'reviews', 'disconnected', '2026-10-01T08:00:00Z', null)`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${id(79)}, ${T4}, 'F', 'America/New_York')`);
    for (const [n, st] of [[71, 'approved'], [72, 'approved'], [73, 'publish_failed'], [74, 'published']] as const) {
      await q(sql`insert into reviews (id, tenant_id, branch_id, rating, comment, source) values (${id(n)}, ${T4}, ${id(79)}, 4, 'ok', 'google')`);
      await q(sql`insert into review_response_drafts (tenant_id, review_id, status, current_text) values (${T4}, ${id(n)}, ${st}, 'Thanks')`);
    }
    const s4 = await rss.state(ctx({ tenantId: T4, branchId: null }));
    expect(s4.providers).toEqual({ connected: 2, lastSuccessfulSyncAt: '2026-11-11T08:00:00.000Z', lastFailedSyncAt: '2026-11-11T12:00:00.000Z', failing: 1 });
    expect(s4.publishQueue).toEqual({ approvedNotPublished: 2, publishFailed: 1 });
    expect((await rss.state(ctx())).publishQueue.approvedNotPublished).toBe(0);   // another salon's queue is not counted
  });
  it('FC-01 a settings read error is an error — never the defaults (which would re-enable a disabled assistant)', async () => {
    const broken = new KyselySettings({ selectFrom: () => ({ select: () => ({ where: () => ({ execute: async () => { throw new Error('DB_DOWN'); } }) }) }) } as any);
    expect(await code(broken.load(ctx()))).toBe('DB_DOWN');
  });
});
