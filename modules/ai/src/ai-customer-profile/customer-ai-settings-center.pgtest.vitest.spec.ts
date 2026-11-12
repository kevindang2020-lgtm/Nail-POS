// customer-ai-settings-center.pgtest — Customer AI Settings guide (Nov 1 2026; migration 767) on the REAL schema.
// ST = state & provenance · WR = safe writes · PV = preview · HI = history · FC = fail-closed · HL = health.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CustomerAiSettingsCenter, CustomerAiSettingsError } from './customer-ai-settings-center';
import { CustomerIntelligenceCenter } from './customer-intelligence-center';
import { KyselyProfileSettings } from './ai-customer-profile.settings.kysely';
import { resolveSettings, PLATFORM_DEFAULTS } from './ai-customer-profile-settings';

const P = 'c7670000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), X = id(4), BX = id(5), OWNER = id(10), MGR = id(11), LAN = id(20);
const ctx = (o: any = {}) => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.ai_customer_profile.view', 'pos.ai_customer_profile.churn'], ...o }) as any;
let db: any; let clock = Date.now();
let ent: any = { allowed: true, reason: 'ok', subscriptionStatus: 'active' };
let mode: 'off' | 'observe' | 'enforce' = 'observe';
const invalidated: string[] = [];
let cas: CustomerAiSettingsCenter; let ci: CustomerIntelligenceCenter;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const audits: any[] = [];
const audit = async (_t: any, m: any) => { audits.push(m); };
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof CustomerAiSettingsError ? e.code : (e as Error).message; } }
let tk = 0;
const visit = (cust: string, daysAgo: number) => q(sql`insert into tickets (tenant_id, branch_id, customer_id, primary_technician_id, status, total_cents, ticket_number, created_at, paid_at)
  values (${T}, ${B}, ${cust}, ${LAN}, 'paid', 4500, ${++tk}, now() - (${daysAgo} || ' days')::interval, now() - (${daysAgo} || ' days')::interval)`);
const v = async () => (await cas.state(ctx())).salonRow.version;

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  // the intelligence scan reads the SAME settings the screen writes (the real port + resolver)
  const port = new KyselyProfileSettings(db);
  ci = new CustomerIntelligenceCenter(db, async (c) => { const r = resolveSettings({ platform: PLATFORM_DEFAULTS, ...(await port.layers(c)) }); return { enabled: r.enabled, tunables: r.tunables }; }, () => clock);
  cas = new CustomerAiSettingsCenter(db, async () => ent, async (t) => { invalidated.push(t); }, () => mode, () => clock);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'cas-767', 'CAS767', 'active'), (${X}, 'X', 'Other', 'cas-767x', 'CAS767X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York'), (${BX}, ${X}, 'Other', 'America/New_York')`);
  await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Owner', 'o@cas.test', 'active', 'OWNER'), (${MGR}, ${T}, 'Manager', 'm@cas.test', 'active', 'MANAGER')`);
  await q(sql`set session_replication_role = replica`);
  await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${LAN}, ${T}, ${B}, 'Lan', 'Nguyễn', 'Lan Nguyễn')`);
  for (let i = 0; i < 4; i++) await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status) values (${id(100 + i)}, ${T}, ${B}, ${'C' + i}, 'X', ${'C' + i}, 'active')`);
  for (const d of [100, 70, 40]) await visit(id(100), d);       // 3 visits
  for (const d of [60, 20]) await visit(id(101), d);            // 2 visits
  await visit(id(102), 120);                                     // 1 visit, 120 days ago
  await q(sql`insert into ai_customer_profile_settings (tenant_id, level, tunables) values (${X}, 'tenant', '{"inactiveDays": 30}')`);   // another salon
  await q(sql`set session_replication_role = origin`);
});

