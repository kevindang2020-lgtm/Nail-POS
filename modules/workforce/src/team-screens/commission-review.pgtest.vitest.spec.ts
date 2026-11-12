// commission-review.pgtest — F1 + F2 (Finish the Five, 30 Oct 2026) against the REAL migrated schema (incl. 719):
// Run Check persists one review per finding (stable fingerprint, no duplicates on rescan), the rate check honours history
// and an approved ticket override and says UNABLE_TO_VERIFY when evidence is missing, the refund check reports Policy Not
// Configured and then a missing pro-rata reversal (a replayed webhook counted once), and the review workflow persists with
// append-only history, optimistic concurrency, the own-pay rule, permission denial and tenant isolation. Nothing in the
// ledger moves: compensation_adjustments / snapshots / payouts are counted before and after.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CommissionReviewRepository } from './commission-review.repository';

const P = 'fa7e0000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), BX = id('b9'), MGR = id('e1'), TECHU = id('e3'), OTHERU = id('e9');
const MIA = id('c1'), LEO = id('c2'), OTHER = id('c9'), GEL = id('d1'), CAT = id('d9');
const POL = id('d2'), TPOL = id('d3');
const mgr = { tenantId: T, branchId: B, userId: MGR, role: 'MANAGER', permissions: ['pos.reports.view', 'payroll.view', 'payroll.manage'] };
const viewer = { tenantId: T, branchId: B, userId: MGR, role: 'FRONT_DESK', permissions: ['pos.reports.view'] };
const miaSelf = { tenantId: T, branchId: B, userId: TECHU, role: 'TECHNICIAN', permissions: ['pos.reports.view', 'payroll.view'] };
const other = { tenantId: T2, branchId: BX, userId: OTHERU, role: 'MANAGER', permissions: ['pos.reports.view', 'payroll.view', 'payroll.manage'] };
// the last 30 days as a custom range: the fixture's lines are 1–20 days old, which "this month" missed in the first days of a month
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const RANGE = { preset: 'custom', from: ymd(new Date(Date.now() - 30 * 86_400_000)), to: ymd(new Date(Date.now() + 86_400_000)) } as const;
let pg: any; let repo: CommissionReviewRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const one = async (s: string, p: unknown[] = []) => (await q(s, p)).rows[0];
const ledger = async () => one(`select (select count(*) from compensation_adjustments)::int as adj, (select coalesce(sum(amount_cents),0) from compensation_adjustments)::bigint as adjsum,
  (select count(*) from ticket_compensation_snapshots)::int as snaps, (select coalesce(sum(tech_service_earnings_cents),0) from ticket_compensation_snapshots)::bigint as earned, (select count(*) from payroll_payouts)::int as payouts`);
