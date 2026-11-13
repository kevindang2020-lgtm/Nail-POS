// team-bulk-invite.pgtest — round 11, extras 200-Technician Large Salon 08 (Nov 13 2026), on the REAL schema (migration 967).
// Bulk INVITE is a mechanism Kevin turns on: OFF by default (the run is refused with the reason and nothing is sent; the
// preview still explains the plan), a platform pause wins over the salon switch, at most 200 people per run, a run key makes
// a retry return the first answer (never a second send), each person goes through the existing invite sender with the
// per-person channel rule, every outcome is recorded once, and the run is audited without contacts or tokens.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ROLE_PERMISSIONS } from '@aipowersalon/permissions';
import { TeamBulkInviteRepository, BULK_INVITE_MAX } from './team-bulk-invite.repository';
import type { DeliverPort } from './team-onboarding.repository';

const P = 'fb7b0000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), BX = id('b9');
const OWNER = id('e1'), MGR = id('e2'), DESK = id('e3');
const MAIL = id('c1'), SMS = id('c2'), ACTIVE = id('c3'), NOCONTACT = id('c4'), RECENT = id('c5'), PENDING = id('c6'), MGR2 = id('c7'), GONE = id('c8'), OTHER = id('c9'), TECH = id('d1');
const perms = (r: string) => [...((ROLE_PERMISSIONS as Record<string, readonly string[]>)[r] ?? [])];
const owner = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: [...perms('OWNER'), 'pos.technicians.view', 'roles.manage'] };
const mgr = { tenantId: T, branchId: B, userId: MGR, role: 'MANAGER', permissions: [...perms('MANAGER'), 'pos.technicians.view', 'roles.manage'].filter((p) => p !== 'ownership.transfer') };
const desk = { tenantId: T, branchId: B, userId: DESK, role: 'FRONT_DESK', permissions: ['pos.technicians.view'] };
let pg: any; let db: any; let repo: TeamBulkInviteRepository;
const sent: any[] = [];
const deliver: DeliverPort = { async deliver(i) { sent.push(i); return { deliveryStatus: i.channel === 'email' ? 'delivered' : 'not_connected', manualToken: i.channel === 'email' ? null : 'manual' }; } };
const q = (s: string, p: unknown[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e: any) { return { status: e?.getStatus?.() ?? e?.status, code: e?.response?.code ?? e?.code, body: e?.response }; } throw new Error('expected a failure'); };
const ALL = [MAIL, SMS, ACTIVE, NOCONTACT, RECENT, PENDING, MGR2, GONE, OTHER, TECH, id('ff')];
const invitations = async () => Number((await q(`select count(*)::int n from user_invitations where tenant_id = $1`, [T]))[0].n);
const runs = async () => Number((await q(`select count(*)::int n from staff_bulk_invite_runs where tenant_id = $1`, [T]))[0].n);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Bulk LLC','Bulk','bi-a','BIA001','active'), ($2,'Other LLC','Other','bi-b','BIB001','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Elsewhere','active','America/New_York')`, [B, T, BX, T2]);
  const user = (uid: string, tenant: string, name: string, role: string, status: string, email: string | null, phone: string | null) =>
    q(`insert into users (id, tenant_id, branch_id, full_name, email, normalized_phone, role, status) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [uid, tenant, tenant === T ? B : BX, name, email, phone, role, status]);
  await user(OWNER, T, 'Olive Owner', 'OWNER', 'active', 'olive@bulk.test', '+18565550001');
  await user(MGR, T, 'Mai Manager', 'MANAGER', 'active', 'mai@bulk.test', '+18565550002');
  await user(DESK, T, 'Vy Desk', 'FRONT_DESK', 'active', 'vy@bulk.test', '+18565550003');
  await user(MAIL, T, 'Mia Mail', 'TECHNICIAN', 'invited', 'Mia@Bulk.test', '+18565550011');
  await user(SMS, T, 'Sam Sms', 'TECHNICIAN', 'invited', null, '+18565550012');
  await user(ACTIVE, T, 'Ana Active', 'TECHNICIAN', 'active', 'ana@bulk.test', null);
  await user(NOCONTACT, T, 'Ned None', 'TECHNICIAN', 'invited', null, null);
  await user(RECENT, T, 'Rae Recent', 'RECEPTION', 'invited', 'rae@bulk.test', null);
  await user(PENDING, T, 'Pia Pending', 'TECHNICIAN', 'invited', 'pia@bulk.test', null);
  await user(MGR2, T, 'Max Manager', 'MANAGER', 'invited', 'max@bulk.test', null);
  await user(GONE, T, 'Gus Gone', 'TECHNICIAN', 'inactive', 'gus@bulk.test', null);
  await user(OTHER, T2, 'Oz Other', 'TECHNICIAN', 'invited', 'oz@other.test', null);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active, role_label, normalized_phone) values ($1,$2,$3,'Tia','x','Tia NoLogin','active',true,'Technician','+18565550099')`, [TECH, T, B]);
  // Rae was invited an hour ago; Pia has an older pending invitation (3 days)
  await q(`insert into user_invitations (tenant_id, email, role, user_id, token_hash, token_prefix, expires_at, created_at) values ($1,'rae@bulk.test','RECEPTION',$2,'h-rae','p-rae', now() + interval '6 days', now() - interval '1 hour'),
           ($1,'pia@bulk.test','TECHNICIAN',$3,'h-pia','p-pia', now() + interval '4 days', now() - interval '3 days')`, [T, RECENT, PENDING]);
  repo = new TeamBulkInviteRepository(db, deliver);
}, 180_000);

