// tech-queue-lanes-1000.pgtest — 200-technician mandate §2 (Oct 27 2026): GET /pos/tech-queue/state returned one lane row,
// one lane and one Available row per technician and every technician's name (filters.technicians) — at 1,000 technicians the
// POS Tech Queue downloaded the whole roster on every refresh and paged it on screen. With lanePage the server returns ONE
// page of lane rows (rotation order, searchable by name / specialty — accent-insensitive — or "#n", filtered by status
// group), only those technicians' lanes, one page of Available Technicians, the Workload Board as counts over everyone with
// a few rows each, and (roster=none) no name list. Measured against the real migrated schema with 1,000 technicians.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselyTechQueueRepository } from './tech-queue.kysely.repository';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = 'cccccccc-0000-4000-8000-0000000010a1';
const B = 'cccccccc-0000-4000-8000-0000000010a2';
const N = 1000;
const ctx = { tenantId: T, branchId: B } as never;
let repo: KyselyTechQueueRepository;

/** the largest technician-shaped list anywhere in a response */
function maxTechList(body: unknown): number {
  if (!body || typeof body !== 'object') return 0;
  let n = 0;
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (Array.isArray(v) && (/technician/i.test(k) || v.some((x) => x && typeof x === 'object' && 'technicianId' in (x as object)))) n = Math.max(n, v.length);
    if (v && typeof v === 'object') n = Math.max(n, maxTechList(v));
  }
  return n;
}

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'Big Salon LLC', 'Big Salon', 'big-salon-tq', 'BIGTQ1', 'active') ON CONFLICT DO NOTHING;`);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name, status, timezone) VALUES ('${B}', '${T}', 'Main', 'active', 'America/New_York') ON CONFLICT DO NOTHING;`);
  // 1,000 technicians "Tech 0001" … "Tech 1000"; #7 has a Vietnamese name; every 10th is on break
  await pg.exec(`INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status)
    SELECT ('cccccccc-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, '${T}', '${B}', 'Tech', lpad(g::text, 4, '0'),
           CASE WHEN g = 7 THEN 'Nguyễn Thị Hương' ELSE 'Tech ' || lpad(g::text, 4, '0') END, 'active'
    FROM generate_series(1, ${N}) g;`);
  await pg.exec(`INSERT INTO technician_statuses (tenant_id, branch_id, technician_id, status)
    SELECT '${T}', '${B}', ('cccccccc-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, CASE WHEN g % 10 = 0 THEN 'on_break' ELSE 'available' END
    FROM generate_series(1, ${N}) g;`);
  repo = new KyselyTechQueueRepository(kyselyFor(pg) as never);
}, 120_000);

describe('§2 Tech Queue state at 1,000 technicians — one page, never the roster', () => {
  it('lanePage: one page of lane rows / lanes / available, the workload as counts, the totals; roster=none drops the names', async () => {
    const st: any = await repo.query(ctx, { lanePage: 1, lanePageSize: 10, roster: 'none' });
    expect(st.lanes).toEqual({ page: 1, pageSize: 10, total: N, totalPages: 100, totalAll: N });
    expect(st.technicianRows).toHaveLength(10);
    expect(st.technicianRows.map((r: any) => r.rotationPosition)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const onPage = new Set(st.technicianRows.map((r: any) => r.technicianId));
    expect(st.technicianLanes.length).toBeLessThanOrEqual(10);
    expect(st.technicianLanes.every((l: any) => onPage.has(l.technicianId))).toBe(true);
    expect(st.availableTechnicians).toHaveLength(10);
    expect(st.availableTechniciansTotal).toBe(N);   // available + on break + off: every technician here
    expect(st.filters.technicians).toEqual([]);
    expect(st.workload.available.count).toBe(900);
    expect(st.workload.breakOffline.count).toBe(100);
    expect(st.workload.available.items.length).toBeLessThanOrEqual(4);
    expect(st.technicianRows[0].nextAvailable).toBe('now');
    expect(st.kpis.availableTechnicians).toBe(900);   // the KPIs still count everyone
    expect(maxTechList(st)).toBeLessThanOrEqual(10);
  });
  it('the last page, a page past the end, the size cap (48), "#n", accent-insensitive name search, status group', async () => {
    const last: any = await repo.query(ctx, { lanePage: 100, lanePageSize: 10, roster: 'none' });
    expect(last.lanes.page).toBe(100); expect(last.technicianRows).toHaveLength(10);
    expect(((await repo.query(ctx, { lanePage: 5000, lanePageSize: 10 })) as any).lanes.page).toBe(100);
    const big: any = await repo.query(ctx, { lanePage: 1, lanePageSize: 5000, roster: 'none' });
    expect(big.technicianRows).toHaveLength(48); expect(maxTechList(big)).toBeLessThanOrEqual(48);
    const rot: any = await repo.query(ctx, { lanePage: 1, lanePageSize: 10, laneSearch: '#1000', roster: 'none' });
    expect(rot.technicianRows.map((r: any) => r.rotationPosition)).toEqual([1000]);
    const vi: any = await repo.query(ctx, { lanePage: 1, lanePageSize: 10, laneSearch: 'nguyen thi huong', roster: 'none' });
    expect(vi.technicianRows.map((r: any) => r.technicianName)).toEqual(['Nguyễn Thị Hương']);
    const brk: any = await repo.query(ctx, { lanePage: 1, lanePageSize: 10, laneStatus: 'break', roster: 'none' });
    expect(brk.lanes.total).toBe(100); expect(brk.technicianRows.every((r: any) => r.status === 'on_break')).toBe(true);
  });
  it('the paged response is a small fraction of the legacy one (which still answers every lane for an older client)', async () => {
    const legacy: any = await repo.query(ctx, {});
    expect(legacy.technicianRows).toHaveLength(N);
    expect(legacy.filters.technicians).toHaveLength(N);
    const paged = await repo.query(ctx, { lanePage: 1, lanePageSize: 10, roster: 'none' });
    expect(JSON.stringify(paged).length).toBeLessThan(JSON.stringify(legacy).length / 20);
  });
});