let n = 0;
/** one paid ticket with one service line priced `daysAgo` days ago at `rate`% and the earnings recorded */
async function line(opts: { tech: string; rate: number | null; earned: number; base?: number; daysAgo?: number; tenant?: string; br?: string; ruleSource?: string | null }) {
  n++; const tenant = opts.tenant ?? T, br = opts.br ?? B, base = opts.base ?? 10000, tk = id('f' + n), ln = id('9' + String(n).padStart(3, '0')), d = opts.daysAgo ?? 10;
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, paid_at, subtotal_cents) values ($1,$2,$3,$7,'paid',$4, now() - ($5 || ' days')::interval + interval '1 hour', $6)`, [tk, tenant, br, `T-${3000 + n}`, String(d), base, tenant === T ? id('e5') : id('e6')]);
  await q(`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, commission_type_snapshot, commission_value_snapshot, created_at)
    values ($1,$2,$3,$4,$5,$6,'Gel Manicure',$7,45,$7,'percent',$8, now() - ($9 || ' days')::interval)`, [ln, tenant, br, tk, tenant === T ? GEL : null, opts.tech, base, opts.rate, String(d)]).catch(async () =>
    q(`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, created_at)
      values ($1,$2,$3,$4,$5,$6,'Gel Manicure',$7,45,$7, now() - ($8 || ' days')::interval)`, [ln, tenant, br, tk, id('d8'), opts.tech, base, String(d)]));
  await q(`insert into ticket_compensation_snapshots (tenant_id, branch_id, ticket_id, service_line_id, technician_id, service_id, engine_version, gross_price_cents, commissionable_cents, commission_type, commission_value, tech_service_earnings_cents, salon_service_share_cents, rule_source, snapshot_at)
    values ($1,$2,$3,$4,$5,$6,'1.0.0',$7,$7,'percent',$8,$9,$10,$11, now() - ($12 || ' days')::interval + interval '1 hour')`, [tenant, br, tk, ln, opts.tech, tenant === T ? GEL : id('d8'), base, opts.rate, opts.earned, base - opts.earned, opts.ruleSource === undefined ? 'Salon Default' : opts.ruleSource, String(d)]);
  return { tk, ln };
}
async function paid(ticket: string, cents: number) {
  const pid = id('7' + String(++n).padStart(3, '0'));
  await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, status) values ($1,$2,$3,$4,'card',$5,'approved')`, [pid, T, B, ticket, cents]);
  return pid;
}
const refund = (payment: string, cents: number, eventId: string, status = 'refunded') =>
  q(`insert into payment_refunds (tenant_id, branch_id, payment_id, amount_cents, status, event_id, created_at) values ($1,$2,$3,$4,$5,$6, now() - interval '2 days') returning id`, [T, B, payment, cents, status, eventId]).then((r: any) => String(r.rows[0].id));
