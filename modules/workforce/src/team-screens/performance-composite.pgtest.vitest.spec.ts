// performance-composite.pgtest — F5 (Finish the Five, 30 Oct 2026) against the REAL schema (incl. 719): the composite is
// a separate 0–100 field beside the untouched 0–5 verified rating; satisfaction 4.5/5 with ≥ 5 verified reviews = 90;
// hidden / spam reviews excluded; customer no-shows excluded from reliability; customer-late starts excluded from on-time;
// insufficient on-time evidence or the unsupported correction component → "not available" (null, never 0); a refund is
// never a correction; snapshots are append-only and keep their model version; comparison mode never re-ranks.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TeamPerformanceScreenRepository } from './team-performance-screen.repository';

const P = 'fa810000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), BX = id('b9'), U = id('e1'), CU = id('e2');
const MIA = id('c1'), LEO = id('c2'), OTHER = id('c9');
const mgr = { tenantId: T, branchId: B, userId: U, role: 'MANAGER', permissions: ['pos.technicians.view', 'pos.technicians.edit'] };
const viewer = { ...mgr, permissions: ['pos.technicians.view'] };
let pg: any; let repo: TeamPerformanceScreenRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const review = (tech: string, rating: number, o: { hidden?: boolean; spam?: boolean } = {}) =>
  q(`insert into reviews (tenant_id, branch_id, technician_id, customer_id, rating, is_hidden_by_manager, is_spam, created_at) values ($1,$2,$3,$4,$5,$6,$7, now() - interval '1 day')`, [T, B, tech, CU, rating, !!o.hidden, !!o.spam]);
const ticket = (tech: string, status: string, appt?: string, startedMinutesAfterPlanned?: number) =>
  q(`insert into pos_tech_queue_tickets (tenant_id, branch_id, customer_name, assigned_technician_id, status, appointment_id, assigned_at, started_at)
     values ($1,$2,'Guest',$3,$4,$5, now() - interval '1 day', ${startedMinutesAfterPlanned == null ? 'null' : `(select ((a.appt_date + a.start_time::time) at time zone 'America/New_York') + make_interval(mins => ${startedMinutesAfterPlanned}) from pos_tech_appointments a where a.id = $5)`})`,
    [T, B, tech, status, appt ?? null]);
