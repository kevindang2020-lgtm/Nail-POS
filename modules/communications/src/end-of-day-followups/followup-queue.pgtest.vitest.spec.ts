// followup-queue.pgtest — Follow-Up Queue Complete Build Guide (Oct 30 2026) on the REAL schema (through 746).
// Guide §17 fixtures: one task per qualifying service even after two Generate Now clicks; a truthful empty state;
// suppression reasons; an overdue task stays ahead of a newer one; tenant-local date boundaries; rebooked uses a real
// later booking; missed calls stay their own type; tenant A cannot see tenant B.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { DailyFollowUpService } from './end-of-day-followups.service';
import { KyselyDailyFollowUpRepository } from './end-of-day-followups.kysely.repository';
import { FollowUpQueue, priorityOf } from './followup-queue';

const P = 'e7460000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const T = id('a1'), B = id('b1'), TX = id('a9'), BX = id('b9');
const OWNER = id('e1'), U1 = id('e11'), T1 = id('71'), T2 = id('72'), CAT = id('c0'), SVC = id('c1');
const C = (n: number) => id(`d${n}`);
const APP = (n: number) => id(`f${n}`);
const TZ = 'America/New_York';
const TODAY = '2026-10-31';
let pg: any; let db: any; let svc: DailyFollowUpService; let fq: FollowUpQueue;
const q = (s: string, p: unknown[] = []) => pg.query(s, p).then((r: any) => r.rows);
let n = 0;
async function task(cust: number, opts: { tech?: string; date?: string; status?: string; sentAt?: string | null; createdAt?: string; app?: boolean; completedAt?: string; tenant?: string; branch?: string; name?: string } = {}) {
  n++;
  const t = opts.tenant ?? T, b = opts.branch ?? B;
  return (await q(`insert into service_follow_up_tasks (tenant_id, branch_id, business_date, customer_id, technician_id, ticket_id, ticket_service_line_id, customer_name_snapshot,
      technician_name_snapshot, customer_app_user_id, status, suggested_message, sent_at, created_at, completed_at, customer_phone_snapshot, service_name_snapshot)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Thanks for visiting!',$12,coalesce($13::timestamptz, now()),$14,$15,'Gel manicure') returning id`,
    [t, b, opts.date ?? TODAY, C(cust), opts.tech ?? T1, id('9' + n), id('8' + n), opts.name ?? `Customer ${cust}`, opts.tech === T2 ? 'Bo Two' : 'Ana One',
      opts.app === false ? null : APP(cust), opts.status ?? 'pending', opts.sentAt ?? null, opts.createdAt ?? null, opts.completedAt ?? `${opts.date ?? TODAY}T18:00:00Z`, `+1609555${String(1000 + cust)}`]))[0].id as string;
}

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  svc = new DailyFollowUpService(new KyselyDailyFollowUpRepository(db, null)); fq = new FollowUpQueue(db);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Salon','fuq-s','FUQS01','active'), ($2,'X','Other','fuq-x','FUQX01','active')`, [T, TX]);
  await q(`insert into branches (id, tenant_id, name, timezone, status) values ($1,$2,'Main',$5,'active'), ($3,$4,'Other',$5,'active')`, [B, T, BX, TX, TZ]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,'Owner','o@fuq.test','active','OWNER'), ($3,$2,'Ana','a@fuq.test','active','TECHNICIAN')`, [OWNER, T, U1]);
  await q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, is_active) values ($1,$2,$3,$4,'Ana','One','Ana One',true), ($5,$2,$3,null,'Bo','Two','Bo Two',true)`, [T1, T, B, U1, T2]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Gel manicure',60,5000)`, [SVC, T, B, CAT]);
  for (let c = 1; c <= 30; c++) {
    await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,$3,$4,'active','CUSTOMER')`, [APP(c), T, `Customer ${c}`, `c${c}@fuq.test`]);
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status, user_id) values ($1,$2,$3,'Customer',$4,$5,$6,$7,$8,$9)`,
      [C(c), T, B, String(c), `Customer ${c}`, `+1609555${1000 + c}`, `c${c}@fuq.test`, c === 29 ? 'archived' : 'active', APP(c)]);
  }
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values ($1,$2,$3,'Customer','1','Customer 1','+16095551001','active')`, [id('dae'), TX, BX]);
}, 240_000);

describe('Generate Now (guide §08, §17 "exactly one task even after two clicks")', () => {
  it('one qualifying completed service → one task; a second click creates nothing and reports "already existed"', async () => {
    const tk = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, paid_at, total_cents, ticket_number) values ($1,$2,$3,'paid','2026-10-31T18:00:00Z',5000,'G-1') returning id`, [T, B, C(20)]))[0].id;
    await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, technician_id, status, completed_at)
             values ($1,$2,$3,$4,'Gel manicure',5000,60,5000,$5,'completed','2026-10-31T18:00:00Z')`, [T, B, tk, SVC, T1]);
    const now = new Date('2026-11-01T00:30:00Z');                     // 20:30 EDT Oct 31
    const a = await svc.generateForBranch(T, B, { now, triggerSource: 'manual', force: true });
    const b = await svc.generateForBranch(T, B, { now, triggerSource: 'manual', force: true });
    expect(a.businessDate).toBe(TODAY); expect(a.created).toBe(1); expect(b.created).toBe(0);
    expect((await q(`select count(*)::int c from service_follow_up_tasks where tenant_id = $1 and ticket_id = $2`, [T, tk]))[0].c).toBe(1);
    const s = await fq.generationSummary(T, B, TODAY, b.created);
    expect(s).toMatchObject({ businessDate: TODAY, eligible: 1, created: 0, createdToday: 1, alreadyExisted: 1, failed: 0 });
  });
  it('a day with no qualifying service: truthful zero with the run recorded (not a fabricated zero)', async () => {
    const r = await svc.generateForBranch(T, B, { now: new Date('2026-10-28T00:30:00Z'), triggerSource: 'manual', force: true });
    expect(r.created).toBe(0);
    const k = await fq.kpis(T, B, TZ, '2026-10-27', new Date());
    expect(k).toMatchObject({ total: 0, pending: 0, basis: 'due_date' });
    expect(k!.generation).toMatchObject({ eligible: 0, created: 0, status: 'completed' });
  });
});

describe('KPIs on one basis (guide §05)', () => {
  it('pending / sent / skipped / rebooked / total for the selected due date; overdue earlier days reported separately', async () => {
    await task(1, { date: '2026-10-30' });                                       // overdue (earlier day), unsent
    await task(2, { date: '2026-11-02' });                                       // other day
    await task(3, { status: 'sent', sentAt: '2026-10-31T23:00:00Z' });
    await task(4, { status: 'skipped' });
    await task(5, { status: 'sent', sentAt: '2026-10-31T22:00:00Z' });
    await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status, created_at)
             values ($1,$2,$3,$4,'Customer 5','2026-11-20','10:00','11:00','booked','2026-11-02T15:00:00Z')`, [T, B, T1, C(5)]);
    const k = await fq.kpis(T, B, TZ, TODAY, new Date());
    // today: task for C20 (generated, pending), C3 sent, C4 skipped, C5 sent+rebooked
    expect(k).toMatchObject({ date: TODAY, pending: 1, sent: 2, skipped: 1, rebooked: 1, total: 4, overdueEarlier: 1 });
  });
});