let lines: Record<string, { tk: string; ln: string }> = {};

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, default_commission_percent) values ($1,'Pilot LLC','Pilot','cr-a','CRA001','active',50), ($2,'Other LLC','Other','cr-b','CRB001','active',50)`, [T, T2]);
  await q(`update tenants set updated_at = now() - interval '90 days' where id in ($1,$2)`, [T, T2]).catch(() => undefined);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Elsewhere','active','America/New_York')`, [B, T, BX, T2]);
  await q(`insert into users (id, tenant_id, branch_id, full_name, email, role, status) values ($1,$2,$3,'Kim Manager','kim@example.test','MANAGER','active'), ($4,$2,$3,'Mia Tran','mia@example.test','TECHNICIAN','active'), ($5,$6,$7,'Other Mgr','om@example.test','MANAGER','active')`,
    [MGR, T, B, TECHU, OTHERU, T2, BX]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ana','Le','Ana Le'), ($4,$5,$6,'Bo','Ng','Bo Ng')`, [id('e5'), T, B, id('e6'), T2, BX]);
  for (const [tid, nm, tenant, br, user] of [[MIA, 'Mia Tran', T, B, TECHU], [LEO, 'Leo Park', T, B, null], [OTHER, 'Other Tech', T2, BX, null]])
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active, role_label, user_id) values ($1,$2,$3,$4,'x',$4,'active',true,'Technician',$5)`, [tid, tenant, br, nm, user]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$2,$3,$4,'Gel Manicure',45,10000,'active')`, [GEL, T, B, CAT]);
  await q(`update services set updated_at = now() - interval '90 days' where id = $1`, [GEL]);
  // Salon Default: 40% from 60 days ago (v1, now replaced) → 30% from 2 days ago (v2). A service 10 days ago was 40%.
  await q(`insert into compensation_policies (id, tenant_id, label, created_at) values ($1,$2,'Salon default', now() - interval '60 days')`, [POL, T]);
  await q(`insert into compensation_policy_versions (policy_id, tenant_id, version, commission_type, commission_value, supply_method, supply_value, discount_funding, effective_start, effective_end, status, approved, created_at)
    values ($1,$2,1,'percent',40,'none',0,'proportional', now() - interval '60 days', now() - interval '2 days','replaced',true, now() - interval '60 days'),
           ($1,$2,2,'percent',30,'none',0,'proportional', now() - interval '2 days', null,'active',true, now() - interval '2 days')`, [POL, T]);
  lines.ok = await line({ tech: MIA, rate: 40, earned: 4000 });                     // history honoured: 40% then, 30% now → no alert
  lines.wrong = await line({ tech: LEO, rate: 30, earned: 3000 });                  // captured 30% while 40% was in effect → finding, −$10.00
  lines.override = await line({ tech: LEO, rate: 30, earned: 3000, ruleSource: 'Ticket Override' });
  // an approved ticket override for that ticket (authored before the line was priced) → honoured
  await q(`insert into compensation_policies (id, tenant_id, ticket_id, label, created_at) values ($1,$2,$3,'Ticket override', now() - interval '11 days')`, [TPOL, T, lines.override.tk]);
  await q(`insert into compensation_policy_versions (policy_id, tenant_id, version, commission_type, commission_value, supply_method, supply_value, discount_funding, effective_start, status, approved, created_at)
    values ($1,$2,1,'percent',30,'none',0,'proportional', now() - interval '11 days','active',true, now() - interval '11 days')`, [TPOL, T]);
  lines.legacy = await line({ tech: MIA, rate: null, earned: 2500, ruleSource: null });   // no captured rate → UNABLE_TO_VERIFY
  await line({ tech: OTHER, rate: 10, earned: 100, tenant: T2, br: BX });              // another salon
  // refunds: $100 ticket, Mia earned $40, $50 posted refund (the webhook replayed with the same event id), no reversal yet
  lines.refund = await line({ tech: MIA, rate: 40, earned: 4000, daysAgo: 5 });
  const pay = await paid(lines.refund.tk, 10000);
  await refund(pay, 5000, 'evt_123'); await refund(pay, 5000, 'evt_123'); await refund(pay, 3000, 'evt_999', 'failed');
  // a second refunded ticket whose pro-rata reversal IS recorded → no finding
  lines.reversed = await line({ tech: LEO, rate: 40, earned: 4000, daysAgo: 5 });
  const pay2 = await paid(lines.reversed.tk, 10000); const rid2 = await refund(pay2, 5000, 'evt_456');
  await q(`insert into compensation_adjustments (tenant_id, branch_id, technician_id, ticket_id, service_line_id, category, amount_cents, reason, status, source, refund_payment_id) values ($1,$2,$3,$4,$5,'refund_reversal',-2000,'refund','posted','refund',$6)`,
    [T, B, LEO, lines.reversed.tk, lines.reversed.ln, rid2]);
  repo = new CommissionReviewRepository(kyselyFor(pg) as never);
}, 180_000);

const findRev = async (type: string, line?: string) => one(`select * from commission_discrepancy_reviews where tenant_id = $1 and finding_type = $2 ${line ? 'and service_line_id = $3' : ''} order by detected_at desc limit 1`, line ? [T, type, line] : [T, type]);