const appointment = async (tech: string, arrivedMinutesAfterPlanned: number | null) => {
  const r = await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status, source)
    values ($1,$2,$3,'Guest','[]'::jsonb, current_date - 1, '10:00', '11:00', 60, 'completed', 'online') returning id`, [T, B, tech]);
  const aid = String(r.rows[0].id);
  if (arrivedMinutesAfterPlanned != null) await q(`update pos_tech_appointments set arrived_at = ((appt_date + start_time::time) at time zone 'America/New_York') + make_interval(mins => $2) where id = $1`, [aid, arrivedMinutesAfterPlanned]);
  return aid;
};

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot','pc-a','PCA001','active'), ($2,'Other LLC','Other','pc-b','PCB001','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Elsewhere','active','America/New_York')`, [B, T, BX, T2]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ana','Le','Ana Le')`, [CU, T, B]);
  for (const [tid, nm, tenant, br] of [[MIA, 'Mia Tran', T, B], [LEO, 'Leo Park', T, B], [OTHER, 'Other Tech', T2, BX]])
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active, role_label) values ($1,$2,$3,$4,'x',$4,'active',true,'Technician')`, [tid, tenant, br, nm]);
  for (const r of [5, 4, 5, 4, 5, 4]) await review(MIA, r);                  // 6 verified, average 4.5
  await review(MIA, 1, { hidden: true }); await review(MIA, 1, { spam: true }); // never counted
  for (let i = 0; i < 10; i++) await ticket(MIA, 'service_done');
  await ticket(MIA, 'declined'); await ticket(MIA, 'no_show'); await ticket(MIA, 'no_show');   // the customer no-shows are excluded
  // on-time: 3 qualifying (2 on time, 1 late) + 1 customer late (excluded) + 1 with no start recorded (excluded) → 3 < 10
  for (const [arr, start] of [[-5, 5], [0, 0], [-10, 25], [20, 30], [-5, null]] as [number, number | null][]) { const a = await appointment(MIA, arr); await ticket(MIA, 'service_done', a, start ?? undefined); }
  await review(LEO, 3);
  repo = new TeamPerformanceScreenRepository(kyselyFor(pg) as never);
}, 180_000);

describe('versioned composite score (F5)', () => {
  it('the 0–5 verified rating is untouched; the composite is a separate 0–100 field with every component, sample and threshold', async () => {
    const c = await repo.composite(mgr, MIA, { preset: 'month' });
    expect(c.rating).toEqual({ scale: '0-5', average: 4.5, reviews: 6 });
    expect(c.modelVersion).toBe('composite-v1'); expect(c.mode).toBe('comparison');
    const by = Object.fromEntries(c.components.map((x: any) => [x.key, x]));
    expect(by.satisfaction).toMatchObject({ value: 90, sample: 6, threshold: 5, status: 'OK' });
    expect(by.reliability).toMatchObject({ sample: 16, excluded: 2, status: 'OK' });   // 15 done + 1 declined; the 2 no-shows are excluded
    expect(by.reliability.value).toBe(93.8);
    expect(by.onTime).toMatchObject({ sample: 3, excluded: 2, status: 'INSUFFICIENT', value: null });
    expect(by.correction).toMatchObject({ status: 'UNSUPPORTED', value: null });
    expect(c.score).toBeNull(); expect(c.available).toBe(false); expect(c.missing).toEqual(['onTime', 'correction']);
  });
  it('a refund is never counted as a correction (the component stays unsupported, never 0 or 100)', async () => {
    const tk = id('f1');
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, paid_at) values ($1,$2,$3,$4,'paid','T-1', now() - interval '1 day')`, [tk, T, B, CU]);
    await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, status) values ($1,$2,$3,$4,'card',5000,'approved')`, [id('f2'), T, B, tk]);
    await q(`insert into payment_refunds (tenant_id, branch_id, payment_id, amount_cents, status) values ($1,$2,$3,2500,'refunded')`, [T, B, id('f2')]);
    const c = await repo.composite(mgr, MIA, { preset: 'month' });
    expect(c.components.find((x: any) => x.key === 'correction')).toMatchObject({ status: 'UNSUPPORTED', value: null });
  });
  it('comparison mode: the rating ranking beside the composite — an insufficient technician is never ranked as 0', async () => {
    const r = await repo.compositeComparison(mgr, { preset: 'month' });
    expect(r.rankedBy).toBe('verified_rating');
    expect(r.items.map((i: any) => [i.name, i.ratingRank, i.composite])).toEqual([['Mia Tran', 1, null], ['Leo Park', 2, null]]);
    expect(r.items.every((i: any) => i.composite !== 0)).toBe(true);
    expect(r.items.map((i: any) => i.name)).not.toContain('Other Tech');
  });
  it('snapshots are append-only and keep their model version; permission and tenant are enforced', async () => {
    await expect(repo.saveScoreSnapshot(viewer, { technicianId: MIA, preset: 'month' })).rejects.toMatchObject({ status: 403 });
    const s = await repo.saveScoreSnapshot(mgr, { technicianId: MIA, preset: 'month' });
    expect(s).toMatchObject({ modelVersion: 'composite-v1', score: null, missing: ['onTime', 'correction'] });
    expect((await repo.composite(mgr, MIA, { preset: 'month' })).snapshots[0]).toMatchObject({ id: s.id, modelVersion: 'composite-v1', inputChecksum: s.inputChecksum });
    await expect(q(`update performance_score_snapshots set model_version = 'composite-v2' where id = $1`, [s.id])).rejects.toThrow(/append-only/);
    await expect(repo.composite({ ...mgr, tenantId: T2, branchId: BX }, MIA, {})).rejects.toMatchObject({ status: 404 });
  });
});

describe('round 10 — Finish the Five 12: version comparison from the saved snapshots (nothing recomputed, nothing re-ranked)', () => {
  it('one version → nothing to compare; two versions saved for the same period → side by side with the component differences', async () => {
    const one = (await repo.composite(mgr, LEO, { preset: 'month' })).versionComparison;
    expect(one).toEqual({ versions: [], comparable: false, diff: null, reranked: false });
    await repo.saveScoreSnapshot(mgr, { technicianId: LEO, preset: 'month' });
    const v1only: any = (await repo.composite(mgr, LEO, { preset: 'month' })).versionComparison;
    expect(v1only.versions.map((v: any) => v.version)).toEqual(['composite-v1']); expect(v1only.comparable).toBe(false);
    // a later model version saved for the same period (written as a new immutable row, as a future model would)
    const base = (await q(`select period_start, period_end from performance_score_snapshots where technician_id = $1 order by computed_at desc limit 1`, [LEO])).rows[0];
    await q(`insert into performance_score_snapshots (tenant_id, branch_id, technician_id, period_start, period_end, model_version, components_json, missing_json, score, input_checksum, computed_at)
      values ($1,$2,$3,$4,$5,'composite-v2','[{"key":"reviews","value":70},{"key":"reliability","value":90}]'::jsonb,'[]'::jsonb, 80.5,'chk-v2', now() + interval '1 minute')`, [T, B, LEO, base.period_start, base.period_end]);
    const c: any = (await repo.composite(mgr, LEO, { preset: 'month' })).versionComparison;
    expect(c.comparable).toBe(true); expect(c.reranked).toBe(false);
    expect(c.versions.map((v: any) => v.version)).toEqual(['composite-v2', 'composite-v1']);
    expect(c.diff).toMatchObject({ from: { version: 'composite-v1' }, to: { version: 'composite-v2', score: 80.5 } });
    expect(c.diff.components.find((x: any) => x.key === 'reliability')).toMatchObject({ to: 90 });
    // the rating ranking (Top Performers) is untouched by any snapshot
    const r = await repo.compositeComparison(mgr, { preset: 'month' });
    expect(r.items.map((i: any) => [i.name, i.ratingRank])).toEqual([['Mia Tran', 1], ['Leo Park', 2]]);
  });
});
