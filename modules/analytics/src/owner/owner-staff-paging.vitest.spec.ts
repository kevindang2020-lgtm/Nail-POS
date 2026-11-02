// owner-staff-paging.vitest.spec — 200-technician mandate §62 / §69 / §71 (Oct 26 2026): the Owner App's Staff
// Performance lists EVERY technician of the period — searched, sorted and paged on the server — while the summary keeps
// its top-10 card. Pure paging + the service over an in-memory 200-technician salon (the SQL aggregates behind the inputs
// are the same ones getStaffPerformance already used).
import { describe, it, expect } from 'vitest';
import { OwnerService } from './owner.service';
import { InMemoryOwnerRepository, type OwnerContext } from './owner.repository';
import { pageStaffRows, OWNER_STAFF_PAGE_SIZE_MAX } from './owner-staff-paging';

const ctx = (perms: string[]): OwnerContext => ({ tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: perms } as any);
const N = 200;
const name = (i: number) => `Tech ${String(i).padStart(3, '0')}`;
class Salon200 extends InMemoryOwnerRepository {
  async allowedBranchIds() { return null; }
  async userHomeBranch() { return null; }
  async tenantTimezoneCurrency() { return { timezone: 'UTC', currency: 'USD' }; }
  async listTechnicians() { return Array.from({ length: N }, (_, i) => ({ technicianId: 't' + (i + 1), fullName: name(i + 1), status: 'active', isActive: true })); }
  // tech #i sells i × $10 (so #200 ranks first), does i % 17 services, earns 40 % commission
  async staffSales() { return Array.from({ length: N }, (_, i) => ({ technicianId: 't' + (i + 1), servicesCompleted: (i + 1) % 17, salesCents: (i + 1) * 1000, commissionCents: (i + 1) * 400, busyMinutes: (i + 1) % 60 })); }
  async ratingsByTechnician() { return [{ technicianId: 't7', rating: 5, reviewCount: 3 }]; }
  async scheduledMinutesByTechnician() { return Array.from({ length: N }, (_, i) => ({ technicianId: 't' + (i + 1), minutes: 600 })); }
  async activeTechnicianCount() { return { active: 150, scheduled: 180 }; }
}
const svc = () => new OwnerService(new Salon200());
const PERMS = ['owner.staff.performance.view'];

describe('Owner Staff Performance at 200 technicians (§62 / §69 / §71)', () => {
  it('the summary keeps its top-10 card; the paged list holds all 200 with a whole-team sales rank', async () => {
    const sum = await svc().getStaffPerformance(ctx(PERMS), 'month');
    expect(sum.topTechnicians.length).toBe(10);
    expect(sum.topTechnicians[0].technicianId).toBe('t200');
    expect(sum.totalStaff).toBe(200);
    const p1 = await svc().getStaffPerformanceTechnicians(ctx(PERMS), { period: 'month' });
    expect(p1.totalAll).toBe(200); expect(p1.total).toBe(200);
    expect(p1.pageSize).toBe(20); expect(p1.totalPages).toBe(10);
    expect(p1.items.map((r) => r.rank)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(p1.items[0]).toMatchObject({ technicianId: 't200', salesCents: 200_000, commissionCents: 80_000 });
    const last = await svc().getStaffPerformanceTechnicians(ctx(PERMS), { period: 'month', page: 10 });
    expect(last.items.length).toBe(20); expect(last.items[19]).toMatchObject({ technicianId: 't1', rank: 200 });
    // the sum of every page equals the summary's commission — nobody dropped, nobody twice
    let total = 0; const seen = new Set<string>();
    for (let page = 1; page <= 10; page++) for (const r of (await svc().getStaffPerformanceTechnicians(ctx(PERMS), { period: 'month', page })).items) { total += r.commissionCents; seen.add(r.technicianId); }
    expect(seen.size).toBe(200); expect(total).toBe(sum.totalCommissionCents);
  });

  it('search (name or #rank), sort and direction run on the server', async () => {
    const s = await svc().getStaffPerformanceTechnicians(ctx(PERMS), { period: 'month', search: 'tech 15' });
    expect(s.items.map((r) => r.fullName)).toEqual(['Tech 159', 'Tech 158', 'Tech 157', 'Tech 156', 'Tech 155', 'Tech 154', 'Tech 153', 'Tech 152', 'Tech 151', 'Tech 150']);
    expect(s.total).toBe(10); expect(s.totalAll).toBe(200);
    const r = await svc().getStaffPerformanceTechnicians(ctx(PERMS), { period: 'month', search: '#50' });
    expect(r.items.map((x) => x.technicianId)).toEqual(['t151']);   // rank 50 by sales = #151
    const byName = await svc().getStaffPerformanceTechnicians(ctx(PERMS), { period: 'month', sort: 'name' });
    expect(byName.dir).toBe('asc'); expect(byName.items[0].fullName).toBe('Tech 001');
    const canon = await svc().getStaffPerformanceTechnicians(ctx(PERMS), { period: 'month', sort: '-name' });
    expect(canon.sort).toBe('name'); expect(canon.dir).toBe('desc'); expect(canon.items[0].fullName).toBe('Tech 200');
    const byRating = await svc().getStaffPerformanceTechnicians(ctx(PERMS), { period: 'month', sort: 'rating' });
    expect(byRating.items[0].technicianId).toBe('t7');
    const svcAsc = await svc().getStaffPerformanceTechnicians(ctx(PERMS), { period: 'month', sort: 'services', dir: 'asc', pageSize: 5 });
    expect(svcAsc.items.every((x) => x.servicesCompleted === 0)).toBe(true);
  });

  it('bounded pages, unknown sort falls back, permission gate', async () => {
    const big = await svc().getStaffPerformanceTechnicians(ctx(PERMS), { period: 'month', pageSize: 100000 });
    expect(big.pageSize).toBe(OWNER_STAFF_PAGE_SIZE_MAX); expect(big.items.length).toBe(100);
    expect((await svc().getStaffPerformanceTechnicians(ctx(PERMS), { period: 'month', sort: 'drop table' })).sort).toBe('sales');
    expect((await svc().getStaffPerformanceTechnicians(ctx(PERMS), { period: 'month', page: 999 })).page).toBe(10);
    await expect(svc().getStaffPerformanceTechnicians(ctx(['owner.dashboard.view']), {})).rejects.toThrow(/permission/i);
  });

  it('pageStaffRows: an empty team is one empty page', () => {
    expect(pageStaffRows([], { from: 'a', to: 'b' })).toMatchObject({ items: [], total: 0, totalAll: 0, page: 1, totalPages: 1, sort: 'sales', dir: 'desc' });
  });
});