describe('queue order, search, basis, pages (guide §06, §17)', () => {
  it('an overdue pending task stays ahead of a newer task; history is newest first', async () => {
    const page = await fq.list(T, B, TZ, TODAY, 24, { view: 'queue', pageSize: 10 });
    expect(page.items[0].dueDate).toBe('2026-10-30'); expect(page.items[0].overdue).toBe(true);
    expect(page.items[0].priority).toBe('high'); expect(page.items[0].priorityReasons.map((r) => r.code)).toContain('overdue');
    const hist = await fq.list(T, B, TZ, TODAY, 24, { view: 'history', pageSize: 50 });
    const created = hist.items.map((i) => i.createdAt!);
    expect([...created].sort().reverse()).toEqual(created);
  });
  it('search reaches beyond page 1 (12 matches, page size 10) and finds by phone digits / ticket / task id', async () => {
    for (let c = 6; c <= 17; c++) await task(c, { name: `Zed Match ${c}`, date: '2026-10-29' });
    const p1 = await fq.list(T, B, TZ, TODAY, 24, { view: 'history', q: 'zed match', pageSize: 10 });
    expect(p1.total).toBe(12); expect(p1.totalPages).toBe(2);
    const p2 = await fq.list(T, B, TZ, TODAY, 24, { view: 'history', q: 'zed match', pageSize: 10, page: 2 });
    expect(p2.items).toHaveLength(2);
    expect(new Set([...p1.items, ...p2.items].map((i) => i.id)).size).toBe(12);
    expect((await fq.list(T, B, TZ, TODAY, 24, { view: 'history', q: '5551016' })).items.map((i) => i.customerName)).toEqual(['Zed Match 16']);
    const one = p1.items[0];
    expect((await fq.list(T, B, TZ, TODAY, 24, { view: 'history', q: one.id })).items.map((i) => i.id)).toEqual([one.id]);
  });
  it('salon-local date boundaries on the sent basis: 03:59Z Nov 1 is still Oct 31 in New York, 04:30Z is not', async () => {
    const inside = await task(18, { status: 'sent', sentAt: '2026-11-01T03:59:00Z', date: '2026-10-25' });
    const outside = await task(19, { status: 'sent', sentAt: '2026-11-01T04:30:00Z', date: '2026-10-25' });
    const r = await fq.list(T, B, TZ, TODAY, 24, { view: 'history', basis: 'sent', from: TODAY, to: TODAY, pageSize: 50 });
    const ids = r.items.map((i) => i.id);
    expect(ids).toContain(inside); expect(ids).not.toContain(outside);
  });
  it('the rebooked status uses a real later booking (not the task status)', async () => {
    const r = await fq.list(T, B, TZ, TODAY, 24, { view: 'history', status: 'rebooked', pageSize: 50 });
    expect(r.items.map((i) => i.customerName)).toEqual(['Customer 5']);
  });
});

