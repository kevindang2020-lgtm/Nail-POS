// front-desk-center.pgtest — AI Front Desk guide §16 on the REAL schema (through 756).
// UI-04 honest empty · CRUD-01/02/03 draft wizard, version conflict, duplicate, archive/restore · SRCH-01/03 search + isolation
// · DATE-02 salon-local inclusive range · PAGE-01/02 · ACT-01 read-only checks · ACT-02/SEC-02 blocked + owner-only activation
// · ACT-03 activation proven from recorded calls · drift → degraded · ACT-04 failed activation leaves the prior route, rollback
// · ACT-05 pause stops AI routing + booking · TWI-03 one live agent per route (DB) · old status route can't make an agent live.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ReceptionistCenter, type RcCtx, type RcAccessRepo } from './receptionist-center';
import { FrontDeskCenter, effectiveState, refSuffix } from './front-desk-center';
import { canTransitionAgent } from './ai-agent-core';

const P = 'c7560000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const TA = id('a1'), TB = id('a2'), BA = id('b1'), BB = id('b2'), OWNER = id('e1'), MGR = id('e2');
const own: RcCtx = { tenantId: TA, branchId: BA, userId: OWNER, role: 'OWNER', permissions: ['ai.use', 'ai.manage'] };
const mgr: RcCtx = { tenantId: TA, branchId: BA, userId: MGR, role: 'MANAGER', permissions: ['ai.use', 'ai.manage'] };
const ownB: RcCtx = { tenantId: TB, branchId: BB, userId: OWNER, role: 'OWNER', permissions: ['ai.use', 'ai.manage'] };
const allowed: RcAccessRepo = { loadSnapshot: async () => ({ tenantStatus: 'active', packageEnabled: true, subscription: { status: 'active' }, usage: { used: 0, limit: 0, overageEnabled: false }, hasPermission: true }) as never };
const bizOk = { readiness: async () => ({ core: [{ key: 'hours', status: 'READY', detail: 'ok' }, { key: 'services', status: 'READY', detail: 'ok' }, { key: 'technicians', status: 'READY', detail: 'ok' }] }) };
const ENV = { TWILIO_ACCOUNT_SID: 'ACxxxxxxxx', TWILIO_AUTH_TOKEN: 'tok', RETELL_API_KEY: 'rk', VOICE_WRITE_TOOLS_ENABLED: 'true' } as NodeJS.ProcessEnv;
let db: any; let rc: ReceptionistCenter; let fd: FrontDeskCenter; let k = 0;
const key = () => 'fd-test-key-' + String(++k).padStart(4, '0');
const q1 = async (s: any) => (await s.execute(db)).rows[0];
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e: any) { return e?.code ?? e?.message; } }
async function call(t: string, b: string, ref: string, agentRef: string | null, minsAgo = 30, err: string | null = null) {
  const at = new Date(Date.now() - minsAgo * 60_000).toISOString();
  await sql`insert into voice_call_outcomes (tenant_id, branch_id, provider, provider_call_id, started_at, ended_at, duration_seconds, intents, abandoned, follow_up_required, error_category, agent_ref, created_at)
    values (${t}, ${b}, 'retell', ${ref}, ${at}, ${at}, 60, '["booking"]'::jsonb, false, false, ${err}, ${agentRef}, ${at})`.execute(db);
}
const agent = async (aid: string) => q1(sql`select * from ai_receptionist_agents where id = ${aid}`);
const ctl = async () => q1(sql`select activated, booking_armed, version from ai_receptionist_control where tenant_id = ${TA} and branch_id = ${BA}`);

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  rc = new ReceptionistCenter(db, allowed, bizOk, ENV);
  fd = new FrontDeskCenter(db, rc, bizOk);
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${TA}, 'A', 'Salon A', 'fd-a', 'FDA001', 'active'), (${TB}, 'B', 'Salon B', 'fd-b', 'FDB001', 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name, timezone) values (${BA}, ${TA}, 'Main Street', 'America/New_York'), (${BB}, ${TB}, 'Main', 'America/New_York')`.execute(db);
  await sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${TA}, 'Olivia Owner', 'o@fd.test', 'active', 'OWNER'), (${MGR}, ${TA}, 'Max Manager', 'm@fd.test', 'active', 'MANAGER')`.execute(db);
}, 240_000);