describe('Customer AI Settings — state and provenance', () => {
  it('ST-01 with nothing stored: code defaults, source Default, version 0, the assistant running, propagation never', async () => {
    const s: any = await cas.state(ctx());
    expect(s.thresholds.map((x: any) => [x.key, x.value, x.source])).toEqual([['minVisitsForServicePref', 3, 'default'], ['minVisitsForTechPref', 3, 'default'],
      ['minVisitsForCadence', 3, 'default'], ['inactiveDays', 90, 'default'], ['longTermInactiveDays', 180, 'default']]);
    expect(s.assistant).toMatchObject({ effectiveEnabled: true, salon: 'inherited', operational: 'operational' });
    expect(s.salonRow.version).toBe(0);
    expect(s.propagation.customerIntelligence.state).toBe('never');
  });
  it('ST-02 the package / subscription decision is kept apart from the salon switch; enforcement decides whether it blocks', async () => {
    ent = { allowed: false, reason: 'trial_expired', subscriptionStatus: 'trialing' };
    expect((await cas.state(ctx())).assistant.operational).toBe('operational');      // observe: recorded, not blocked
    mode = 'enforce';
    const s: any = await cas.state(ctx());
    expect(s.assistant).toMatchObject({ salon: 'inherited', operational: 'subscription_blocked' });
    expect(s.entitlement).toMatchObject({ allowed: false, reason: 'trial_expired', enforcement: 'enforce' });
    mode = 'observe'; ent = { allowed: true, reason: 'ok', subscriptionStatus: 'active' };
  });
});