describe('Smart Priority + Duplicate Message Protection (guide §10, §11)', () => {
  it('categories: already sent · missing contact · recently contacted · blocked · needs approval · eligible — each with its evidence', async () => {
    const sentTask = (await q(`select id from service_follow_up_tasks where tenant_id = $1 and customer_id = $2`, [T, C(3)]))[0].id;
    expect((await fq.contactCheck(T, B, TODAY, sentTask, 24, false))!.category).toBe('already_sent');
    const noApp = await task(21, { app: false });
    expect((await fq.contactCheck(T, B, TODAY, noApp, 24, false))!.categories).toContain('missing_contact');
    await task(22, { status: 'sent', sentAt: new Date(Date.now() - 2 * 3600_000).toISOString() });
    const recent = await task(22);
    const rc = (await fq.contactCheck(T, B, TODAY, recent, 24, false))!;
    expect(rc.category).toBe('recently_contacted'); expect(rc.lastFollowUp?.at).toBeTruthy(); expect(rc.priority).toBe('low');
    expect(rc.priorityReasons.map((r) => r.code)).toContain('recently_contacted');
    const archived = await task(29);
    expect((await fq.contactCheck(T, B, TODAY, archived, 24, false))!.categories).toContain('blocked');
    const ok = await task(23);
    expect((await fq.contactCheck(T, B, TODAY, ok, 24, false))!.category).toBe('eligible');
    expect((await fq.contactCheck(T, B, TODAY, ok, 24, true))!.category).toBe('needs_approval');
  });
  it('an open low-rating concern raises priority with its source timestamp; an upcoming booking lowers it', async () => {
    await q(`insert into reviews (tenant_id, branch_id, customer_id, rating, comment, created_at) values ($1,$2,$3,2,'chipped', now() - interval '3 days')`, [T, B, C(24)]);
    const concern = await task(24);
    const c = (await fq.contactCheck(T, B, TODAY, concern, 24, false))!;
    expect(c.priority).toBe('high'); expect(c.priorityReasons.find((r) => r.code === 'open_concern')?.at).toBeTruthy();
    await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status) values ($1,$2,$3,$4,'C25','2026-12-01','10:00','11:00','confirmed')`, [T, B, T1, C(25)]);
    const booked = await task(25);
    const bk = (await fq.contactCheck(T, B, TODAY, booked, 24, false))!;
    expect(bk.priority).toBe('low'); expect(bk.upcomingBooking).toBe('2026-12-01');
    expect([priorityOf(2), priorityOf(1), priorityOf(0), priorityOf(-1)]).toEqual(['high', 'normal', 'normal', 'low']);
  });
  it('another channel within the window is SHOWN (not enforced); an SMS STOP is listed', async () => {
    await q(`insert into notifications (tenant_id, channel, to_address, body, customer_id, status, purpose, created_at) values ($1,'sms','+16095551026','Promo','${C(26)}','sent','marketing', now() - interval '1 hour')`, [T]);
    await q(`insert into notification_opt_outs (tenant_id, channel, address, reason) values ($1,'sms','+16095551026','STOP')`, [T]);
    const t26 = await task(26);
    const r = (await fq.contactCheck(T, B, TODAY, t26, 24, false))!;
    expect(r.otherChannel).toMatchObject({ channel: 'sms', enforced: false }); expect(r.optOuts.map((o) => o.channel)).toEqual(['sms']);
    expect(r.category).toBe('eligible');
  });
});

describe('Missed Call type (guide §07, §13) — separate source, its own states', () => {
  it('awaiting callback · replied (text after the call) · recovered (booked) — and never counted as after-service', async () => {
    const at = '2026-10-31T15:00:00Z';
    await q(`insert into call_intelligence_events (tenant_id, branch_id, provider_call_id, customer_id, caller_phone, direction, status, started_at) values
      ($1,$2,'mc-1',$3,'+16095551027','inbound','missed',$4), ($1,$2,'mc-2',$5,'+16095551028','inbound','missed',$4), ($1,$2,'mc-3',null,'+16095559999','inbound','missed',$4),
      ($6,$7,'mc-x',null,'+16095551027','inbound','missed',$4)`, [T, B, C(27), at, C(28), TX, BX]);
    await q(`insert into notifications (tenant_id, channel, to_address, body, customer_id, status, created_at) values ($1,'sms','+16095551028','Sorry we missed you',$2,'sent','2026-10-31T15:10:00Z')`, [T, C(28)]);
    const appt = (await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status) values ($1,$2,$3,null,'Walk','2026-11-05','10:00','11:00','booked') returning id`, [T, B, T1]))[0].id;
    await q(`update call_intelligence_events set recovered_appointment_id = $1 where provider_call_id = 'mc-3' and tenant_id = $2`, [appt, T]);
    const r = await fq.missedCalls(T, B, TZ, { from: TODAY, to: TODAY });
    expect(r.total).toBe(3);
    const byId = Object.fromEntries(r.items.map((i) => [i.callerLast4, i.state]));
    expect(byId).toEqual({ '1027': 'awaiting_callback', '1028': 'replied', '9999': 'recovered' });
    expect(r.items.every((i) => i.type === 'missed_call')).toBe(true);
    expect((await fq.missedCalls(T, B, TZ, { state: 'awaiting_callback' })).items.map((i) => i.callerLast4)).toEqual(['1027']);
    const k = await fq.kpis(T, B, TZ, TODAY, new Date());
    expect(k!.missedCalls).toBe(3);
    const after = await fq.list(T, B, TZ, TODAY, 24, { view: 'history', q: '1027' });
    expect(after.items.every((i) => i.type === 'after_service')).toBe(true);
  });
});

