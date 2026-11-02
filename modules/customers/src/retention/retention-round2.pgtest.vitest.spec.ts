// retention-round2.pgtest — Four-Module Completion Guide (Oct 30 2026) CR-01..CR-03, against the REAL schema (724).
//   CR-01 snapshots: the same customer differs across two dates; never visited; cancellation only; the salon-local day
//         boundary (11:30 PM counts, 12:30 AM the next day does not); a config change is a NEW definition version and
//         never rewrites a stored day; idempotent rerun; missing day → unverifiable; before the first ticket → incomplete;
//         backfill = one durable job per day, bounded, audited; append-only rows; compare + drill-down
//   CR-02 branch activity: one customer with visits at A and B appears ONCE tenant-wide with per-branch metrics;
//         unknown-branch tickets counted, never allocated; an unauthorized branch → 403
//   CR-03 SMS estimate: no price → "Price unknown"; GSM vs UCS-2 segments; opted-out + duplicate phone excluded
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { RetentionRepository, RetentionError } from './retention.repository';
import { RetentionSmsService } from './retention-sms.service';
import { RetentionSnapshotRepository, runRetentionSnapshotJob, definitionVersion, RETENTION_SNAPSHOT_JOB } from './retention-snapshots';
import { RetentionPricingRepository, estimateSms, toMicros } from './retention-pricing';