describe('Run Check (F2 detectors + persisted findings)', () => {
  it('rate check: history and an approved override are honoured, a genuine mismatch is found, missing evidence is UNABLE_TO_VERIFY; no policy → Review Required', async () => {
    const before = await ledger();
    const r = await repo.runCheck(mgr, RANGE, 'req-run-1');
    expect(r.rateMismatch).toBe(1);
    expect(r.unableToVerify).toBe(1);
    expect(r.unableSamples[0]).toMatchObject({ serviceLineId: lines.legacy.ln });
    const wrong = await findRev('RATE_CONFIG');
    expect(wrong.service_line_id).toBe(lines.wrong.ln);
    expect(Number(wrong.expected_cents)).toBe(4000); expect(Number(wrong.recorded_cents)).toBe(3000); expect(Number(wrong.difference_cents)).toBe(-1000);
    expect(wrong.severity).toBe('high');
    expect(wrong.evidence_json.expectedRate).toMatchObject({ value: 40, source: 'Salon Default', policyVersion: 1 });
    expect(await findRev('RATE_CONFIG', lines.ok.ln)).toBeUndefined();
    expect(await findRev('RATE_CONFIG', lines.override.ln)).toBeUndefined();
    // the tenant has no refund-reversal policy → one Policy Not Configured finding per refunded ticket, nothing deducted
    expect(r.policy).toBeNull();
    const pnc = (await q(`select * from commission_discrepancy_reviews where tenant_id = $1 and finding_type = 'REFUND_REVERSAL'`, [T])).rows;
    expect(pnc.map((x: any) => x.verification_state).sort()).toEqual(['POLICY_NOT_CONFIGURED', 'POLICY_NOT_CONFIGURED']);
    expect(pnc.every((x: any) => x.expected_cents == null)).toBe(true);
    expect(await ledger()).toEqual(before);
    const scan = await one(`select status, finished_at from commission_discrepancy_scan_runs where tenant_id = $1 order by started_at desc limit 1`, [T]);
    expect(scan.status).toBe('succeeded'); expect(scan.finished_at).not.toBeNull();
  });
  it('a rescan never duplicates a finding (stable fingerprint)', async () => {
    const before = Number((await one(`select count(*) from commission_discrepancy_reviews where tenant_id = $1`, [T])).count);
    const r = await repo.runCheck(mgr, RANGE, 'req-run-2');
    expect(r.detected).toBe(0); expect(r.alreadyKnown).toBe(before);
    expect(Number((await one(`select count(*) from commission_discrepancy_reviews where tenant_id = $1`, [T])).count)).toBe(before);
  });
  it('PRO_RATA policy: a $50 refund of a $100 ticket expects $20 reversed; missing → finding; the replayed webhook is counted once; a recorded reversal → no finding', async () => {
    await expect(repo.setRefundPolicy(viewer, 'PRO_RATA', 'r')).rejects.toMatchObject({ status: 403 });
    await repo.setRefundPolicy(mgr, 'PRO_RATA', 'req-policy');
    const before = await ledger();
    await repo.runCheck(mgr, RANGE, 'req-run-3');
    const miss = (await q(`select * from commission_discrepancy_reviews where tenant_id = $1 and finding_type = 'REFUND_REVERSAL' and verification_state <> 'POLICY_NOT_CONFIGURED'`, [T])).rows;
    expect(miss).toHaveLength(1);
    expect(miss[0]).toMatchObject({ transaction_id: lines.refund.tk, technician_id: MIA });
    expect(Number(miss[0].expected_cents)).toBe(2000); expect(Number(miss[0].recorded_cents)).toBe(0);
    expect(miss[0].evidence_json.kind).toBe('MISSING');
    expect(await ledger()).toEqual(before);   // an investigation finding, never a deduction
    const audit = await one(`select count(*)::int as n from audit_events where tenant_id = $1 and action = 'compensation.refund_reversal_policy.set'`, [T]);
    expect(audit.n).toBe(1);
  });
});