describe('results + customer history (guide §13, §14)', () => {
  it('funnel, skip reasons, by technician, associated revenue inside the window — booking counted once', async () => {
    await q(`insert into tickets (tenant_id, branch_id, customer_id, status, paid_at, total_cents, ticket_number, created_at) values ($1,$2,$3,'paid','2026-11-10T16:00:00Z',7500,'R-1','2026-11-10T15:00:00Z')`, [T, B, C(5)]);
    const r = (await fq.results(T, B, TZ, TODAY, TODAY))!;
    expect(r.funnel.bookedAfter).toBe(1); expect(r.funnel.returnVisits).toBe(1); expect(r.associatedRevenueCents).toBe(7500);
    expect(r.notes.causation).toBe('association_not_causation');
    expect(r.byTechnician.find((x) => x.name === 'Ana One')!.generated).toBeGreaterThan(0);
    expect(r.skipReasons.reduce((a, x) => a + x.count, 0)).toBe(r.closed.skipped + r.closed.expired);
  });
  it('customer history is newest first and this branch only', async () => {
    await task(5, { date: '2026-11-03', createdAt: '2026-11-03T20:00:00Z' });
    const h = (await fq.customerHistory(T, B, C(5)))!;
    expect(h.items.length).toBe(2); expect(h.items[0].dueDate).toBe('2026-11-03');
    expect(h.items[1].bookedAfterAt).toBeTruthy();
  });
});

describe('tenant isolation (guide §16, §17)', () => {
  it('tenant A cannot list, search, check or read history of tenant B, even when names / phones overlap', async () => {
    const other = await task(1, { tenant: TX, branch: BX, name: 'Customer 1' });
    const r = await fq.list(T, B, TZ, TODAY, 24, { view: 'history', q: other, pageSize: 50 });
    expect(r.items.map((i) => i.id)).not.toContain(other);
    expect(await fq.contactCheck(T, B, TODAY, other, 24, false)).toBeNull();
    expect((await fq.customerHistory(T, B, id('dae')))!.total).toBe(0);
    expect((await fq.missedCalls(T, B, TZ, { q: '1027' })).items.every((i) => i.customerId !== null)).toBe(true);
  });
});