describe('200-Technician 08 (round 11) — OFF by default: nothing is sent', () => {
  it('availability says off and why; the preview explains the plan and writes nothing; the run is refused, audited, sends nothing', async () => {
    expect(await repo.availability(owner)).toMatchObject({ tenantEnabled: false, platformPaused: false, available: false, offReason: 'salon_setting_off', maxPerRun: BULK_INVITE_MAX, recentHours: 24 });
    const before = await invitations();
    const p = await repo.preview(mgr, { memberIds: ALL });
    const by = Object.fromEntries(p.items.map((i) => [i.memberId, i]));
    expect(by[MAIL]).toMatchObject({ action: 'invite', channel: 'email', contactHint: 'm•••@bulk.test', reason: null });
    expect(by[SMS]).toMatchObject({ action: 'invite', channel: 'sms', contactHint: '••• 0012' });
    expect(by[PENDING]).toMatchObject({ action: 'invite', channel: 'email' });
    expect(by[ACTIVE]).toMatchObject({ action: 'skip', reason: 'already_active' });
    expect(by[NOCONTACT]).toMatchObject({ action: 'skip', reason: 'no_contact' });
    expect(by[RECENT]).toMatchObject({ action: 'skip', reason: 'recently_invited' });
    expect(by[MGR2]).toMatchObject({ action: 'skip', reason: 'role_above_yours' });   // a manager invites below their own level only
    expect(by[GONE]).toMatchObject({ action: 'skip', reason: 'not_current' });
    expect(by[TECH]).toMatchObject({ action: 'skip', reason: 'no_login_account', name: 'Tia NoLogin' });
    expect(by[OTHER]).toMatchObject({ action: 'skip', reason: 'not_found' });            // another salon's person is never seen
    expect(by[id('ff')]).toMatchObject({ action: 'skip', reason: 'not_found' });
    expect(p).toMatchObject({ selected: 11, willInvite: 3, skipped: 8, availability: { available: false } });
    expect(JSON.stringify(p)).not.toContain('Mia@Bulk.test');                            // contacts are masked
    const r = await fails(repo.run(mgr, { memberIds: ALL, runKey: 'run-key-off-0001' }, 'req-1'));
    expect(r).toMatchObject({ status: 409, code: 'CONFLICT', body: { offReason: 'salon_setting_off' } });
    expect(sent).toEqual([]); expect(await invitations()).toBe(before); expect(await runs()).toBe(0);
    expect((await q(`select count(*)::int n from audit_events where tenant_id = $1 and action = 'team.bulk_invite.refused'`, [T]))[0].n).toBe(1);
  });
  it('front desk (no roles.manage) may not preview or run; more than 200 people and a missing run key are refused', async () => {
    expect(await fails(repo.preview(desk, { memberIds: [MAIL] }))).toMatchObject({ status: 403 });
    expect(await fails(repo.run(desk, { memberIds: [MAIL], runKey: 'run-key-desk-01' }, 'r'))).toMatchObject({ status: 403 });
    const many = Array.from({ length: 201 }, (_, i) => `fb7b0000-0000-4000-8000-${String(100000 + i).padStart(12, '0')}`);
    expect(await fails(repo.preview(owner, { memberIds: many }))).toMatchObject({ status: 400, body: { max: 200 } });
    expect(await fails(repo.run(owner, { memberIds: [MAIL], runKey: 'short' }, 'r'))).toMatchObject({ status: 400, body: { field: 'runKey' } });
    expect(await fails(repo.preview(owner, { memberIds: [] }))).toMatchObject({ status: 400 });
  });
});