describe('directory, wizard drafts and search — UI-04, CRUD-01/02/03, SRCH, DATE, PAGE', () => {
  it('UI-04 an empty salon is an honest empty list (not an error), summary all zero', async () => {
    const l = await fd.list(own, {});
    expect(l.items).toEqual([]); expect(l.pagination.totalItems).toBe(0);
    expect((await fd.summary(own)).counts).toMatchObject({ total: 0, active: 0, draft: 0 });
  });
  it('CRUD-01 Create Agent saves a draft row only (no provider), appears first; a retried tap is the same draft; it survives reload', async () => {
    const k1 = key();
    const a = await fd.create(own, { name: 'Front Desk Ava', description: 'Main line', branchId: BA, idempotencyKey: k1 });
    expect(a.agent).toMatchObject({ status: 'draft', effective: 'draft', providerLinked: false, configVersion: 1, wizardStep: 2 });
    expect((await fd.create(own, { name: 'Front Desk Ava', branchId: BA, idempotencyKey: k1 })).replayed).toBe(true);
    expect(Number((await q1(sql`select count(*)::int n from ai_receptionist_agents where tenant_id = ${TA}`)).n)).toBe(1);
    const w = await fd.wizard(own, a.agent.id);
    expect(w.config.name).toBe('Front Desk Ava'); expect(w.steps[0].done).toBe(true); expect(w.steps[4].done).toBe(false);
    expect((await fd.list(own, {})).items[0].id).toBe(a.agent.id);
    expect(Number((await q1(sql`select count(*)::int n from ai_receptionist_agent_events where agent_id = ${a.agent.id} and action = 'created'`)).n)).toBe(1);
  });
  it('CRUD-02 save is version-checked (stale save refused), steps 1–4 complete → setup required; duplicate drops provider + routing', async () => {
    const a = (await fd.list(own, {})).items[0];
    const s1 = await fd.save(own, a.id, { expectedVersion: 1, step: 2 });
    expect(s1.agent.configVersion).toBe(2);
    expect(await code(fd.save(own, a.id, { expectedVersion: 1, step: 3 }))).toBe('AI_FD_VERSION_CONFLICT');
    expect(await code(fd.save(own, a.id, { expectedVersion: 2, step: 3, handoffDestination: '6095550100' }))).toBe('AI_FD_INVALID_INPUT');
    await fd.save(own, a.id, { expectedVersion: 2, step: 3, handoffDestination: '+16095550100', greeting: 'Hi, thanks for calling.' });
    const s4 = await fd.save(own, a.id, { expectedVersion: 3, step: 4, bookingMode: 'handoff_only' });
    expect(s4.agent).toMatchObject({ wizardComplete: true, effective: 'setup_required' });
    await sql`update ai_receptionist_agents set provider = 'retell', provider_agent_id = 'agent_full_ref_ava_001' where id = ${a.id}`.execute(db);
    const d = await fd.duplicate(own, a.id, { idempotencyKey: key() });
    expect(d.agent).toMatchObject({ status: 'draft', providerLinked: false, configVersion: 1 });
    expect(d.agent.id).not.toBe(a.id); expect(d.agent.name).toBe('Front Desk Ava (copy)');
    expect((await agent(d.agent.id)).provider_agent_id).toBeNull();
  });
  it('CRUD-03 archive needs confirmation; restore returns a draft; history is kept', async () => {
    const d = (await fd.list(own, { q: '(copy)' })).items[0];
    expect(await code(fd.archive(own, d.id, { expectedVersion: 1, reason: 'not needed', idempotencyKey: key() }))).toBe('AI_FD_CONFIRM_REQUIRED');
    const ar = await fd.archive(own, d.id, { expectedVersion: 1, reason: 'not needed', idempotencyKey: key(), confirm: true });
    expect(ar.agent.status).toBe('archived');
    expect((await fd.list(own, {})).items.map((x) => x.id)).not.toContain(d.id);   // "All" hides archived
    expect((await fd.list(own, { status: 'archived' })).items.map((x) => x.id)).toContain(d.id);
    expect(await code(fd.save(own, d.id, { expectedVersion: 1, step: 1, name: 'x' }))).toBe('AI_FD_ARCHIVED');
    const re = await fd.restore(own, d.id, { expectedVersion: 1, reason: 'bring it back', idempotencyKey: key() });
    expect(re.agent.status).toBe('draft');
    expect((await fd.events(own, { agentId: d.id })).items.map((e) => e.action)).toEqual(['restored', 'archived', 'duplicated']);
  });
  it('SRCH-01/03 name, id prefix, provider ref and branch name search server-side; another salon sees nothing and gets 404', async () => {
    const ava = (await fd.list(own, { q: 'Ava' })).items;
    expect(ava.length).toBe(2);
    const a = ava.find((x) => !x.name.includes('copy'))!;
    expect((await fd.list(own, { q: a.id.slice(0, 13) })).items.map((x) => x.id)).toContain(a.id);
    expect((await fd.list(own, { q: 'full_ref_ava' })).items.map((x) => x.id)).toEqual([a.id]);
    expect((await fd.list(own, { q: 'Main Street' })).pagination.totalItems).toBe(2);
    expect(JSON.stringify(await fd.list(own, {}))).not.toContain('agent_full_ref_ava_001');   // provider id only as a suffix
    expect((await fd.list(ownB, { q: 'Ava' })).items).toEqual([]);
    expect(await code(fd.detail(ownB, a.id))).toBe('AI_FD_NOT_FOUND');
    expect(await code(fd.save(ownB, a.id, { expectedVersion: 4, step: 1 }))).toBe('AI_FD_NOT_FOUND');
  });
  it('DATE-02 created-date range is salon-local and inclusive of the To day; bad dates refused', async () => {
    const y = (await q1(sql`select ((now() at time zone 'America/New_York')::date)::text d`)).d as string;
    await sql`update ai_receptionist_agents set created_at = (${y}::date::timestamp + interval '30 seconds') at time zone 'America/New_York' where tenant_id = ${TA} and name like '%(copy)%'`.execute(db);
    expect((await fd.list(own, { from: y, to: y, dateBasis: 'created' })).items.map((x) => x.name)).toContain('Front Desk Ava (copy)');
    const prev = (await q1(sql`select (${y}::date - 1)::text d`)).d as string;
    expect((await fd.list(own, { from: prev, to: prev, dateBasis: 'created' })).items).toEqual([]);
    expect(await code(fd.list(own, { from: '2026-13-01', to: y }))).toBe('AI_FD_INVALID_FILTER');
    expect(await code(fd.list(own, { from: y, to: prev }))).toBe('AI_FD_INVALID_FILTER');
  });
  it('PAGE-01/02 10/20/50 pages, stable newest-first order with no duplicates; a new draft lands on page 1', async () => {
    for (let i = 0; i < 21; i++) await sql`insert into ai_receptionist_agents (tenant_id, branch_id, name, status, created_at) values (${TA}, ${BA}, ${'Bulk ' + String(i).padStart(2, '0')}, 'draft', now() - make_interval(mins => ${i + 5}))`.execute(db);
    const seen: string[] = [];
    for (const p of [1, 2, 3]) { const l = await fd.list(own, { page: p, pageSize: 10 }); expect(l.pagination.totalPages).toBe(3); seen.push(...l.items.map((x) => x.id)); }
    expect(new Set(seen).size).toBe(23); expect(seen.length).toBe(23);
    expect((await fd.list(own, { pageSize: 37 })).pagination.pageSize).toBe(20);
    const n = await fd.create(own, { name: 'Newest Desk', branchId: BA, idempotencyKey: key() });
    expect((await fd.list(own, { pageSize: 10 })).items[0].id).toBe(n.agent.id);
    expect((await fd.list(own, { status: 'paused', q: 'Newest' })).items).toEqual([]);   // the screen explains "hidden by filters"
  });
});

