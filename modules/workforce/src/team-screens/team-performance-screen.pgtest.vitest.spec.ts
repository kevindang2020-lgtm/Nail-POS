// team-performance-screen.pgtest — the Team Performance read model (Oct 30 2026) against the REAL schema. The photo's
// "5%" is a 5.0 / 5 average rating: here it reads 5.0 with its one-review sample. Total Services counts unique paid
// service lines (a shared line once; add-ons, retail and removed lines never); hidden / spam reviews never count; no
// reviews = Unrated, never "Needs Improvement"; a one-review 5.0 is never ranked above a well-sampled 4.8; tier
// boundaries at 2.5 / 3.5 / 4.5; search beyond the page; another salon never seen.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TeamPerformanceScreenRepository } from './team-performance-screen.repository';

const P = 'fa7e0000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), BX = id('b9'), U = id('e1'), CU = id('e2');
const VISHAL = id('c1'), KEVIN = id('c2'), CD = id('c3'), ANNA = id('c4'), BAO = id('c5'), OTHER = id('c9');
const ctx = { tenantId: T, branchId: B, userId: U, role: 'MANAGER', permissions: ['pos.technicians.view', 'customers.view'] };
let pg: any; let repo: TeamPerformanceScreenRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot','tp-a','TPA001','active'), ($2,'Other LLC','Other','tp-b','TPB001','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Elsewhere','active','America/New_York')`, [B, T, BX, T2]);
  for (const [tid, n, tenant, br, ph] of [[VISHAL, 'Vishal verma', T, B, '+18565557001'], [KEVIN, 'Kevin Dang', T, B, '+18565557002'], [CD, 'CD T6805', T, B, '+18565557003'], [ANNA, 'Anna Lee', T, B, '+18565557004'], [BAO, 'Bao Tran', T, B, '+18565557005'], [OTHER, 'Vishal Other', T2, BX, '+18565557001']])
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active, role_label, normalized_phone) values ($1,$2,$3,$4,'x',$4,'active',true,'Technician',$5)`, [tid, tenant, br, n, ph]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values ($1,$2,$3,'Mai','Le','Mai Le','+18565551234')`, [CU, T, B]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [id('d9'), T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$2,$3,$4,'Gel Manicure',45,5000,'active')`, [id('d1'), T, B, id('d9')]);
  let n = 0;
  const ticket = async (lines: { tech: string; kind?: string; addOn?: boolean; removed?: boolean; name?: string }[], number?: string) => {
    n++; const tk = id('f' + n);
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, paid_at) values ($1,$2,$3,$4,'paid',$5, now() - interval '2 hours')`, [tk, T, B, CU, number ?? `P-${100 + n}`]);
    for (const l of lines) await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, technician_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, line_kind, is_add_on, removed_at, status)
      values ($1,$2,$3,$4,$9,$5,5000,45,5000,$6,$7,$8,'completed')`, [T, B, tk, l.tech, l.name ?? 'Gel Manicure', l.kind ?? 'service', !!l.addOn, l.removed ? new Date() : null, id('d1')]);
    return tk;
  };
  // 16 unique service lines: Vishal 13 (one ticket also has an add-on, a retail line and a removed line — none count), Kevin 2, Anna 1
  await ticket([{ tech: VISHAL }, { tech: VISHAL, addOn: true, name: 'Nail Art' }, { tech: VISHAL, kind: 'retail', name: 'Cuticle Oil' }, { tech: VISHAL, removed: true }], 'P-777');
  for (let i = 0; i < 12; i++) await ticket([{ tech: VISHAL, name: i === 0 ? 'Spa Pedicure' : 'Gel Manicure' }]);
  await ticket([{ tech: KEVIN }, { tech: KEVIN }]); await ticket([{ tech: ANNA }]);
  const review = (tid: string, rating: number, opts: { hidden?: boolean; spam?: boolean; ago?: string } = {}) =>
    q(`insert into reviews (tenant_id, branch_id, technician_id, rating, comment, is_hidden_by_manager, is_spam, created_at) values ($1,$2,$3,$4,'nice',$5,$6, now() - $7::interval)`, [T, B, tid, rating, !!opts.hidden, !!opts.spam, opts.ago ?? '1 hour']);
  await review(VISHAL, 5);                                   // the photo: one 5★ review
  await review(VISHAL, 1, { hidden: true }); await review(VISHAL, 1, { spam: true });   // never counted
  for (const r of [5, 5, 4.5, 4.5, 5]) await review(ANNA, r); // 4.8 over 5 reviews
  for (const r of [3.5, 3.5, 3.5]) await review(BAO, r);      // exactly 3.5 → Very Good (boundary)
  await review(KEVIN, 2.5);                                   // exactly 2.5 → Good (boundary)
  await review(ANNA, 2, { ago: '40 days' });                  // a previous-period review
  await q(`insert into reviews (tenant_id, branch_id, technician_id, rating) values ($1,$2,$3,5)`, [T2, BX, OTHER]);
  repo = new TeamPerformanceScreenRepository(kyselyFor(pg) as never);
}, 180_000);

describe('Team Performance', () => {
  it('the three KPIs are ratings out of 5 with their samples (the photo\'s "5%" is 5.0 / 5), and services are unique paid lines', async () => {
    const d = await repo.dashboard(ctx, { preset: 'month' });
    // overall = every verified review: (5 + 5+5+4.5+4.5+5 + 3.5×3 + 2.5) / 10 = 4.2 · avg performance = mean of (5.0, 4.8, 3.5, 2.5) = 3.95 → 4.0
    expect(d.kpis).toMatchObject({ overallScore: 4.2, overallReviews: 10, avgPerformance: 4, ratedTechnicians: 4, technicians: 5, totalServices: 16 });
    expect(d.distribution).toEqual({ excellent: 2, very_good: 1, good: 1, needs: 0, unrated: 1 });
  });
  it('ranking never puts a one-review 5.0 above a well-sampled 4.8', async () => {
    const d = await repo.dashboard(ctx, { preset: 'month' });
    expect(d.topPerformers.map((t) => [t.name, t.score, t.reviews, t.lowSample])).toEqual([['Anna Lee', 4.8, 5, false], ['Bao Tran', 3.5, 3, false], ['Vishal verma', 5, 1, true], ['Kevin Dang', 2.5, 1, true]]);
  });
  it('the directory: tiers (Unrated is its own), sorting, and search by phone, service performed, customer and ticket — never another salon', async () => {
    expect((await repo.directory(ctx, { preset: 'month', tier: 'unrated' })).items.map((x) => x.name)).toEqual(['CD T6805']);
    expect((await repo.directory(ctx, { preset: 'month', tier: 'very_good' })).items.map((x) => x.name)).toEqual(['Bao Tran']);
    expect((await repo.directory(ctx, { preset: 'month', sort: 'services' })).items[0]).toMatchObject({ name: 'Vishal verma', services: 13, rating: 5, reviews: 1, tier: 'excellent', lowSample: true });
    expect((await repo.directory(ctx, { preset: 'month', q: '(856) 555-7001' })).items.map((x) => [x.name, x.matchedVia])).toEqual([['Vishal verma', 'technician']]);
    expect((await repo.directory(ctx, { preset: 'month', q: 'spa pedicure' })).items.map((x) => [x.name, x.matchedVia])).toEqual([['Vishal verma', 'work']]);
    expect((await repo.directory(ctx, { preset: 'month', q: 'P-777' })).items.map((x) => x.name)).toEqual(['Vishal verma']);
    expect((await repo.directory(ctx, { preset: 'month', q: '856 555 1234' })).totalItems).toBe(3);
  });
  it('Technician Performance Details: score with sample and rank, services and reviews newest first; a comparison only with enough reviews', async () => {
    const v = await repo.technician(ctx, VISHAL, { preset: 'month' });
    expect(v.score).toMatchObject({ rating: 5, reviews: 1, lowSample: true, tier: 'excellent', allTimeRating: 5, allTimeReviews: 1 });
    expect(v.rank).toEqual({ position: 3, of: 4 }); expect(v.services).toBe(13); expect(v.comparable).toBe(false);
    const s = await repo.services(ctx, VISHAL, { preset: 'month', pageSize: 5 });
    expect(s.totalItems).toBe(13); expect(s.totalPages).toBe(3);
    expect((await repo.reviews(ctx, VISHAL, { preset: 'month' })).items.map((r) => r.rating)).toEqual([5]);
    const a = await repo.technician(ctx, ANNA, { preset: 'month' });
    expect(a.score.allTimeReviews).toBe(6); expect(a.previous?.reviews).toBe(1);
    await expect(repo.technician(ctx, OTHER, { preset: 'month' })).rejects.toBeTruthy();
  });
});