describe('review workflow (F1)', () => {
  let rid: string;
  it('Assign → Investigate → Resolve persists with append-only history; reload shows it', async () => {
    rid = String((await findRev('RATE_CONFIG')).id);
    let d = await repo.detail(mgr, rid);
    expect(d.status).toBe('OPEN'); expect(d.actions).toEqual(['assign', 'investigate', 'note', 'resolve', 'dismiss']);
    d = await repo.act(mgr, rid, 'assign', { assigneeUserId: MGR, expectedVersion: d.version }, 'req-a');
    expect(d).toMatchObject({ status: 'ASSIGNED', assignee: 'Kim Manager', version: 2 });
    d = await repo.act(mgr, rid, 'investigate', { note: 'Checking the policy history', expectedVersion: 2 }, 'req-b');
    d = await repo.act(mgr, rid, 'note', { note: 'Line was rung before the rate change', expectedVersion: 3 }, 'req-c');
    expect(Number(d.expectedCents)).toBe(4000);   // a note never changes the amounts
    await expect(repo.act(mgr, rid, 'resolve', { resolutionCode: 'CORRECTED_SEPARATELY', note: '', expectedVersion: 4 }, 'r')).rejects.toMatchObject({ status: 422 });
    d = await repo.act(mgr, rid, 'resolve', { resolutionCode: 'CORRECTED_SEPARATELY', note: 'Adjustment requested in payroll', expectedVersion: 4 }, 'req-d');
    const again = await repo.detail(mgr, rid);
    expect(again).toMatchObject({ status: 'RESOLVED', resolutionCode: 'CORRECTED_SEPARATELY', resolutionNote: 'Adjustment requested in payroll', version: 5 });
    expect(again.history.items.map((e: any) => e.type)).toEqual(['RESOLVED', 'NOTE_ADDED', 'INVESTIGATION_STARTED', 'ASSIGNED', 'DETECTED']);
    expect((await one(`select count(*)::int as n from audit_events where tenant_id = $1 and resource_id = $2 and module = 'payroll'`, [T, rid])).n).toBe(4);
    await expect(q(`update commission_discrepancy_review_events set reason = 'x' where review_id = $1`, [rid])).rejects.toThrow(/append-only/);
    await expect(q(`delete from commission_discrepancy_reviews where id = $1`, [rid])).rejects.toThrow(/never deleted/);
  });
  it('a rescan keeps the reviewer decision', async () => {
    await repo.runCheck(mgr, RANGE, 'req-run-4');
    expect((await repo.detail(mgr, rid)).status).toBe('RESOLVED');
  });
  it('Dismiss → Reopen keeps the original note and disposition', async () => {
    const r = (await q(`select id, version from commission_discrepancy_reviews where tenant_id = $1 and status = 'OPEN' and finding_type = 'REFUND_REVERSAL' and technician_id is null limit 1`, [T])).rows[0];
    let d = await repo.act(mgr, String(r.id), 'dismiss', { reason: 'Policy now configured; superseded', expectedVersion: Number(r.version) }, 'req-e');
    expect(d.status).toBe('DISMISSED');
    d = await repo.act(mgr, String(r.id), 'reopen', { reason: 'Owner asked to look again', expectedVersion: d.version }, 'req-f');
    expect(d).toMatchObject({ status: 'OPEN', dismissReason: 'Policy now configured; superseded' });
    const reopened = d.history.items.find((e: any) => e.type === 'REOPENED');
    expect(reopened.metadata.previousDismissReason).toBe('Policy now configured; superseded');
    expect(d.history.items.find((e: any) => e.type === 'DISMISSED').reason).toBe('Policy now configured; superseded');
  });
  it('two managers on the same version: the second is rejected (409), nothing overwritten', async () => {
    const r = await findRev('REFUND_REVERSAL'); const v = Number(r.version);
    await repo.act(mgr, String(r.id), 'note', { note: 'first', expectedVersion: v }, 'x1');
    await expect(repo.act(mgr, String(r.id), 'note', { note: 'second', expectedVersion: v }, 'x2')).rejects.toMatchObject({ status: 409 });
    expect((await repo.detail(mgr, String(r.id))).history.items.filter((e: any) => e.reason === 'second')).toHaveLength(0);
  });
  it('an unauthorised user cannot resolve (403, no mutation); invalid transitions are refused', async () => {
    const r = (await q(`select id, version, status from commission_discrepancy_reviews where tenant_id = $1 and status = 'OPEN' limit 1`, [T])).rows[0];
    await expect(repo.act(viewer, String(r.id), 'resolve', { resolutionCode: 'NO_ACTION', note: 'looks fine', expectedVersion: Number(r.version) }, 'x')).rejects.toMatchObject({ status: 403 });
    expect(Number((await one(`select version from commission_discrepancy_reviews where id = $1`, [r.id])).version)).toBe(Number(r.version));
    await expect(repo.act(mgr, String(r.id), 'reopen', { reason: 'not closed yet', expectedVersion: Number(r.version) }, 'x')).rejects.toMatchObject({ status: 422 });
  });
  it('a technician cannot resolve a finding about her own pay; the denial is recorded', async () => {
    const r = (await q(`select id, version from commission_discrepancy_reviews where tenant_id = $1 and technician_id = $2 and status = 'OPEN' limit 1`, [T, MIA])).rows[0];
    await expect(repo.act(miaSelf, String(r.id), 'resolve', { resolutionCode: 'NO_ACTION', note: 'my pay is fine', expectedVersion: Number(r.version) }, 'x')).rejects.toMatchObject({ status: 403 });
    const d = await repo.detail(mgr, String(r.id));
    expect(d.status).toBe('OPEN'); expect(d.history.items[0].type).toBe('DENIED');
  });
  it('another salon gets 404 for this review and never sees it in its list', async () => {
    await expect(repo.detail(other, rid)).rejects.toMatchObject({ status: 404 });
    await expect(repo.act(other, rid, 'note', { note: 'x', expectedVersion: 5 }, 'x')).rejects.toMatchObject({ status: 404 });
    expect((await repo.list(other, {})).totalItems).toBe(0);
  });
  it('the list is newest first with status counts, filters and paging', async () => {
    const l = await repo.list(mgr, { pageSize: 2 });
    expect(l.items).toHaveLength(2); expect(l.totalPages).toBeGreaterThan(1);
    expect(l.counts.RESOLVED).toBe(1);
    expect(l.lastRun?.status).toBe('succeeded');
    expect((await repo.list(mgr, { status: 'RESOLVED' })).items.map((x: any) => x.id)).toEqual([rid]);
    const t = (await repo.list(mgr, { pageSize: 100 })).items.map((x: any) => x.detectedAt);
    expect([...t].sort().reverse()).toEqual(t);
  });
  it('Extras (Finish the Five 05): open findings grouped by age — new / this week / overdue (> 7 days), filterable, oldest first on request', async () => {
    const open = (await repo.list(mgr, { status: 'open_all', pageSize: 100 })).items;
    expect(open.length).toBeGreaterThanOrEqual(2);
    // age two open findings: one 3 days, one 10 days (closed findings never count)
    await q(`update commission_discrepancy_reviews set detected_at = now() - interval '3 days' where id = $1`, [open[0].id]);
    await q(`update commission_discrepancy_reviews set detected_at = now() - interval '10 days' where id = $1`, [open[1].id]);
    await q(`update commission_discrepancy_reviews set detected_at = now() - interval '30 days' where id = $1`, [rid]);   // RESOLVED
    const l = await repo.list(mgr, { status: 'open_all', pageSize: 100 });
    const openN = l.counts.OPEN + l.counts.ASSIGNED + l.counts.INVESTIGATING;
    expect(l.ageCounts.overdue).toBe(1); expect(l.ageCounts.week).toBe(1); expect(l.ageCounts.new).toBe(openN - 2); expect(l.ageCounts.overdueAfterDays).toBe(7);
    const od = await repo.list(mgr, { status: 'all', age: 'overdue' });
    expect(od.items.map((x: any) => x.id)).toEqual([open[1].id]);   // the 30-day RESOLVED one is not overdue work
    expect(od.items[0]).toMatchObject({ ageDays: 10, overdue: true });
    expect((await repo.list(mgr, { status: 'open_all', age: 'week' })).items.map((x: any) => x.id)).toEqual([open[0].id]);
    const oldestFirst = (await repo.list(mgr, { status: 'open_all', sort: 'oldest', pageSize: 100 })).items;
    expect(oldestFirst[0].id).toBe(open[1].id);
    expect(oldestFirst.find((x: any) => x.id === open[0].id)).toMatchObject({ ageDays: 3, overdue: false });
    expect((await repo.list(other, { age: 'overdue' })).totalItems).toBe(0);
  });
});