describe('activation, routing monitor and safety — ACT-01…05, SEC-02, TWI-03', () => {
  let avaId = ''; let benId = '';
  it('ACT-01 the system + agent checks are read-only and recorded; repeated presses are rate-limited', async () => {
    avaId = (await fd.list(own, { q: 'full_ref_ava' })).items[0].id;   // set up here: the runner hoists beforeAll hooks
    await sql`update ai_receptionist_agents set status = 'ready' where id = ${avaId}`.execute(db);
    const before = JSON.stringify(await q1(sql`select status, config_version, updated_at from ai_receptionist_agents where id = ${avaId}`));
    const h = await fd.systemHealth(own);
    expect(h.checks.map((c) => c.id)).toEqual(expect.arrayContaining(['fd.registry', 'fd.one_live', 'fd.mapping', 'fd.orphans', 'fd.drift', 'tw.route', 'rt.agent']));
    expect(h.note).toMatch(/Read-only/);
    expect(await code(fd.systemHealth(own))).toBe('AI_FD_HEALTH_RATE_LIMITED');
    const ah = await fd.agentHealth(own, avaId);
    expect(ah.checks.find((c) => c.id === 'ag.route')!.state).toBe('DISABLED');
    expect(JSON.stringify(await q1(sql`select status, config_version, updated_at from ai_receptionist_agents where id = ${avaId}`))).toBe(before);
    expect(await ctl()).toBeUndefined();   // no control row was created or changed by a check
    expect(Number((await q1(sql`select count(*)::int n from ai_receptionist_health_runs where tenant_id = ${TA} and scope in ('agent', 'front_desk')`)).n)).toBe(2);
    expect(await code(rc.health(own))).not.toBe('AI_RCPT_HEALTH_RATE_LIMITED');   // the guide-21 check is not blocked by these runs
  });
  it('ACT-02 / SEC-02 an unready agent cannot activate (every blocker listed); a manager cannot approve live routing', async () => {
    const pre = await fd.activationPreview(own, avaId);
    expect(pre.ready).toBe(false);
    expect(pre.blockers.map((b) => b.id)).toEqual(expect.arrayContaining(['tw.account', 'tw.route', 'key.active', 'rd.test_call']));
    expect(await code(fd.activate(mgr, avaId, { expectedVersion: 4, reason: 'go live now', idempotencyKey: key(), confirm: true }))).toBe('AI_FD_OWNER_REQUIRED');
    expect(await code(fd.activate(own, avaId, { expectedVersion: 4, reason: 'go live now', idempotencyKey: key(), confirm: true }))).toBe('AI_FD_ACTIVATION_BLOCKED');
    expect(await code(fd.activate(own, avaId, { expectedVersion: 4, reason: 'go live now', idempotencyKey: key() }))).toBe('AI_FD_CONFIRM_REQUIRED');
    expect((await agent(avaId)).status).toBe('ready');
  });
  it('ACT-03 owner activation succeeds only once the recorded test call was answered by THIS agent; then "active"', async () => {
    await sql`insert into tenant_messaging_credentials (tenant_id, provider, account_sid, auth_token_enc, from_number, status, last_validated_at, branch_id)
      values (${TA}, 'twilio', 'AC_salon_a', 'enc', '+16095550100', 'configured', now(), null)`.execute(db);
    await sql`insert into voice_integration_keys (tenant_id, branch_id, label, provider, prefix, secret_hash) values (${TA}, ${BA}, 'live', 'retell', 'vk_live', 'h2')`.execute(db);
    await call(TA, BA, 'call_test_by_other', 'agent_someone_else', 40);
    await rc.controlAction(own, { action: 'verify_test_call', expectedVersion: 0, reason: 'test call made', providerCallRef: 'call_test_by_other', idempotencyKey: key() });
    const pre = await fd.activationPreview(own, avaId);
    expect(pre.blockers.map((b) => b.id)).toEqual(['route.test_agent']);   // the route reached a different agent → not proven
    await call(TA, BA, 'call_test_by_ava', 'agent_full_ref_ava_001', 20);
    const c0 = await ctl();
    await rc.controlAction(own, { action: 'verify_test_call', expectedVersion: Number(c0.version), reason: 'ava answered', providerCallRef: 'call_test_by_ava', idempotencyKey: key() });
    expect((await fd.activationPreview(own, avaId)).ready).toBe(true);
    const v = Number((await agent(avaId)).config_version);
    const k1 = key();
    const r = await fd.activate(own, avaId, { expectedVersion: v, reason: 'owner approved go-live', idempotencyKey: k1, confirm: true });
    expect(r.agent).toMatchObject({ status: 'live', effective: 'active' }); expect(r.priorAgentId).toBeNull();
    expect((await fd.activate(own, avaId, { expectedVersion: v, reason: 'owner approved go-live', idempotencyKey: k1, confirm: true })).replayed).toBe(true);
    expect((await ctl()).activated).toBe(true);
    expect((await fd.summary(own)).counts.active).toBe(1);
    expect(Number((await q1(sql`select count(*)::int n from audit_events where tenant_id = ${TA} and module = 'ai_front_desk' and action = 'agent.activated'`)).n)).toBe(1);
    expect((await fd.monitor(own)).providerRoute).toMatchObject({ drift: false, state: 'READY' });
    expect(await code(fd.save(own, avaId, { expectedVersion: v, step: 3 }))).toBe('AI_FD_LIVE_LOCKED');
  });
  it('the plain status route can no longer make an agent live or take a live one out (§7 invariant)', () => {
    expect(canTransitionAgent('ready', 'live')).toBe(false);
    expect(canTransitionAgent('live', 'paused')).toBe(false);
    expect(canTransitionAgent('live', 'archived')).toBe(false);
  });
  it('drift: a later call reached another agent → this live agent is "degraded", system check FAILED (no false green)', async () => {
    await call(TA, BA, 'call_drift', 'agent_someone_else', 5);
    expect((await fd.list(own, { q: 'full_ref_ava' })).items[0].effective).toBe('degraded');
    expect((await fd.monitor(own)).providerRoute).toMatchObject({ drift: true, state: 'FAILED' });
    await sql`select pg_sleep(0)`.execute(db);
    await call(TA, BA, 'call_back_to_ava', 'agent_full_ref_ava_001', 1);
    expect((await fd.list(own, { q: 'full_ref_ava' })).items[0].effective).toBe('active');
  });
  it('ACT-04 an activation that fails part-way leaves the previous route untouched; rollback restores the prior agent', async () => {
    benId = (await fd.create(own, { name: 'Ben Desk', branchId: BA, idempotencyKey: key() })).agent.id;
    for (const [v, s] of [[1, 2], [2, 3], [3, 4]] as const) await fd.save(own, benId, { expectedVersion: v, step: s, ...(s === 3 ? { handoffDestination: 'front_desk' } : {}) });
    await sql`update ai_receptionist_agents set status = 'ready', provider = 'retell', provider_agent_id = 'agent_full_ref_ava_001_b' where id = ${benId}`.execute(db);
    // route proof for Ben: a call Ben answered is the verified test call
    await call(TA, BA, 'call_test_by_ben', 'agent_full_ref_ava_001_b', 0);
    const c1 = await ctl();
    await rc.controlAction(own, { action: 'verify_test_call', expectedVersion: Number(c1.version), reason: 'ben answered', providerCallRef: 'call_test_by_ben', idempotencyKey: key() });
    const broken = new FrontDeskCenter(db, rc, bizOk);
    (broken as unknown as { salonActivation: () => Promise<void> }).salonActivation = async () => { throw new Error('injected provider/route failure'); };
    expect(await code(broken.activate(own, benId, { expectedVersion: 4, reason: 'switch to ben', idempotencyKey: key(), confirm: true }))).toBe('injected provider/route failure');
    expect((await agent(avaId)).status).toBe('live'); expect((await agent(benId)).status).toBe('ready');   // nothing half-done
    const r = await fd.activate(own, benId, { expectedVersion: 4, reason: 'switch to ben', idempotencyKey: key(), confirm: true });
    expect(r.priorAgentId).toBe(avaId);
    expect((await agent(avaId)).status).toBe('ready'); expect((await agent(benId)).status).toBe('live');
    expect((await fd.events(own, { agentId: avaId })).items[0].action).toBe('demoted');
    // rollback to Ava needs Ava's route proof again (same gates) — prove it, then roll back
    await call(TA, BA, 'call_ava_again', 'agent_full_ref_ava_001', 0);
    const c2 = await ctl();
    await rc.controlAction(own, { action: 'verify_test_call', expectedVersion: Number(c2.version), reason: 'ava answers again', providerCallRef: 'call_ava_again', idempotencyKey: key() });
    expect(await code(fd.rollback(mgr, benId, { expectedVersion: 1, reason: 'roll back please', idempotencyKey: key(), confirm: true }))).toBe('AI_FD_OWNER_REQUIRED');
    const rb = await fd.rollback(own, benId, { expectedVersion: 1, reason: 'ben misbehaves, roll back', idempotencyKey: key(), confirm: true });
    expect(rb.agent.id).toBe(avaId); expect((await agent(avaId)).status).toBe('live'); expect((await agent(benId)).status).toBe('ready');
  });
  it('ACT-05 pausing the live agent stops AI routing and booking for the salon at once; archive of a live agent is refused', async () => {
    await rc.controlAction(own, { action: 'arm_booking', expectedVersion: Number((await ctl()).version), reason: 'booking allowed', idempotencyKey: key() });
    expect((await ctl()).booking_armed).toBe(true);
    const v = Number((await agent(avaId)).config_version);
    expect(await code(fd.archive(own, avaId, { expectedVersion: v, reason: 'archive live', idempotencyKey: key(), confirm: true }))).toBe('AI_FD_PAUSE_FIRST');
    const p = await fd.pause(mgr, avaId, { expectedVersion: v, reason: 'stop the AI now', idempotencyKey: key() });
    expect(p.salonStopped).toBe(true); expect(p.agent.status).toBe('paused');
    expect(await ctl()).toMatchObject({ activated: false, booking_armed: false });
    expect(await rc.bookingArmed(TA, BA)).toBe(false);
    const ev = (await q1(sql`select string_agg(action, ',' order by action) a from ai_receptionist_control_events where tenant_id = ${TA} and reason like 'Paused live agent%'`)).a;
    expect(ev).toBe('deactivate,disarm_booking');
    // resume of a previously-live agent goes back through the owner activation (manager refused)
    expect(await code(fd.resume(mgr, avaId, { expectedVersion: v, reason: 'resume please', idempotencyKey: key(), confirm: true }))).toBe('AI_FD_OWNER_REQUIRED');
  });
  it('TWI-03 the database allows only one live agent per route', async () => {
    await sql`update ai_receptionist_agents set status = 'live' where id = ${benId}`.execute(db);
    expect(await code(sql`update ai_receptionist_agents set status = 'live' where id = ${avaId}`.execute(db))).toMatch(/23505|uq_air_agents_one_live|duplicate key/);
  });
  it('effectiveState never says active without the salon live and the route reaching this agent', () => {
    const a = { status: 'live', providerAgentId: 'p1', wizardComplete: true };
    expect(effectiveState(a, { salonLive: true, routedAgentRef: 'p1' })).toBe('active');
    expect(effectiveState(a, { salonLive: false, routedAgentRef: 'p1' })).toBe('degraded');
    expect(effectiveState(a, { salonLive: true, routedAgentRef: 'p2' })).toBe('degraded');
    expect(effectiveState({ status: 'draft', providerAgentId: null, wizardComplete: true }, { salonLive: true, routedAgentRef: null })).toBe('setup_required');
    expect(refSuffix('agent_full_ref_ava_001')).toBe('…va_001');
  });
});