describe('Customer AI Settings — safe writes', () => {
  it('WR-01 thresholds: validated, ordered, version-checked; history + audit; cache invalidated; another salon untouched', async () => {
    expect(await code(cas.setThresholds(ctx(), { values: { inactiveDays: 5 }, expectedVersion: 0 }, audit))).toBe('CAS_OUT_OF_RANGE');
    expect(await code(cas.setThresholds(ctx(), { values: { inactiveDays: 200 }, expectedVersion: 0 }, audit))).toBe('CAS_ORDER');   // 200 ≥ long-term 180
    expect(await code(cas.setThresholds(ctx(), { values: { bogus: 3 }, expectedVersion: 0 }, audit))).toBe('CAS_INVALID_VALUE');
    expect(await code(cas.setThresholds(ctx(), { values: { inactiveDays: 60 } }, audit))).toBe('CAS_VERSION_REQUIRED');
    const r: any = await cas.setThresholds(ctx(), { values: { inactiveDays: 60, minVisitsForCadence: 2 }, expectedVersion: 0, reason: 'shorter cycle' }, audit);
    expect(r.version).toBe(1);
    expect(r.state.thresholds.find((x: any) => x.key === 'inactiveDays')).toMatchObject({ value: 60, source: 'tenant', default: 90 });
    expect(invalidated).toEqual([T]);
    expect(audits.at(-1)).toMatchObject({ type: 'thresholds_changed', changed: ['minVisitsForCadence', 'inactiveDays'], version: 1 });
    expect(await code(cas.setThresholds(ctx(), { values: { inactiveDays: 45 }, expectedVersion: 0 }, audit))).toBe('CAS_STALE_VERSION');
    expect(await code(cas.setThresholds(ctx(), { values: { inactiveDays: 60 }, expectedVersion: 1 }, audit))).toBe('CAS_NO_CHANGE');
    expect((await q(sql`select tunables from ai_customer_profile_settings where tenant_id = ${X}`))[0].tunables).toEqual({ inactiveDays: 30 });
  });
  it('WR-02 Disable keeps the thresholds (the old route wiped them); Enable stores "inherit", never forcing past a platform decision', async () => {
    const r: any = await cas.setAssistant(ctx(), { enabled: false, expectedVersion: await v(), reason: 'renovation' }, audit);
    expect(r.state.assistant).toMatchObject({ salon: 'disabled', effectiveEnabled: false, disabledAtLevel: 'tenant', operational: 'disabled' });
    expect(r.state.thresholds.find((x: any) => x.key === 'inactiveDays').value).toBe(60);
    expect(await code(cas.setAssistant(ctx(), { enabled: false, expectedVersion: await v() }, audit))).toBe('CAS_NO_CHANGE');
    const e: any = await cas.setAssistant(ctx(), { enabled: true, expectedVersion: await v() }, audit);
    expect(e.state.assistant).toMatchObject({ salon: 'inherited', effectiveEnabled: true });
    expect((await q(sql`select enabled, version from ai_customer_profile_settings where tenant_id = ${T} and level = 'tenant'`))[0]).toEqual({ enabled: null, version: 3 });
  });
  it('WR-03 a branch override is shown as such and still wins for that branch', async () => {
    await q(sql`insert into ai_customer_profile_settings (tenant_id, level, branch_id, tunables) values (${T}, 'branch', ${B}, '{"longTermInactiveDays": 365, "minVisitsForTechPref": -1}')`);
    const s: any = await cas.state(ctx());
    expect(s.thresholds.find((x: any) => x.key === 'longTermInactiveDays')).toMatchObject({ value: 365, source: 'branch' });
    expect(s.thresholds.find((x: any) => x.key === 'minVisitsForTechPref')).toMatchObject({ value: 3, source: 'default', ignoredAt: ['branch'] });
    expect((await cas.state(ctx({ branchId: '' }))).thresholds.find((x: any) => x.key === 'longTermInactiveDays')).toMatchObject({ value: 180, source: 'default' });
    await q(sql`delete from ai_customer_profile_settings where tenant_id = ${T} and level = 'branch'`);
  });
  it('WR-04 propagation: the evaluation that ran after the change applied it; a later change is pending until Refresh', async () => {
    await ci.scan(ctx());
    expect((await cas.state(ctx())).propagation.customerIntelligence.state).toBe('applied');
    await cas.setThresholds(ctx(), { values: { longTermInactiveDays: 240 }, expectedVersion: await v() }, audit);
    expect((await cas.state(ctx())).propagation.customerIntelligence.state).toBe('pending');
    clock += 120_000; await ci.scan(ctx());
    expect((await cas.state(ctx())).propagation.customerIntelligence.state).toBe('applied');
  });
  it('WR-04b Config Drift Alert names exactly the values the last evaluation used that differ from now, and changes nothing', async () => {
    const s0: any = await cas.state(ctx());
    expect(s0.propagation.customerIntelligence.drift).toMatchObject({ drifted: false, keys: [], ruleVersion: { changed: false } });
    expect(s0.propagation.serviceRecommendations.drift).toBeNull();                     // never evaluated → nothing to compare
    await cas.setThresholds(ctx(), { values: { longTermInactiveDays: 250 }, expectedVersion: await v() }, audit);
    const scansBefore = await q(sql`select count(*)::int n from customer_intelligence_scans where tenant_id = ${T}`);
    const d: any = (await cas.state(ctx())).propagation.customerIntelligence.drift;
    expect(d.drifted).toBe(true);
    expect(d.keys).toEqual([{ key: 'longTermInactiveDays', evaluatedValue: 240, currentValue: 250, onScreen: true }]);
    // an evaluation stored under an older rule version is drift even with the same numbers
    await q(sql`update customer_intelligence_scans set rule_version = 'old-rule' where tenant_id = ${T} and status = 'completed'`);
    const d2: any = (await cas.state(ctx())).propagation.customerIntelligence.drift;
    expect(d2.ruleVersion).toMatchObject({ evaluated: 'old-rule', changed: true });
    const chk: any = await cas.check(ctx());
    await q(sql`delete from customer_ai_settings_health_runs where tenant_id = ${T}`);   // HL-01 needs a fresh run, not this one reused
    expect(chk.checks.find((c: any) => c.key === 'intelligence_applied').detail).toMatchObject({ driftedKeys: ['longTermInactiveDays'], ruleVersionChanged: true });
    expect(await q(sql`select count(*)::int n from customer_intelligence_scans where tenant_id = ${T}`)).toEqual(scansBefore);   // detection only
    clock += 120_000; await ci.scan(ctx());
    expect((await cas.state(ctx())).propagation.customerIntelligence.drift).toMatchObject({ drifted: false, keys: [] });
  });
  it('WR-05 Reset returns the five to the code defaults and keeps the switch', async () => {
    const r: any = await cas.setThresholds(ctx(), { reset: true, expectedVersion: await v() }, audit);
    expect(r.state.thresholds.every((x: any) => x.source === 'default')).toBe(true);
    expect(audits.at(-1).type).toBe('thresholds_reset');
  });
});

