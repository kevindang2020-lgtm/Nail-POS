// eod-center.pgtest — End-of-Day Follow-Ups Complete Build Guide (Oct 30 2026) on the REAL schema (through 745).
// The 8 PM generation and Preview Tonight share ONE eligibility rule; Preview writes nothing; expiry keeps history and
// can never race a send; the customer protections are re-checked inside the send; approvals / rejections are server-
// side; history search, date basis and pages are server-side; another salon sees nothing.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { DailyFollowUpService } from './end-of-day-followups.service';
import { KyselyDailyFollowUpRepository } from './end-of-day-followups.kysely.repository';
import { EodCenter, loadEodCandidates, summarizeCandidates, EOD_RULE_VERSION } from './eod-center';
import type { FollowUpContext } from './end-of-day-followups.dto';

const P = 'e7450000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const T = id('a1'), B = id('b1'), TX = id('a9'), BX = id('b9');
const OWNER = id('e1'), U1 = id('e11'), U2 = id('e12');            // OWNER = manager user, U1/U2 = technician users
const T1 = id('71'), T2 = id('72'), CAT = id('c0'), SVC = id('c1');
const C = (n: number) => id(`d${n}`);                               // customers
const APP = (n: number) => id(`f${n}`);                             // customer app users
const TZ = 'America/New_York';
const GEN_NOW = new Date('2026-11-01T00:30:00Z');                   // 20:30 EDT, Oct 31 — the business date is 2026-10-31
let pg: any; let db: any; let repo: KyselyDailyFollowUpRepository; let svc: DailyFollowUpService; let center: EodCenter;
const q = (s: string, p: unknown[] = []) => pg.query(s, p).then((r: any) => r.rows);
const mgr: FollowUpContext = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['customers.edit'] };
const tech1: FollowUpContext = { tenantId: T, branchId: B, userId: U1, role: 'TECHNICIAN', permissions: [] };
const tech2: FollowUpContext = { tenantId: T, branchId: B, userId: U2, role: 'TECHNICIAN', permissions: [] };
let line = 0;
async function serviceLine(cust: string, tech: string, completedIso: string) {
  line++;
  const tk = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, paid_at, total_cents, ticket_number) values ($1,$2,$3,'paid',$4,5000,$5) returning id`, [T, B, cust, completedIso, `T-${1000 + line}`]))[0].id;
  await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, technician_id, status, completed_at)
           values ($1,$2,$3,$4,'Gel manicure',5000,60,5000,$5,'completed',$6)`, [T, B, tk, SVC, tech, completedIso]);
  return tk;
}
async function rawTask(cust: string, tech: string, status = 'pending', extra: { app?: string | null; sentAt?: string; createdAt?: string } = {}) {
  line++;
  return (await q(`insert into service_follow_up_tasks (tenant_id, branch_id, business_date, customer_id, technician_id, ticket_id, ticket_service_line_id, customer_name_snapshot,
      technician_name_snapshot, customer_app_user_id, status, suggested_message, sent_at, created_at, customer_phone_snapshot)
    values ($1,$2,'2026-10-31',$3,$4,$5,$6,(select full_name from customers where id = $3),'Tech',$7,$8,'Thanks for visiting!',$9,coalesce($10::timestamptz, now()),'+1 (609) 555-01${String(line).padStart(2, '0')}') returning id`,
    [T, B, cust, tech, id('9' + line), id('8' + line), extra.app === undefined ? APP(1) : extra.app, status, extra.sentAt ?? null, extra.createdAt ?? null]))[0].id as string;
}
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e: any) { return e?.apiCode ?? `${e?.name}:${e?.message}`; } }
const counts = async () => (await q(`select (select count(*) from service_follow_up_tasks where tenant_id = $1)::int t, (select count(*) from daily_follow_up_generation_runs where tenant_id = $1)::int r,
    (select count(*) from customer_notifications where tenant_id = $1)::int n, (select count(*) from technician_notifications where tenant_id = $1)::int a, (select count(*) from audit_logs where tenant_id = $1)::int l`, [T]))[0];

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  repo = new KyselyDailyFollowUpRepository(db, null); svc = new DailyFollowUpService(repo); center = new EodCenter(db);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Salon','eod-s','EODS01','active'), ($2,'X','Other','eod-x','EODX01','active')`, [T, TX]);
  await q(`insert into branches (id, tenant_id, name, timezone, status) values ($1,$2,'Main',$5,'active'), ($3,$4,'Other',$5,'active')`, [B, T, BX, TX, TZ]);
  for (const [u, r] of [[OWNER, 'OWNER'], [U1, 'TECHNICIAN'], [U2, 'TECHNICIAN']]) await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,'U',$3,'active',$4)`, [u, T, `${u.slice(-4)}@eod.test`, r]);
  await q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, is_active) values ($1,$2,$3,$4,'Ana','One','Ana One',true), ($5,$2,$3,$6,'Bo','Two','Bo Two',true)`, [T1, T, B, U1, T2, U2]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Gel manicure',60,5000)`, [SVC, T, B, CAT]);
  const people: [number, string, boolean, string][] = [[1, 'Ava Kim', true, 'active'], [2, 'Ben Lo', false, 'active'], [3, 'Cara Archived', true, 'archived'], [4, 'Dina Booked', true, 'active'],
    [5, 'Eve Recent', true, 'active'], [6, 'Finn Twice', true, 'active'], [7, 'Gus Later', true, 'active'], [8, 'Hana Approve', true, 'active'], [9, 'Ivy Expire', true, 'active']];
  for (const [n, name, app, status] of people) {
    if (app) await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,$3,$4,'active','CUSTOMER')`, [APP(n), T, name, `c${n}@eod.test`]);
    const [f, l] = name.split(' ');
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, status, user_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [C(n), T, B, f, l, name, `+1609555010${n}`, `(609) 555-010${n}`, status, app ? APP(n) : null]);
  }
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$2,$3,'Xo','Other','Xo Other','active')`, [id('dae'), TX, BX]);
  await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status) values ($1,$2,$3,$4,'Dina Booked','2026-12-15','10:00','11:00','booked')`, [T, B, T1, C(4)]);
  // Eve got a follow-up 90 minutes before the run (inside the 24 h cooldown)
  await rawTask(C(5), T1, 'sent', { sentAt: '2026-10-31T23:00:00Z', app: APP(5) });
  // the business day 2026-10-31 in New York: 03:59Z Nov 1 is 23:59 EDT Oct 31 (in); 04:30Z is 00:30 Nov 1 (out); 03:30Z Oct 31 is 23:30 Oct 30 (out)
  await serviceLine(C(1), T1, '2026-11-01T03:59:00Z');
  await serviceLine(C(1), T1, '2026-11-01T04:30:00Z');
  await serviceLine(C(1), T2, '2026-10-31T03:30:00Z');
  await serviceLine(C(2), T2, '2026-10-31T18:00:00Z');
  await serviceLine(C(3), T1, '2026-10-31T18:10:00Z');
  await serviceLine(C(4), T1, '2026-10-31T18:20:00Z');
  await serviceLine(C(5), T2, '2026-10-31T18:30:00Z');
  await serviceLine(C(6), T1, '2026-10-31T19:00:00Z');
  await serviceLine(C(6), T2, '2026-10-31T19:10:00Z');
}, 240_000);

describe('one eligibility rule: Preview Tonight = the 8 PM run, and Preview writes nothing (guide §6, §7)', () => {
  let previewTotals: any;
  it('preview counts eligible lines in the SALON-LOCAL day (DST-safe) with explicit exclusion reasons — and writes nothing', async () => {
    const before = await counts();
    const cands = await loadEodCandidates(db, { tenantId: T, branchId: B, tz: TZ, businessDate: '2026-10-31', cooldownHours: 24, now: GEN_NOW });
    previewTotals = summarizeCandidates(cands);
    expect(previewTotals).toEqual({ candidates: 7, wouldCreate: 4, excluded: 3, reasons: { already_generated: 0, customer_archived: 1, already_booked: 1, recently_contacted: 1 }, noApp: 1 });
    expect(cands.filter((c) => c.customerId === C(1)).map((c) => c.completedAt)).toEqual(['2026-11-01T03:59:00.000Z']);   // 23:59 EDT in, 00:30 / previous day out
    expect(await counts()).toEqual(before);
  });
  it('the scheduled run creates exactly what the preview said, records the diagnostic trace, and alerts each technician once', async () => {
    const r = await svc.generateForBranch(T, B, { now: GEN_NOW, triggerSource: 'scheduler' });
    expect(r).toMatchObject({ businessDate: '2026-10-31', created: previewTotals.wouldCreate, alreadyRan: false });
    const run = (await q(`select run_status, created_count, candidates_count, excluded_count, exclusions_json, rule_version, run_timezone, generation_time from daily_follow_up_generation_runs where tenant_id = $1`, [T]))[0];
    expect(run).toMatchObject({ run_status: 'completed', created_count: 4, candidates_count: 7, excluded_count: 3, rule_version: EOD_RULE_VERSION, run_timezone: TZ, generation_time: '20:00' });
    expect(run.exclusions_json).toMatchObject({ customer_archived: 1, already_booked: 1, recently_contacted: 1, no_app: 1 });
    expect((await q(`select technician_id from technician_notifications where tenant_id = $1 and type = 'daily_followup_ready' order by technician_id`, [T])).length).toBe(2);
  });
  it('a re-run (scheduler retry or Generate Now) creates no duplicate and no second technician alert', async () => {
    expect((await svc.generateForBranch(T, B, { now: GEN_NOW, triggerSource: 'scheduler' })).alreadyRan).toBe(true);
    await serviceLine(C(7), T1, '2026-10-31T20:00:00Z');             // a late checkout — Generate Now tops it up
    const r = await svc.managerGenerateNow({ ...mgr });
    expect(r.created).toBeLessThanOrEqual(1);
    const again = summarizeCandidates(await loadEodCandidates(db, { tenantId: T, branchId: B, tz: TZ, businessDate: '2026-10-31', cooldownHours: 24, now: GEN_NOW }));
    expect(again.reasons.already_generated).toBeGreaterThanOrEqual(4);
    expect((await q(`select count(*)::int n from technician_notifications where tenant_id = $1 and type = 'daily_followup_ready' and reference = '2026-10-31'`, [T]))[0].n).toBe(2);
  });
});

describe('send: customer protection re-checked at send time, in one transaction (guide §8)', () => {
  const taskOf = async (cust: string, tech: string) => (await q(`select id from service_follow_up_tasks where tenant_id = $1 and customer_id = $2 and technician_id = $3 and status <> 'sent' order by created_at limit 1`, [T, cust, tech]))[0]?.id as string;
  it('a technician sends their own task once; a double tap is a no-op (one Customer App message)', async () => {
    const t = await taskOf(C(1), T1);
    const a = await svc.techSend(tech1, t); const b = await svc.techSend(tech1, t);
    expect([a.status, b.status]).toEqual(['sent', 'sent']);
    expect((await q(`select count(*)::int n from customer_notifications where reference = $1`, [t]))[0].n).toBe(1);
  });
  it('another technician cannot send it; another salon cannot see or send it', async () => {
    const t = await taskOf(C(6), T1);
    expect(await code(svc.techSend(tech2, t))).toBe('FOLLOWUP_OTHER_TECHNICIAN');
    expect(await code(svc.managerSend({ tenantId: TX, branchId: BX, userId: OWNER, role: 'OWNER' }, t))).toBe('FOLLOWUP_NOT_FOUND');
    expect(await center.detail(TX, BX, t)).toBeNull();
    expect((await center.tasks(TX, BX, TZ, {})).total).toBe(0);
  });
  it('no Customer App account → "customer not available" (nothing sent); recorded, not hidden', async () => {
    const t = await taskOf(C(2), T2);
    expect((await svc.managerSend(mgr, t)).status).toBe('customer_not_available');
  });
  it('a client served by two technicians gets ONE follow-up: the second is refused (recently contacted) unless a manager writes a reason', async () => {
    expect((await svc.techSend(tech1, await taskOf(C(6), T1))).status).toBe('sent');
    const second = await taskOf(C(6), T2);
    expect(await code(svc.techSend(tech2, second))).toBe('FOLLOWUP_RECENTLY_CONTACTED');
    expect(await code(svc.managerSend(mgr, second, undefined, { reason: 'ok' }))).toBe('FOLLOWUP_OVERRIDE_REASON_REQUIRED');
    const out = await svc.managerSend(mgr, second, undefined, { reason: 'Client asked for aftercare tips from Bo' });
    expect(out.status).toBe('sent');
    expect((await q(`select override_reason from service_follow_up_tasks where id = $1`, [second]))[0].override_reason).toMatch(/^recently_contacted: Client asked/);
  });
  it('a task made before the customer booked is refused at send (already booked); an archived customer is refused even with a manager reason', async () => {
    const booked = await rawTask(C(4), T1, 'pending', { app: APP(4) });
    expect(await code(svc.techSend(tech1, booked))).toBe('FOLLOWUP_ALREADY_BOOKED');
    expect((await svc.managerSend(mgr, booked, undefined, { reason: 'Different service than the booking' })).status).toBe('sent');
    const archived = await rawTask(C(3), T1, 'pending', { app: APP(3) });
    expect(await code(svc.managerSend(mgr, archived, undefined, { reason: 'Owner wants to reach her' }))).toBe('FOLLOWUP_CUSTOMER_ARCHIVED');
    expect((await q(`select status from service_follow_up_tasks where id = $1`, [archived]))[0].status).toBe('pending');
    expect((await q(`select count(*)::int n from audit_logs where entity_id = $1 and action_type = 'service_follow_up_send_refused'`, [archived]))[0].n).toBe(1);
  });
});

describe('approval: submit → reject with a note → edit → resubmit → approve (guide §5, §9)', () => {
  it('runs end to end on the server, with the decision audited', async () => {
    await repo.saveSettings(mgr, { requireManagerApproval: true });
    const t = await rawTask(C(8), T1, 'pending', { app: APP(8) });
    expect((await svc.techSend(tech1, t, 'Hi Hana!')).status).toBe('pending_manager_approval');
    expect(await code(svc.managerReject(mgr, t, ''))).toBe('FOLLOWUP_REJECT_NOTE_REQUIRED');
    const rej = await svc.managerReject(mgr, t, 'Mention the aftercare oil');
    expect([rej.status, rej.managerNote]).toEqual(['rejected', 'Mention the aftercare oil']);
    expect(await code(svc.techSend(tech1, t, 'Hi Hana! Use the aftercare oil tonight.'))).toBe('ok');
    expect((await q(`select status, suggested_message from service_follow_up_tasks where id = $1`, [t]))[0]).toEqual({ status: 'pending_manager_approval', suggested_message: 'Hi Hana! Use the aftercare oil tonight.' });
    const ok = await svc.managerApprove(mgr, t);
    expect(ok.status).toBe('sent');
    expect((await q(`select approved_by_user_id from service_follow_up_tasks where id = $1`, [t]))[0].approved_by_user_id).toBe(OWNER);
    const d = await center.detail(T, B, t);
    expect(d!.timeline.map((e: any) => e.action)).toEqual(expect.arrayContaining(['tech_followup_submitted_for_approval', 'tech_followup_rejected', 'service_follow_up_sent', 'tech_followup_approved']));
    await repo.saveSettings(mgr, { requireManagerApproval: false });
  });
});

describe('24-hour expiry keeps history and can never send afterwards (guide §10)', () => {
  it('pending, awaiting-approval and rejected tasks expire as a STATUS — still in history, never sendable, never regenerated', async () => {
    const a = await rawTask(C(9), T1, 'pending', { createdAt: '2026-10-28T20:00:00Z', app: APP(9) });
    const b = await rawTask(C(9), T2, 'pending_manager_approval', { createdAt: '2026-10-28T20:00:00Z', app: APP(9) });
    const c = await rawTask(C(9), T1, 'rejected', { createdAt: '2026-10-28T20:00:00Z', app: APP(9) });
    const fresh = await rawTask(C(9), T2, 'pending', { app: APP(9) });
    await svc.expireStaleTasks(new Date());
    const rows = await q(`select id, status, expired_at is not null as ex, deleted_at is null as kept, skip_reason from service_follow_up_tasks where id = any($1::uuid[]) order by id`, [[a, b, c, fresh]]);
    const by = Object.fromEntries(rows.map((r: any) => [r.id, r]));
    for (const x of [a, b, c]) expect(by[x]).toMatchObject({ status: 'expired', ex: true, kept: true, skip_reason: 'expired_after_24h' });
    expect(by[fresh].status).toBe('pending');
    expect(await code(svc.managerSend(mgr, a, undefined, { reason: 'Send it anyway please' }))).toBe('FOLLOWUP_EXPIRED');
    expect((await center.tasks(T, B, TZ, { status: 'expired' })).items.map((i: any) => i.id)).toEqual(expect.arrayContaining([a, b, c]));
  });
  it('migration 745 brings back rows an earlier sweep hid — except one whose service line was generated again', async () => {
    const lineA = id('77001'), lineB = id('77002');
    const ins = (lineId: string, status: string, deleted: boolean) => q(`insert into service_follow_up_tasks (tenant_id, branch_id, business_date, customer_id, technician_id, ticket_id, ticket_service_line_id, status, deleted_at)
        values ($1,$2,'2026-10-01',$3,$4,$5,$6,$7,$8) returning id`, [T, B, C(1), T1, id('77009'), lineId, status, deleted ? '2026-10-02T00:00:00Z' : null]).then((r: any) => r[0].id);
    const hidden = await ins(lineA, 'expired', true);
    const shadowed = await ins(lineB, 'expired', true); await ins(lineB, 'pending', false);
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, '745_eod_follow_up_center.sql'), 'utf8'));   // cwd-independent (CI runs from the module dir)
    expect((await q(`select deleted_at is null as back, expired_at is not null as ex from service_follow_up_tasks where id = $1`, [hidden]))[0]).toEqual({ back: true, ex: true });
    expect((await q(`select deleted_at is null as back from service_follow_up_tasks where id = $1`, [shadowed]))[0].back).toBe(false);
  });
});

describe('history: server search, date basis, newest first, pages 10/20/50 (guide §11)', () => {
  beforeAll(async () => { for (let i = 0; i < 12; i++) await rawTask(C(7), T2, 'skipped', { app: APP(7) }); });
  it('finds by name, phone digits, technician, ticket number and exact ids — across pages', async () => {
    const t0 = (await q(`select f.id, t.ticket_number from service_follow_up_tasks f join tickets t on t.id = f.ticket_id where f.tenant_id = $1 and f.customer_id = $2 limit 1`, [T, C(6)]))[0];
    expect((await center.tasks(T, B, TZ, { q: 'finn' })).total).toBe(2);
    expect((await center.tasks(T, B, TZ, { q: '555-0101' })).items.length).toBeGreaterThan(0);
    expect((await center.tasks(T, B, TZ, { q: 'Bo Two' })).items.map((i: any) => i.technicianName)).toEqual(['Bo Two', 'Bo Two']);   // technician name as generated
    expect((await center.tasks(T, B, TZ, { q: t0.ticket_number })).items.map((i: any) => i.id)).toContain(t0.id);
    expect((await center.tasks(T, B, TZ, { q: t0.id })).items.map((i: any) => i.id)).toEqual([t0.id]);
    const gus = await center.tasks(T, B, TZ, { q: 'gus', pageSize: 10, page: 2 });
    expect([gus.total >= 12, gus.page, gus.pageSize, gus.items.length, gus.totalPages]).toEqual([true, 2, 10, gus.total - 10, 2]);
    expect((await center.tasks(T, B, TZ, { pageSize: 999 })).pageSize).toBe(20);
  });
  it('newest generated first by default; due order for the working queue; the sent date basis uses the salon day', async () => {
    const all = await center.tasks(T, B, TZ, { pageSize: 50 });
    const created = all.items.map((i: any) => i.createdAt);
    expect(created).toEqual([...created].sort().reverse());
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
    const sentToday = await center.tasks(T, B, TZ, { basis: 'sent', from: today, to: today, pageSize: 50 });
    expect(sentToday.items.every((i: any) => i.sentAt)).toBe(true);
    expect(sentToday.total).toBeGreaterThanOrEqual(4);
    expect((await center.tasks(T, B, TZ, { basis: 'sent', from: '2020-01-01', to: '2020-01-31' })).total).toBe(0);
  });
});

describe('settings + summary + health (guide §5, §7, §17)', () => {
  it('saves and reloads every setting including the contact cooldown; the timezone override is not overwritten by a save', async () => {
    const s = await repo.saveSettings(mgr, { contactCooldownHours: 48, autoExpirePendingHours: 24, generationTime: '20:00' });
    expect([s.contactCooldownHours, s.timezone, s.generationTime]).toEqual([48, TZ, '20:00']);
    expect((await repo.settingsFor(T, B)).contactCooldownHours).toBe(48);
  });
  it('the summary counts come from the queue; health is evidence-based (no worker row → Unknown, never green)', async () => {
    const st = await repo.settingsFor(T, B);
    const sum = await center.summary(T, B, st, new Date());
    expect(sum.kpis.sentToday).toBeGreaterThanOrEqual(4);
    // the newest run in the table (an earlier step generates with the real clock, so a fixed date only held on Oct 31)
    const latest = (await q(`select to_char(max(business_date), 'YYYY-MM-DD') as d from daily_follow_up_generation_runs where tenant_id = $1 and branch_id = $2`, [T, B]))[0].d;
    expect(sum.lastRun).toMatchObject({ businessDate: latest, status: 'completed', candidates: expect.any(Number) });
    let h = await center.health(T, B, st, new Date());
    expect(h.rows.find((r) => r.key === 'scheduler')!.state).toBe('unknown');
    expect(h.rows.find((r) => r.key === 'sms')!.state).toBe('not_used');
    expect(h.overall).not.toBe('ready');
    await q(`insert into scheduler_runs (name, last_started_at, last_finished_at, last_outcome, runs, failures, skipped, every_ms, updated_at) values ('followups.run_due', now(), now(), 'ok', 5, 0, 0, 300000, now()), ('followups.expire_stale', now(), now(), 'ok', 5, 0, 0, 300000, now())
             on conflict (name) do update set updated_at = now(), last_outcome = 'ok'`);
    h = await center.health(T, B, st, new Date());
    expect(h.rows.find((r) => r.key === 'scheduler')!.state).toBe('ready');
  });
});
