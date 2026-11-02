// retention-guide.pgtest — Customer Retention Complete Build Guide (Oct 30 2026), against the REAL schema.
//   §04 the 13-At-Risk defect: no completed visit → Never Visited, never At Risk, never scored, never a win-back recipient
//   §05 segments: Approaching / Active / Returning / Recovered; one ticket with several services = one visit; a removed
//       ticket is not a visit; the threshold is the salon's (settings, versioned, audited in the same transaction)
//   §08 search over the whole salon: service name, ticket number, appointment id, customer id — beyond page 1
//   §09 period + date basis (salon-local, whole end day, From > To refused)
//   §10 defaults: All = newest profile first; At Risk = Smart Priority
//   §11 priority = 0.45/0.30/0.25, reproducible, banded; suppression by upcoming booking
//   §13 recovery: deduplicated customers / visits / net revenue; last-touch campaign credit inside the observation window
//       (two campaigns before one return → one credit); a booking alone is not a recovery; other salons never counted
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { RetentionRepository, RetentionError, priorityOf, PRIORITY_FORMULA } from './retention.repository';
import { RetentionSmsService } from './retention-sms.service';

const P = 'c5e83000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), TECH = id('f1'), TECH2 = id('f2');
// N1 never visited (old profile, consent) · N2 only a canceled ticket · M one ticket with 3 services, 70 days · RM a removed
// ticket 10 days ago + a real one 80 days ago · AP 50 days · AC 5 days · RC recovered (100 days → today) · RT returning
// (15 days → 2 days) · UP 90 days with a booking tomorrow · HI 12 visits, 300 days, $600 · CR recovered after two
// campaigns · BK booked after a campaign but no visit · X other salon (recovered + campaign)
const [N1, N2, M, RM, AP, AC, RC, RT, UP, HI, CR, BK, X] = ['c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'c08', 'c09', 'c10', 'c11', 'c12', 'c99'].map(id);
const ctx = { tenantId: T, branchId: B, userId: id('ee1'), role: 'OWNER', permissions: ['pos.customers.view', 'pos.marketing.manage', 'pos.marketing.view', 'pos.settings.edit'], salonName: 'Lotus Nails' };
const ctx2 = { ...ctx, tenantId: T2, branchId: B2, salonName: 'Other Nails' };
let pg: any; let db: any; let repo: RetentionRepository; let svc: RetentionSmsService; let today = ''; let range = { preset: 'custom', from: '', to: '' };
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof RetentionError ? e.code : String((e as Error).message); } }

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Lotus LLC','Lotus Nails','rg-lotus','RGL001','active'), ($2,'Other LLC','Other Nails','rg-other','RGL002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Other','active','America/New_York')`, [B, T, B2, T2]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Tam','N','Tam N'), ($4,$5,$6,'Oz','N','Oz N')`, [TECH, T, B, TECH2, T2, B2]);
  today = (await q(`select (now() at time zone 'America/New_York')::date::text as d`)).rows[0].d;
  const from = (await q(`select ((now() at time zone 'America/New_York')::date - 30)::text as d`)).rows[0].d;
  range = { preset: 'custom', from, to: today };
  const cust = async (cid: string, tenant: string, branch: string, name: string, phone: string | null, consent: boolean, ageDays: number) =>
    q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, marketing_sms_opt_in, created_at) values ($1,$2,$3,$4,'X',$4,$5,$6, now() - make_interval(days => $7))`, [cid, tenant, branch, name, phone, consent, ageDays]);
  await cust(N1, T, B, 'Nora', '+12155550201', true, 500); await cust(N2, T, B, 'Nell', '+12155550202', true, 400); await cust(M, T, B, 'Mai', '+12155550203', true, 300);
  await cust(RM, T, B, 'Rosa', '+12155550204', true, 299); await cust(AP, T, B, 'Ama', '+12155550205', true, 298); await cust(AC, T, B, 'Ace', '+12155550206', true, 297);
  await cust(RC, T, B, 'Rae', '+12155550207', true, 296); await cust(RT, T, B, 'Rita', '+12155550208', true, 295); await cust(UP, T, B, 'Uma', '+12155550209', true, 294);
  await cust(HI, T, B, 'Hana', '+12155550210', true, 900); await cust(CR, T, B, 'Cleo', '+12155550211', true, 293); await cust(BK, T, B, 'Bao', '+12155550212', true, 292);
  await cust(X, T2, B2, 'Xena', '+12155550299', true, 400);
  let n = 0;
  const tk = async (tenant: string, branch: string, cid: string, daysAgo: number, cents: number, status = 'closed', removed = false) => {
    const tid = id('d' + String(++n).padStart(3, '0'));
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, created_at, paid_at, removed_at)
      values ($1,$2,$3,$4,$5,$6,$7, date_trunc('day', now()) - make_interval(days => $8) + interval '15 hours', date_trunc('day', now()) - make_interval(days => $8) + interval '15 hours',
              case when $9::boolean then now() end)`, [tid, tenant, branch, cid, status, cents, String(70000 + n), daysAgo, removed]);
    return tid;
  };
  const now = async (tenant: string, branch: string, cid: string, cents: number) => {
    const tid = id('d' + String(++n).padStart(3, '0'));
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, created_at, paid_at) values ($1,$2,$3,$4,'paid',$5,$6, now() - interval '1 minute', now() - interval '1 minute')`, [tid, tenant, branch, cid, cents, String(70000 + n)]);
    return tid;
  };
  await tk(T, B, N2, 120, 9900, 'canceled');
  const mt = await tk(T, B, M, 70, 9000);
  await q(`insert into service_categories (id, tenant_id, branch_id, name, status) values ($1,$2,$3,'Nails','active')`, [id('a01'), T, B]);
  for (const [i, s] of ['Gel Pedicure', 'Gel Manicure', 'Nail Art'].entries()) {
    const sid = id('a1' + i);
    await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$2,$3,$4,$5,30,3000,'active')`, [sid, T, B, id('a01'), s]);
    await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, created_at) values ($1,$2,$3,$4,$5,3000,30,3000, now() - make_interval(mins => $6))`, [T, B, mt, sid, s, 10 - i]);
  }
  await tk(T, B, RM, 80, 4000); await tk(T, B, RM, 10, 4000, 'closed', true);
  await tk(T, B, AP, 50, 3000); await tk(T, B, AC, 5, 3000);
  await tk(T, B, RC, 100, 5000); const rcNow = await now(T, B, RC, 6000);
  await tk(T, B, RT, 15, 2000); await tk(T, B, RT, 2, 2000);
  await tk(T, B, UP, 90, 4000);
  for (let i = 0; i < 12; i++) await tk(T, B, HI, 300 + i * 20, 5000);
  await tk(T, B, CR, 120, 4000); const crNow = await now(T, B, CR, 8000);
  await tk(T, B, BK, 150, 3000);
  await tk(T2, B2, X, 200, 5000); await now(T2, B2, X, 5000);
  // $20 of Cleo's return ticket was refunded → net $60
  await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, status) values ($1,$2,$3,$4,'cash',8000,'succeeded')`, [id('e01'), T, B, crNow]);
  await q(`insert into payment_refunds (tenant_id, branch_id, payment_id, amount_cents, status, reason) values ($1,$2,$3,2000,'refunded','test')`, [T, B, id('e01')]);
  void rcNow;
  // appointments: Uma tomorrow (suppression); Bao booked after the campaign (a booking is not a visit)
  await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status, services) values
    ($1,$2,$3,$4,'Uma',(now() at time zone 'America/New_York')::date + 1,'10:00','11:00','booked','[{"name":"Gel Manicure"}]'),
    ($1,$2,$3,$5,'Bao',(now() at time zone 'America/New_York')::date + 3,'12:00','13:00','booked','[]')`, [T, B, TECH, UP, BK]);
  await q(`update pos_tech_appointments set created_at = now() - interval '2 days' where customer_id = $1`, [BK]);
  // two campaigns reached Cleo (8 days and 3 days before her return); one reached Bao; one in the other salon reached Xena
  const camp = async (cid: string, tenant: string, daysAgo: number) => q(`insert into retention_sms_campaigns (id, tenant_id, status, body, body_sha256, eligible_count, confirmed_at, created_at)
    values ($1,$2,'completed','We miss you','x',1, now() - make_interval(days => $3), now() - make_interval(days => $3))`, [cid, tenant, daysAgo]);
  await camp(id('f01'), T, 8); await camp(id('f02'), T, 3); await camp(id('f99'), T2, 3);
  const rec = async (camp: string, tenant: string, cust: string, daysAgo: number) => q(`insert into retention_sms_recipients (campaign_id, tenant_id, customer_id, destination, eligibility, status, sent_at, created_at)
    values ($1,$2,$3,(select normalized_phone from customers where id = $3),'eligible','sent', now() - make_interval(days => $4), now() - make_interval(days => $4))`, [camp, tenant, cust, daysAgo]);
  await rec(id('f01'), T, CR, 8); await rec(id('f02'), T, CR, 3); await rec(id('f02'), T, BK, 3); await rec(id('f99'), T2, X, 3);
  db = kyselyFor(pg); repo = new RetentionRepository(db); svc = new RetentionSmsService(db, repo, null);
}, 180_000);