describe('Nov 3 audit — per-branch route, honest 24h counts', () => {
  it('each branch is judged by its own latest call: branch B\'s call does not make branch A\'s live agent degraded', () => {
    const route = { salonLive: true, routedAgentRef: 'agent_b', routed: [{ branchId: 'A', agentRef: 'agent_a' }, { branchId: 'B', agentRef: 'agent_b' }] };
    expect(effectiveState({ status: 'live', providerAgentId: 'agent_a', wizardComplete: true, branchId: 'A' }, route)).toBe('active');
    expect(effectiveState({ status: 'live', providerAgentId: 'agent_b', wizardComplete: true, branchId: 'B' }, route)).toBe('active');
    expect(effectiveState({ status: 'live', providerAgentId: 'agent_a', wizardComplete: true, branchId: 'B' }, route)).toBe('degraded');   // A's agent answering B is not B's route
    expect(effectiveState({ status: 'live', providerAgentId: 'agent_x', wizardComplete: true, branchId: 'A' }, route)).toBe('degraded');
    expect(effectiveState({ status: 'live', providerAgentId: 'agent_a', wizardComplete: true, branchId: null }, route)).toBe('active');    // salon-wide agent
  });
  it('handoffs24h counts real handoffs only and splits completed / failed transfers; bookings count created appointments only', async () => {
    const before = (await fd.monitor(own)).callSuccess;
    await call(TA, BA, 'call_h_none', 'agent_full_ref_ava_001', 3); await call(TA, BA, 'call_h_ok', 'agent_full_ref_ava_001', 3); await call(TA, BA, 'call_h_bad', 'agent_full_ref_ava_001', 3);
    await sql`update voice_call_outcomes set handoff_outcome = case provider_call_id when 'call_h_none' then 'none' when 'call_h_ok' then 'transferred' else 'transfer_failed' end
      where tenant_id = ${TA} and provider_call_id in ('call_h_none', 'call_h_ok', 'call_h_bad')`.execute(db);
    const after = (await fd.monitor(own)).callSuccess;
    expect(after.handoffs24h - before.handoffs24h).toBe(2);
    expect(after.transfersCompleted24h - before.transfersCompleted24h).toBe(1);
    expect(after.transfersFailed24h - before.transfersFailed24h).toBe(1);
  });
});