const P = 'c5e84000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), T3 = id('a3'), BA = id('b1'), BB = id('b2'), B2 = id('b3'), B3 = id('b4'), GHOST = id('b9');
// SH changes segment across dates · NV never visited · CX only a canceled ticket · TZ the day boundary · AB visits at A and B
// · OP opted out · D1/D2 the same phone · G1 a plain eligible customer · CF (salon T3) the config-change customer
const [SH, NV, CX, TZ, AB, OP, D1, D2, G1, CF, X2] = ['c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'c08', 'c09', 'c10', 'c99'].map(id);
const perms = ['pos.customers.view', 'pos.marketing.manage', 'pos.marketing.view', 'pos.settings.edit'];
const ctx = { tenantId: T, branchId: BA, userId: id('ee1'), role: 'OWNER', permissions: perms, salonName: 'Lotus Nails' };
let pg: any; let db: any; let repo: RetentionRepository; let snaps: RetentionSnapshotRepository; let svc: RetentionSmsService; let pricing: RetentionPricingRepository;
let today = '';
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const dayAgo = async (n: number) => (await q(`select ((now() at time zone 'America/New_York')::date - $1::int)::text as d`, [n])).rows[0].d as string;
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof RetentionError ? e.code : String((e as Error).message); } }
const snapRow = async (tenant: string, cid: string, date: string) => (await q(`select * from customer_retention_daily_snapshots where tenant_id = $1 and customer_id = $2 and snapshot_local_date = $3::date`, [tenant, cid, date])).rows;

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  repo = new RetentionRepository(db); snaps = new RetentionSnapshotRepository(db); svc = new RetentionSmsService(db, repo, null); pricing = new RetentionPricingRepository(db);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Lotus LLC','Lotus Nails','r2-lotus','R2L001','active'), ($2,'Other LLC','Other Nails','r2-other','R2L002','active'), ($3,'Cfg LLC','Cfg Nails','r2-cfg','R2L003','active')`, [T, T2, T3]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Alpha','active','America/New_York'), ($3,$2,'Beta','active','America/New_York'), ($4,$5,'Other','active','America/New_York'), ($6,$7,'Cfg','active','America/New_York')`, [BA, T, BB, B2, T2, B3, T3]);
  today = await dayAgo(0);
  const cust = (cid: string, tenant: string, branch: string, name: string, phone: string | null) =>
    q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, marketing_sms_opt_in, created_at) values ($1,$2,$3,$4,'X',$4,$5,true, now() - interval '400 days')`, [cid, tenant, branch, name, phone]);
  await cust(SH, T, BA, 'Shay', '+12155550301'); await cust(NV, T, BA, 'Nova', '+12155550302'); await cust(CX, T, BA, 'Cass', '+12155550303');
  await cust(TZ, T, BA, 'Tess', '+12155550304'); await cust(AB, T, BA, 'Abby', '+12155550305'); await cust(OP, T, BA, 'Opal', '+12155550306');
  await cust(D1, T, BA, 'Dana', '+12155550307'); await cust(D2, T, BA, 'Dina', '+12155550307'); await cust(G1, T, BA, 'Gwen', '+12155550309');
  await cust(CF, T3, B3, 'Cora', '+12155550310'); await cust(X2, T2, B2, 'Xavi', '+12155550399');
  await q(`insert into notification_opt_outs (tenant_id, channel, address) values ($1,'sms','+12155550306')`, [T]);
  let n = 0;
  // a ticket at 3 PM salon time `daysAgo` days ago
  const tk = async (tenant: string, branch: string, cid: string, daysAgo: number, cents: number, status = 'closed') => {
    const tid = id('d' + String(++n).padStart(3, '0'));
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, created_at, paid_at)
      values ($1,$2,$3,$4,$5,$6,$7, ((((now() at time zone 'America/New_York')::date - $8::int)::timestamp + interval '15 hours') at time zone 'America/New_York'),
              ((((now() at time zone 'America/New_York')::date - $8::int)::timestamp + interval '15 hours') at time zone 'America/New_York'))`, [tid, tenant, branch, cid, status, cents, String(80000 + n), daysAgo]);
    return tid;
  };
  await tk(T, BA, G1, 150, 3000);                       // the salon's first ticket record: 150 days ago
  await tk(T, BA, SH, 100, 5000);                       // Shay: one visit 100 days ago
  await tk(T, BA, CX, 120, 9900, 'canceled');           // Cass: canceled only
  await tk(T, BA, AB, 10, 4000); await tk(T, BB, AB, 100, 6000); await tk(T, BB, AB, 130, 6000);   // Abby: A 10 days ago, B 100 + 130
  await tk(T, BA, OP, 90, 3000); await tk(T, BA, D1, 90, 3000); await tk(T, BA, D2, 95, 3000); await tk(T, BA, G1, 80, 3000);
  await tk(T, GHOST, G1, 70, 2500);                     // a settled ticket whose branch is not one of the salon's → Unknown branch
  // Tess: 11:30 PM salon time on day D=today-30 (03:30/04:30 UTC the next day) — D's visit; and 12:30 AM on D+1 — NOT D's
  const D = await dayAgo(30);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, created_at, paid_at)
    values ($1,$2,$3,$4,'paid',4200,'89001', (($5::date + interval '23 hours 30 minutes') at time zone 'America/New_York'), (($5::date + interval '23 hours 30 minutes') at time zone 'America/New_York'))`, [id('d901'), T, BA, TZ, D]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, created_at, paid_at)
    values ($1,$2,$3,$4,'paid',4200,'89002', (($5::date + interval '1 day 30 minutes') at time zone 'America/New_York'), (($5::date + interval '1 day 30 minutes') at time zone 'America/New_York'))`, [id('d902'), T, BA, TZ, D]);
  // salon T3: thresholds changed 30 days ago to At Risk 20 / Approaching 14 (version 1, through the screen)
  await tk(T3, B3, CF, 65, 5000);
  await q(`insert into tenant_retention_settings (tenant_id, risk_days, approaching_days, observation_window_days, version, updated_at) values ($1, 20, 14, 30, 1, now() - interval '30 days')`, [T3]);
  await q(`insert into tenant_retention_settings_history (tenant_id, version, risk_days, approaching_days, observation_window_days, effective_from, source) values ($1, 1, 20, 14, 30, now() - interval '30 days', 'settings_update')`, [T3]);
  await tk(T2, B2, X2, 50, 5000);
}, 240_000);

describe('CR-01 historical snapshots', () => {
  it('the same customer is in a different segment on two dates (Active → At Risk), with versioned rules', async () => {
    const d1 = await dayAgo(90), d2 = await dayAgo(20);
    const a = await snaps.computeDay(T, d1, { kind: 'backfill' }); const b = await snaps.computeDay(T, d2, { kind: 'backfill' });
    expect(a.outcome).toBe('computed'); expect(b.outcome).toBe('computed');
    expect(a.definitionVersion).toBe(definitionVersion(0));
    const r1 = (await snapRow(T, SH, d1))[0], r2 = (await snapRow(T, SH, d2))[0];
    expect([r1.segment, Number(r1.days_away), Number(r1.visit_count)]).toEqual(['active', 10, 1]);
    // d2: 80 days after the 100-days-ago visit
    expect([r2.segment, Number(r2.days_away), r2.data_quality]).toEqual(['at_risk', 80, 'reconstructed']);
  });
  it('never visited and cancellation-only customers are Never Visited on a past date (never At Risk)', async () => {
    const d = await dayAgo(20);
    const nv = (await snapRow(T, NV, d))[0], cx = (await snapRow(T, CX, d))[0];
    expect([nv.segment, Number(nv.visit_count), nv.last_visit_at]).toEqual(['never_visited', 0, null]);
    expect([cx.segment, Number(cx.visit_count)]).toEqual(['never_visited', 0]);
  });
  it('salon time-zone boundary: 11:30 PM local counts for that day, 12:30 AM the next local day does not', async () => {
    const D = await dayAgo(30); await snaps.computeDay(T, D, { kind: 'backfill' });
    const tz = (await snapRow(T, TZ, D))[0];
    expect([tz.segment, Number(tz.visit_count), Number(tz.days_away)]).toEqual(['active', 1, 0]);   // 11:30 PM counts; 12:30 AM next day does not
    const next = await dayAgo(29); await snaps.computeDay(T, next, { kind: 'backfill' });
    expect(Number((await snapRow(T, TZ, next))[0].visit_count)).toBe(2);
  });
  it('idempotent rerun: the same day again is skipped, nothing is rewritten (rows are append-only)', async () => {
    const d = await dayAgo(20);
    const before = (await q(`select count(*)::int n from customer_retention_daily_snapshots where tenant_id = $1 and snapshot_local_date = $2::date`, [T, d])).rows[0].n;
    const again = await snaps.computeDay(T, d, { kind: 'backfill' });
    const after = (await q(`select count(*)::int n from customer_retention_daily_snapshots where tenant_id = $1 and snapshot_local_date = $2::date`, [T, d])).rows[0].n;
    expect(again.outcome).toBe('skipped'); expect(after).toBe(before);
    expect(await code(q(`update customer_retention_daily_snapshots set segment = 'active' where tenant_id = $1`, [T]))).toMatch(/append-only/);
    expect(await code(q(`delete from customer_retention_daily_snapshots where tenant_id = $1`, [T]))).toMatch(/append-only/);
  });
  it('a config change is a NEW definition version: the stored day is not rewritten; history is recorded with the change', async () => {
    const d = await dayAgo(20);
    const saved = await repo.updateSettings(ctx, { riskDays: 90, approachingDays: 60, observationWindowDays: 30, expectedVersion: 0 }, async () => undefined);
    expect(saved.version).toBe(1);
    const h = (await q(`select version, risk_days, source from tenant_retention_settings_history where tenant_id = $1`, [T])).rows;
    expect(h.map((x: any) => [x.version, x.risk_days, x.source])).toEqual([[1, 90, 'settings_update']]);
    const again = await snaps.computeDay(T, d, { kind: 'backfill' });   // the day ended before the edit → still the defaults
    expect([again.outcome, again.definitionVersion]).toEqual(['skipped', definitionVersion(0)]);
    expect((await snapRow(T, SH, d))[0].segment).toBe('at_risk');
    await repo.updateSettings(ctx, { riskDays: 60, approachingDays: 45, observationWindowDays: 30, expectedVersion: 1 }, async () => undefined);
    // salon T3 changed to 20 days 30 days ago: 40 days ago → defaults (v0, Active); 10 days ago → v1 (At Risk at 55 days)
    const old = await snaps.computeDay(T3, await dayAgo(40), { kind: 'backfill' }); const nw = await snaps.computeDay(T3, await dayAgo(10), { kind: 'backfill' });
    expect([old.definitionVersion, nw.definitionVersion]).toEqual([definitionVersion(0), definitionVersion(1)]);
    expect((await snapRow(T3, CF, await dayAgo(40)))[0].segment).toBe('active');
    const r = (await snapRow(T3, CF, await dayAgo(10)))[0]; expect([r.segment, r.definition_version]).toEqual(['at_risk', 'retention-v2+s1']);
  });
  it('missing day → unverifiable; before the first ticket record → incomplete (no rows, never invented); today is not a completed day', async () => {
    const miss = await snaps.day(ctx, await dayAgo(55));
    expect([miss.state, miss.unverifiable, miss.counts]).toEqual(['missing', true, null]);
    const old = await dayAgo(300); const r = await snaps.computeDay(T, old, { kind: 'backfill' });
    expect([r.outcome, r.reason, r.rows]).toEqual(['incomplete', 'before_ticket_history', 0]);
    const v = await snaps.day(ctx, old); expect([v.state, v.unverifiable, v.run?.coverageReason]).toEqual(['incomplete', true, 'before_ticket_history']);
    expect(await code(snaps.computeDay(T, today, { kind: 'nightly' }))).toBe('SNAPSHOT_INVALID_DATE');
    expect((await snaps.day(ctx, today)).state).toBe('not_completed');
  });
  it('reads: day counts, member drill-down, compare (deltas + who moved) — another salon sees nothing', async () => {
    const a = await dayAgo(90), b = await dayAgo(20);
    const d = await snaps.day(ctx, b);
    expect(d.state).toBe('available'); expect(d.counts!.total).toBe(9); expect(d.counts!.never_visited).toBeGreaterThanOrEqual(2);
    const m = await snaps.members(ctx, { date: b, segment: 'at_risk', page: 1, pageSize: 50 });
    expect(m.items.some((x: any) => x.customerId === SH)).toBe(true); expect(m.items.every((x: any) => x.segment === 'at_risk' && /•••/.test(x.maskedPhone))).toBe(true);
    const c = await snaps.compare(ctx, a, b);
    expect(c.comparable).toBe(true); expect(c.transitions.some((t: any) => t.from === 'active' && t.to === 'at_risk')).toBe(true);
    const other = await snaps.day({ ...ctx, tenantId: T2 }, b); expect(other.state).toBe('missing');
    const runs = await snaps.runs(ctx, { from: await dayAgo(400), to: today, page: 1, pageSize: 50 });
    expect(runs.items.length).toBeGreaterThanOrEqual(4); expect(runs.items.every((x: any) => x.status === 'completed'));
  });
  it('backfill: bounded range → one durable job per day (audited in the same transaction); the job computes it; nightly coverage = complete', async () => {
    expect(await code(snaps.requestBackfill(ctx, { from: await dayAgo(3), to: today }, async () => undefined))).toBe('SNAPSHOT_INVALID_RANGE');
    expect(await code(snaps.requestBackfill(ctx, { from: await dayAgo(500), to: await dayAgo(1) }, async () => undefined))).toBe('SNAPSHOT_INVALID_RANGE');
    expect(await code(snaps.requestBackfill(ctx, { from: await dayAgo(2), to: await dayAgo(5) }, async () => undefined))).toBe('SNAPSHOT_INVALID_RANGE');
    // a failing audit queues nothing (fail-closed)
    expect(await code(snaps.requestBackfill(ctx, { from: await dayAgo(5), to: await dayAgo(3) }, async () => { throw new Error('audit down'); }))).toBe('audit down');
    expect((await q(`select count(*)::int n from jobs where job_type = $1 and tenant_id = $2`, [RETENTION_SNAPSHOT_JOB, T])).rows[0].n).toBe(0);
    let audited: any = null;
    const out = await snaps.requestBackfill(ctx, { from: await dayAgo(5), to: await dayAgo(3) }, async (_t, meta) => { audited = meta; });
    expect([out.days, out.queued, audited.days]).toEqual([3, 3, 3]);
    const jobs = (await q(`select payload from jobs where job_type = $1 and tenant_id = $2 order by run_after`, [RETENTION_SNAPSHOT_JOB, T])).rows;
    expect(jobs.length).toBe(3);
    for (const j of jobs) await runRetentionSnapshotJob(db, j.payload);
    for (const j of jobs) await runRetentionSnapshotJob(db, j.payload);   // a retried job is a no-op
    expect((await snaps.day(ctx, await dayAgo(4))).run?.coverage).toBe('reconstructed');
    const y = await snaps.computeDay(T, await dayAgo(1), { kind: 'nightly' });
    expect([y.outcome, y.coverage]).toEqual(['computed', 'complete']);
    const enq = await snaps.enqueueNightly(); const again = await snaps.enqueueNightly();
    expect(again.queued).toBe(0); expect(enq.tenants).toBeGreaterThanOrEqual(3);
  });
});

describe('CR-02 branch activity', () => {
  it('one customer with visits at A and B appears ONCE tenant-wide, with each branch\'s own metrics', async () => {
    const all = await repo.customers(ctx, { segment: 'all', q: 'Abby', page: 1, pageSize: 50 });
    expect(all.items.length).toBe(1); expect(all.scope.mode).toBe('tenant');
    const t = all.items[0]!; expect([t.customerId, t.visits, t.daysAway, t.segment]).toEqual([AB, 3, 10, 'active']);
    const a = (await repo.customers(ctx, { segment: 'all', q: 'Abby', branch: BA, page: 1, pageSize: 50 })).items;
    const b = (await repo.customers(ctx, { segment: 'all', q: 'Abby', branch: BB, page: 1, pageSize: 50 })).items;
    expect([a.length, a[0]!.customerId, a[0]!.visits, a[0]!.daysAway, a[0]!.segment]).toEqual([1, AB, 1, 10, 'active']);
    expect([b.length, b[0]!.customerId, b[0]!.visits, b[0]!.daysAway, b[0]!.segment]).toEqual([1, AB, 2, 100, 'at_risk']);
    const sB = await repo.summary(ctx, { branch: BB });
    expect([sB.scope.label, sB.scope.selectedBranchId]).toEqual(['branch_activity', BB]);
    const sAll = await repo.summary(ctx, {});
    expect(sAll.scope.label).toBe('tenant_wide'); expect(sAll.segments.all).toBe(sB.segments.all);   // the same customers, never duplicated
  });
  it('unknown-branch tickets are counted and shown, never allocated to a branch', async () => {
    const s = await repo.summary(ctx, {}); expect(s.scope.unknownBranchVisits).toBe(1);
    const g = (await repo.customers(ctx, { segment: 'all', q: 'Gwen', page: 1, pageSize: 5 })).items[0]!;
    const ga = (await repo.customers(ctx, { segment: 'all', q: 'Gwen', branch: BA, page: 1, pageSize: 5 })).items[0]!;
    expect([g.visits, ga.visits]).toEqual([3, 2]);   // tenant-wide includes it; Branch Alpha does not
  });
  it('an unauthorized branch is refused (403); a confined user\'s "all" is their own branches only', async () => {
    const confined = { ...ctx, authz: { scope: 'BRANCH', branchIds: [BA] } };
    const e = await repo.customers(confined, { segment: 'all', branch: BB, page: 1, pageSize: 5 }).then(() => null, (x) => x);
    expect([e?.code, e?.status]).toEqual(['BRANCH_NOT_AUTHORIZED', 403]);
    expect(await code(repo.summary(ctx, { branch: B2 }))).toBe('BRANCH_NOT_AUTHORIZED');        // another salon's branch
    expect(await code(repo.summary(ctx, { branch: 'nope' }))).toBe('RETENTION_INVALID_BRANCH');
    const s = await repo.summary(confined, {});
    expect([s.scope.mode, s.scope.branchIds, s.scope.branches.map((b: any) => b.branchId)]).toEqual(['branches', [BA], [BA]]);
    const abby = (await repo.customers(confined, { segment: 'all', q: 'Abby', page: 1, pageSize: 5 })).items[0]!;
    expect(abby.visits).toBe(1);   // Beta's visits are not shown to an Alpha-only user
  });
});

describe('CR-03 SMS cost estimate', () => {
  it('no price configured → "Price unknown — cannot estimate" (never $0)', async () => {
    const p = await svc.preview(ctx, { customerIds: [G1], body: 'We miss you! Come back soon.' });
    expect(p.estimate.status).toBe('price_unknown'); expect(p.costEstimateCents).toBeNull(); expect(p.estimate.totalCents).toBeNull();
    expect(p.estimate.uncertainty[0]).toMatch(/^Price unknown — cannot estimate/);
  });
  it('GSM-7 vs UCS-2: the same length costs more segments in Unicode; opted-out + duplicate phone are excluded from the estimate', async () => {
    expect(await code(pricing.setPricing(ctx, { retailPricePerSegment: 'abc' }, async () => undefined))).toBe('SMS_PRICING_INVALID');
    expect(await code(pricing.setPricing(ctx, { retailPricePerSegment: '0.035', currency: 'usd1' }, async () => undefined))).toBe('SMS_PRICING_INVALID');
    let audit: any = null;
    const set = await pricing.setPricing(ctx, { retailPricePerSegment: '0.035', currency: 'USD' }, async (_t, before, after) => { audit = { before, after }; });
    expect([set.retailPricePerSegment, set.carrierFeePerSegment, set.taxRatePercent, audit.before]).toEqual(['0.03500', null, null, null]);
    const ids = [OP, D1, D2, G1, SH];
    const gsm = await svc.preview(ctx, { customerIds: ids, body: 'We miss you! Book your next visit this week.' });
    expect(gsm.excludedReasons).toMatchObject({ opted_out: 1, duplicate_destination: 1 });
    expect(gsm.eligible).toBe(3); expect(gsm.estimate.recipients).toBe(3);
    expect([gsm.estimate.encoding, gsm.estimate.segmentsPerMessage, gsm.estimate.totalSegments]).toEqual(['GSM-7', 1, 3]);
    expect([gsm.estimate.subtotalCents, gsm.estimate.carrierFeesKnown, gsm.estimate.taxKnown, gsm.estimate.totalIsLowerBound]).toEqual([11, false, false, true]);   // 3 × $0.035 = $0.105 → 11¢
    const body = 'Chúng tôi nhớ bạn! Hẹn gặp lại tuần này nhé, ưu đãi đặc biệt cho bạn.';   // 70+ characters with Vietnamese marks
    const uni = await svc.preview(ctx, { customerIds: ids, body });
    expect(uni.estimate.encoding).toBe('UCS-2'); expect(uni.estimate.segmentsPerMessage).toBeGreaterThan(1);
    expect(uni.estimate.totalCents!).toBeGreaterThan(gsm.estimate.totalCents!);
    expect(await code(q(`update tenant_sms_pricing set retail_price_per_segment = 0 where tenant_id = $1`, [T]))).toMatch(/append-only/);
    expect((await pricing.pricingAt({ ...ctx, tenantId: T2 }))).toBeNull();   // another salon's price is never used
  });
  it('estimate arithmetic: exact decimals, known fees and tax, effective date', async () => {
    expect(toMicros('0.0079')).toBe(7900); expect(toMicros('1')).toBe(1_000_000);
    const p = { pricingId: 'x', currency: 'USD', retailPricePerSegment: '0.04', carrierFeePerSegment: '0.003', taxRatePercent: '10', effectiveFrom: new Date().toISOString(), note: null, setByRole: null, createdAt: '' };
    const e = estimateSms({ recipients: 100, segmentsPerMessage: 2, encoding: 'GSM-7' }, p);
    expect([e.subtotalCents, e.carrierFeesCents, e.taxCents, e.totalCents, e.totalIsLowerBound]).toEqual([800, 60, 86, 946, false]);
    await pricing.setPricing(ctx, { retailPricePerSegment: '0.05', effectiveFrom: new Date(Date.now() + 86400_000 * 5).toISOString() }, async () => undefined);
    expect((await pricing.pricingAt(ctx))!.retailPricePerSegment).toBe('0.03500');   // a future price is not in force yet
    expect((await pricing.overview(ctx)).upcoming.length).toBe(1);
  });
});