describe('200-Technician 08 (round 11) — switched on', () => {
  it('the salon switch is validated and audited with before / after', async () => {
    expect(await fails(repo.setEnabled(owner, { enabled: 'on' }))).toMatchObject({ status: 400 });
    const a = await repo.setEnabled(owner, { enabled: true });
    expect(a).toMatchObject({ tenantEnabled: true, available: true, offReason: null });
    const ev = await q(`select before_state, after_state from audit_events where tenant_id = $1 and action = 'team.bulk_invite.setting_changed'`, [T]);
    expect(ev).toEqual([{ before_state: { enabled: false }, after_state: { enabled: true } }]);
  });
  it('a platform pause wins over the salon switch', async () => {
    await q(`insert into platform_settings (setting_key, setting_group, value, value_type) values ('staff.bulk_invites_disabled', 'kill_switches', 'true'::jsonb, 'boolean')`);
    expect(await repo.availability(owner)).toMatchObject({ tenantEnabled: true, platformPaused: true, available: false, offReason: 'platform_paused' });
    expect(await fails(repo.run(owner, { memberIds: [MAIL], runKey: 'run-key-paused-1' }, 'r'))).toMatchObject({ status: 409, body: { offReason: 'platform_paused' } });
    expect(sent).toEqual([]);
    await q(`update platform_settings set value = 'false'::jsonb where setting_key = 'staff.bulk_invites_disabled'`);
  });
  it('the run invites through the existing sender (channel per person), records every outcome once, is audited; a retry with the key sends nothing more', async () => {
    const out = await repo.run(mgr, { memberIds: ALL, runKey: 'run-key-real-0001' }, 'req-2');
    expect(out).toMatchObject({ replayed: false, selected: 11, sent: 2, notDelivered: 1, skipped: 8, failed: 0 });
    const o = Object.fromEntries(out.outcomes.map((x) => [x.memberId, x]));
    expect(o[MAIL]).toEqual({ memberId: MAIL, outcome: 'sent', reason: null, channel: 'email' });
    expect(o[SMS]).toEqual({ memberId: SMS, outcome: 'not_delivered', reason: 'not_connected', channel: 'sms' });
    expect(o[RECENT]).toMatchObject({ outcome: 'skipped', reason: 'recently_invited' });
    expect(sent.map((s) => [s.channel, s.to]).sort()).toEqual([['email', 'mia@bulk.test'], ['email', 'pia@bulk.test'], ['sms', '+18565550012']]);
    // Pia's pending invitation got a fresh token (send count 2), the others a new invitation; no raw token is stored
    const pia = await q(`select send_count, token_hash from user_invitations where tenant_id = $1 and user_id = $2`, [T, PENDING]);
    expect(pia.length).toBe(1); expect(pia[0].send_count).toBe(2); expect(pia[0].token_hash).not.toBe('h-pia');
    expect((await q(`select role, delivery_channel from user_invitations where tenant_id = $1 and user_id = $2`, [T, SMS]))).toEqual([{ role: 'TECHNICIAN', delivery_channel: 'sms' }]);
    const run = (await q(`select status, sent_count, skipped_count, outcomes from staff_bulk_invite_runs where tenant_id = $1`, [T]));
    expect(run.length).toBe(1); expect(run[0]).toMatchObject({ status: 'done', sent_count: 2, skipped_count: 8 });
    expect(JSON.stringify(run[0].outcomes)).not.toMatch(/bulk\.test|\+1856/);           // no contact in the record
    const audit = await q(`select metadata from audit_events where tenant_id = $1 and action = 'team.bulk_invite.run'`, [T]);
    expect(audit.length).toBe(1); expect(audit[0].metadata).toMatchObject({ selected: 11, sent: 2, notDelivered: 1, skipped: 8, failed: 0 });
    // the same key again: the first answer, nothing sent
    const n = sent.length;
    const again = await repo.run(mgr, { memberIds: [...ALL].reverse(), runKey: 'run-key-real-0001' }, 'req-3');
    expect(again).toMatchObject({ replayed: true, runId: out.runId, sent: 2 });
    expect(sent.length).toBe(n);
    expect(await fails(repo.run(mgr, { memberIds: [MAIL], runKey: 'run-key-real-0001' }, 'r'))).toMatchObject({ status: 422, code: 'IDEMPOTENCY_KEY_REUSED' });
    // a new run right after: everyone just invited is skipped for 24 hours
    const next = await repo.preview(mgr, { memberIds: [MAIL, SMS, PENDING] });
    expect(next.items.map((i) => i.reason)).toEqual(['recently_invited', 'recently_invited', 'recently_invited']);
  });
  it('a finished run can never be changed or removed', async () => {
    await expect(q(`update staff_bulk_invite_runs set sent_count = 99 where tenant_id = $1`, [T])).rejects.toThrow(/append-only/);
    await expect(q(`delete from staff_bulk_invite_runs where tenant_id = $1`, [T])).rejects.toThrow(/append-only/);
  });
});