describe('§04/§05 cohorts', () => {
  it('Never Visited is its own segment: not At Risk, not scored, not a win-back recipient', async () => {
    const s = await repo.summary(ctx, range);
    expect(s.segments.never).toBe(2);                                   // N1, N2 (a canceled ticket is not a visit)
    expect(s.kpis.neverVisited).toBe(2);
    const risk = await repo.customers(ctx, { ...range, segment: 'at_risk', pageSize: 50 });
    expect(risk.items.map((r) => r.customerId)).not.toContain(N1);
    expect(risk.items.map((r) => r.customerId)).not.toContain(N2);
    expect(risk.items.every((r) => r.priority !== null && r.visits > 0)).toBe(true);
    const never = await repo.customers(ctx, { ...range, segment: 'never', pageSize: 50 });
    expect(never.items.every((r) => r.priority === null && r.segment === 'never_visited')).toBe(true);
    const p = await svc.preview(ctx, { customerIds: [N1], body: 'We miss you! Book again.' });
    expect(p.eligible).toBe(0); expect(p.excludedReasons).toMatchObject({ never_visited: 1 });
  });

  it('one ticket with three services is ONE visit; a removed ticket is not a visit', async () => {
    const m = await repo.customerSnapshot(ctx, M);
    expect(m!.visits).toBe(1); expect(m!.visitEvidence).toHaveLength(1); expect(m!.visitEvidence[0]!.services).toBe('Gel Pedicure, Gel Manicure, Nail Art');
    const rm = await repo.customerSnapshot(ctx, RM);
    expect(rm!.visits).toBe(1); expect(rm!.daysAway).toBe(80); expect(rm!.segment).toBe('at_risk');
  });

  it('Approaching / Active / Returning / Recovered follow the definitions', async () => {
    const s = await repo.summary(ctx, range);
    const ids = async (segment: string) => (await repo.customers(ctx, { ...range, segment, pageSize: 50 })).items.map((r) => r.customerId).sort();
    expect(await ids('approaching')).toEqual([AP].sort());
    expect(await ids('active')).toEqual([AP, AC, RC, RT, CR].sort());      // < 60 days (Approaching is the late part of Active)
    expect(await ids('recovered')).toEqual([RC, CR].sort());              // returned after ≥ 60 days
    expect(await ids('returning')).toEqual([RC, RT, CR].sort());          // RT returned after 13 days: returning, not recovered
    expect(s.kpis.recovered).toBe(2); expect(s.segments.approaching).toBe(1);
    expect(s.kpis.returningRatePercent).toBe(Math.round((3 / 4) * 1000) / 10);   // 3 returning of 4 visitors in the window (RC RT CR AC)
    expect(s.period.riskDays).toBe(60); expect(s.period.settingsVersion).toBe(0); expect(s.period.priorityFormulaVersion).toBe('winback-v1');
  });
});