describe('Customer AI Settings — preview, history, fail-closed, health', () => {
  it('PV-01 the preview counts customers crossing a line and changes nothing', async () => {
    const before = await q(sql`select version, tunables from ai_customer_profile_settings where tenant_id = ${T}`);
    const p: any = await cas.preview(ctx(), { values: { minVisitsForCadence: 4, longTermInactiveDays: 100, inactiveDays: 3 } });
    const by = Object.fromEntries(p.items.map((x: any) => [x.key, x]));
    expect(by.minVisitsForCadence).toMatchObject({ current: 3, proposed: 4, affected: 1 });          // the 3-visit customer
    expect(by.longTermInactiveDays).toMatchObject({ current: 180, proposed: 100, affected: 1 });      // the 120-days customer
    expect(by.inactiveDays).toMatchObject({ valid: false, affected: null });
    expect(p.estimated).toBe(true);
    expect(await q(sql`select version, tunables from ai_customer_profile_settings where tenant_id = ${T}`)).toEqual(before);
  });
  it('HI-01 history is newest first, searchable, append-only; the detail shows before / after and propagation', async () => {
    const h: any = await cas.history(ctx(), {});
    expect(h.total).toBe(6);                                       // thresholds · disable · enable · long-term · long-term (drift) · reset
    const at = h.items.map((e: any) => e.at); expect([...at].sort().reverse()).toEqual(at);
    expect(h.items[0].type).toBe('thresholds_reset');
    expect((await cas.history(ctx(), { q: 'renovation' })).total).toBe(1);
    expect((await cas.history(ctx(), { type: 'assistant_disabled' })).total).toBe(1);
    expect((await cas.history(ctx(), { q: 'inactiveDays' })).total).toBeGreaterThanOrEqual(1);
    expect(await code(cas.history(ctx(), { preset: 'custom', from: '2026-02-01', to: '2026-01-01' }))).toBe('CAS_INVALID_PERIOD');
    const first = h.items.at(-1);
    const d: any = await cas.event(ctx(), first.id);
    expect(d).toMatchObject({ type: 'thresholds_changed', reason: 'shorter cycle', before: { enabled: null, tunables: {} }, after: { tunables: { inactiveDays: 60, minVisitsForCadence: 2 } } });
    expect(d.propagation.customerIntelligence.state).toBe('applied');
    expect(await code(q(sql`update ai_customer_profile_settings_events set reason = 'x'`))).toMatch(/append-only/);
    expect(await code(cas.event(ctx({ tenantId: X }), first.id))).toBe('CAS_EVENT_NOT_FOUND');
  });
  it('FC-01 the assistant\'s settings read fails CLOSED (it used to read a database error as "no overrides" = enabled)', async () => {
    const broken: any = { selectFrom: () => ({ select: () => ({ where: () => ({ where: () => ({ limit: () => ({ execute: async () => { throw new Error('db down'); } }) }) }) }) }) };
    await expect(new KyselyProfileSettings(broken).layers(ctx())).rejects.toThrow('db down');
  });
  it('FC-02 the assistant port now MERGES: a switch-only write keeps the thresholds', async () => {
    const port = new KyselyProfileSettings(db);
    await port.setLayer(ctx(), 'user', { tunables: { inactiveDays: 75 } });
    await port.setLayer(ctx(), 'user', { enabled: false });
    expect((await q(sql`select enabled, tunables from ai_customer_profile_settings where tenant_id = ${T} and level = 'user'`))[0]).toEqual({ enabled: false, tunables: { inactiveDays: 75 } });
    const s: any = await cas.state(ctx());
    expect(s.assistant).toMatchObject({ userOverride: 'disabled', effectiveEnabled: false, disabledAtLevel: 'user' });
    await q(sql`delete from ai_customer_profile_settings where tenant_id = ${T} and level = 'user'`);
  });
  it('HL-01 the check is read-only and finds a change made outside the screen and a pending evaluation', async () => {
    await q(sql`update ai_customer_profile_settings set tunables = '{"inactiveDays": 61}', version = version + 1 where tenant_id = ${T} and level = 'tenant'`);   // outside the screen
    const before = await q(sql`select (select count(*) from ai_customer_profile_settings_events)::int a, (select max(version) from ai_customer_profile_settings where tenant_id = ${T})::int b`);
    const r: any = await cas.check(ctx());
    const by = Object.fromEntries(r.checks.map((c: any) => [c.key, c]));
    expect(by.settings_source.state).toBe('PASSED');
    expect(by.history_complete).toMatchObject({ state: 'WARNING', count: 1 });
    expect(by.intelligence_applied.state).toBe('WARNING');
    expect(by.threshold_order.state).toBe('PASSED');
    expect(by.tenant_isolation.state).toBe('PASSED');
    expect(await q(sql`select (select count(*) from ai_customer_profile_settings_events)::int a, (select max(version) from ai_customer_profile_settings where tenant_id = ${T})::int b`)).toEqual(before);
    expect((await cas.check(ctx()) as any).reused).toBe(true);
  });
});