describe('§08–§10 discovery', () => {
  it('search finds by service, ticket number, appointment id and customer id across the whole salon', async () => {
    const one = async (qq: string) => (await repo.customers(ctx, { ...range, segment: 'all', q: qq, pageSize: 1 })).items.map((r) => r.customerId);
    expect(await one('pedicure')).toEqual([M]);
    const tn = (await q(`select ticket_number from tickets where customer_id = $1 and removed_at is null`, [AP])).rows[0].ticket_number;
    expect(await one(tn)).toEqual([AP]);
    const appt = (await q(`select id from pos_tech_appointments where customer_id = $1`, [UP])).rows[0].id;
    expect(await one(appt)).toEqual([UP]);
    expect(await one(HI)).toEqual([HI]);
    expect(await one(X)).toEqual([]);                                     // another salon's id: nothing
    expect(await one('2155550212')).toEqual([BK]);
  });

  it('All Customers = newest profile first; At Risk = Smart Priority; pages are stable', async () => {
    const all = await repo.customers(ctx, { ...range, segment: 'all', pageSize: 5 });
    expect(all.sort).toBe('created_desc');
    const p1 = all.items.map((r) => r.createdAt!); expect([...p1].sort().reverse()).toEqual(p1);
    const p2 = await repo.customers(ctx, { ...range, segment: 'all', pageSize: 5, page: 2 });
    expect(p2.items.some((r) => all.items.some((a) => a.customerId === r.customerId))).toBe(false);
    const risk = await repo.customers(ctx, { ...range, segment: 'at_risk', pageSize: 50 });
    expect(risk.sort).toBe('priority'); expect(risk.items[0]!.customerId).toBe(HI);
    const scores = risk.items.map((r) => r.priority!.score); expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('date basis filters the list in salon dates; From > To is refused', async () => {
    const lv = await repo.customers(ctx, { ...range, segment: 'all', basis: 'last_visit', pageSize: 50 });
    expect(lv.items.map((r) => r.customerId).sort()).toEqual([AC, RC, RT, CR].sort());
    const camp = await repo.customers(ctx, { ...range, segment: 'all', basis: 'campaign', pageSize: 50 });
    expect(camp.items.map((r) => r.customerId).sort()).toEqual([CR, BK].sort());
    expect(await code(repo.customers(ctx, { segment: 'all', preset: 'custom', from: today, to: range.from }))).toBe('RETENTION_INVALID_PERIOD');
    expect(await code(repo.summary(ctx, { preset: 'custom', from: 'nope', to: today }))).toBe('RETENTION_INVALID_PERIOD');
  });
});

describe('§11 Smart Win-Back Priority', () => {
  it('is reproducible from its inputs, explained and banded', async () => {
    const hi = (await repo.customers(ctx, { ...range, segment: 'at_risk', pageSize: 50 })).items.find((r) => r.customerId === HI)!;
    const again = priorityOf(hi.daysAway!, hi.visits, hi.lifetimeSpendCents);
    expect(hi.priority).toEqual(again);
    expect(hi.priority!.band).toBe('high'); expect(hi.priority!.explanation).toMatch(/12 completed visits/);
    const sum = hi.priority!.components.inactivity + hi.priority!.components.frequency + hi.priority!.components.spend;
    expect(Math.abs(sum - hi.priority!.score)).toBeLessThanOrEqual(1);
    expect(PRIORITY_FORMULA.weights.inactivity + PRIORITY_FORMULA.weights.frequency + PRIORITY_FORMULA.weights.spend).toBeCloseTo(1);
    const high = await repo.customers(ctx, { ...range, segment: 'at_risk', band: 'high', pageSize: 50 });
    expect(high.items.map((r) => r.customerId)).toEqual([HI]);
  });

  it('an upcoming booking suppresses the win-back text', async () => {
    const up = await repo.customerSnapshot(ctx, UP);
    expect(up!.smsStatus).toBe('upcoming_booking'); expect(up!.upcomingBookings).toHaveLength(1); expect(up!.upcomingBookings[0]!.services).toBe('Gel Manicure');
    const p = await svc.preview(ctx, { customerIds: [UP, M], body: 'We miss you! Book again.' });
    expect(p.excludedReasons).toMatchObject({ upcoming_booking: 1 }); expect(p.eligible).toBe(1);
  });

  it('"select all matching" honours the band filter on the server', async () => {
    const ids = await repo.matchingIds(ctx, { ...range, segment: 'at_risk', band: 'high' });
    expect(ids).toEqual([HI]);
  });
});

describe('§13 Recovery tracking', () => {
  it('dedupes customers / visits / net revenue and credits one campaign per return (last touch)', async () => {
    const r = await repo.recovery(ctx, range);
    expect(r.totals.recoveredCustomers).toBe(2);                       // RC and CR (a booking alone — BK — is not a recovery)
    expect(r.totals.returnVisits).toBe(2);
    expect(r.totals.observedReturnRevenueCents).toBe(6000 + 6000);     // RC $60 + CR $80 − $20 refund
    expect(r.totals.campaignObserved).toMatchObject({ customers: 1, visits: 1, revenueCents: 6000 });
    expect(r.totals.unmessagedRecovered).toBe(1);
    const c2 = r.campaigns.find((c) => c.campaignId === id('f02'))!, c1 = r.campaigns.find((c) => c.campaignId === id('f01'))!;
    expect(c2.returnedCustomers).toBe(1); expect(c2.returnRevenueCents).toBe(6000); expect(c2.bookedAfterContact).toBe(1);
    expect(c1.returnedCustomers).toBe(0);                              // the earlier campaign is not credited again
    expect(r.campaigns.some((c) => c.campaignId === id('f99'))).toBe(false);
    expect(r.returns.items.map((x) => x.customerId).sort()).toEqual([RC, CR].sort());
    expect(r.trend).toHaveLength(6);
    const s = await repo.summary(ctx, range); expect(s.kpis.campaignRecoveries).toBe(1);
    const o = await repo.recovery(ctx2, range);
    expect(o.totals.recoveredCustomers).toBe(1); expect(o.campaigns.map((c) => c.campaignId)).toEqual([id('f99')]);
  });
});

describe('§05 settings', () => {
  it('validates, versions, audits in the same transaction and reclassifies', async () => {
    expect(await code(repo.updateSettings(ctx, { riskDays: 30, approachingDays: 40, expectedVersion: 0 }, async () => {}))).toBe('RETENTION_INVALID_SETTINGS');
    expect(await code(repo.updateSettings(ctx, { riskDays: 90, approachingDays: 60, expectedVersion: 7 }, async () => {}))).toBe('SETTINGS_VERSION_CONFLICT');
    // an audit failure rolls the change back (fail-closed)
    expect(await code(repo.updateSettings(ctx, { riskDays: 90, approachingDays: 60, expectedVersion: 0 }, async () => { throw new Error('audit down'); }))).toBe('audit down');
    expect((await repo.settings(ctx)).isDefault).toBe(true);
    const seen: unknown[] = [];
    const s = await repo.updateSettings(ctx, { riskDays: 90, approachingDays: 60, expectedVersion: 0 }, async (trx, before, after) => {
      seen.push([before.riskDays, after.riskDays]);
      expect((await sql<any>`select risk_days from tenant_retention_settings where tenant_id = ${T}`.execute(trx)).rows[0].risk_days).toBe(90);
    });
    expect(s).toMatchObject({ riskDays: 90, approachingDays: 60, version: 1 }); expect(seen).toEqual([[60, 90]]);
    expect((await repo.customerSnapshot(ctx, M))!.segment).toBe('approaching');      // 70 days: no longer At Risk at 90
    const sum = await repo.summary(ctx, range);
    expect(sum.period.riskDays).toBe(90); expect(sum.period.settingsVersion).toBe(1);
    expect(sum.kpis.recovered).toBe(2);                                               // RC (100 d) and CR (120 d) still ≥ 90
    expect((await repo.settings(ctx2)).isDefault).toBe(true);                          // the other salon is untouched
  });
});

describe('export (fail-closed audit)', () => {
  it('denied without pos.customers.export (recorded); allowed → requested + succeeded, phones masked', async () => {
    const { RetentionController } = await import('./retention.controller');
    const ctl = new RetentionController(repo, svc);
    const req = (permissions: string[]) => ({ ctx: { ...ctx, permissions }, res: { setHeader: () => undefined } });
    let status = 0; try { await ctl.exportCsv(req(['pos.customers.view']), { segment: 'all' }); } catch (e: any) { status = e?.getStatus?.() ?? 0; }
    expect(status).toBe(403);
    const csv = String(await ctl.exportCsv(req(['pos.customers.view', 'pos.customers.export']), { segment: 'all' }));
    expect(csv.split('\n')[0]).toMatch(/^Customer ID,Customer,Phone \(masked\)/);
    expect(csv).not.toMatch(/\+1215555/);
    const acts = (await q(`select action, status from audit_events where tenant_id = $1 and action like 'retention.export.%' order by occurred_at, action`, [T])).rows.map((r: any) => r.action);
    expect(acts).toEqual(expect.arrayContaining(['retention.export.denied', 'retention.export.requested', 'retention.export.succeeded']));
  });
});
