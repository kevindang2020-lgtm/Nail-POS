// salon-browse-paging.pgtest — B-28 (Oct 20 2026): GET /customer/salons/nearby with no location (the customer app's Home
// and Book screens browsing) read EVERY listed partner branch on the platform and returned all of them — no page, no cap;
// the city / text filters ran in memory after the read. Now the browse is a keyset page (limit, default 50, max 100;
// nextCursor), the filters and the public_listing flag are in the SQL, and a located search is bounded by its radius box.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CustomerSalonsService } from './customer-salons.service';
import { GooglePlacesProvider } from './google-places.provider';

const uuid = (n: number, p = 'b2800000') => `${p}-0000-4000-8000-${String(n).padStart(12, '0')}`;
let pg: any; let svc: CustomerSalonsService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);

beforeAll(async () => {
  pg = await migratedPglite();
  svc = new CustomerSalonsService(kyselyFor(pg) as any, new GooglePlacesProvider());
  // 12 listed salons × 10 branches = 120 listed branches; one unlisted salon (no public_listing override → default false)
  for (let t = 1; t <= 13; t++) {
    await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1, $2, $2, $3, $4, 'active')`,
      [uuid(t, 'a2800000'), `Salon ${String(t).padStart(2, '0')}`, `salon-${t}`, `S${String(t).padStart(3, '0')}`]);
    if (t <= 12) await q(`insert into tenant_app_flags (tenant_id, flag_key, enabled) values ($1, 'public_listing', true)`, [uuid(t, 'a2800000')]);
    for (let b = 1; b <= 10; b++) {
      await q(`insert into branches (id, tenant_id, name, status, city, state, zip, latitude, longitude) values ($1, $2, $3, 'active', $4, 'NJ', $5, $6, $7)`,
        [uuid(t * 100 + b), uuid(t, 'a2800000'), `Branch ${String(b).padStart(2, '0')}`, b <= 5 ? 'Cherry Hill' : 'Voorhees', b <= 5 ? '08002' : '08043', 39.9 + b * 0.01, -75.0 - b * 0.01]);
    }
  }
}, 180000);

describe('B-28: the salon browse is paged and filtered in SQL', () => {
  it('no location: the first page is 50 of the 120 listed branches, ordered by salon then branch, with a cursor; the unlisted salon never appears', async () => {
    const p1: any = await svc.nearby({});
    expect(p1.results).toHaveLength(50);
    expect(p1.nextCursor).toEqual(expect.any(String));
    expect(p1.results[0].name).toMatch(/^Salon 01/); expect(p1.results[49].name).toMatch(/^Salon 05/);
    expect(p1.results.some((r: any) => /Salon 13/.test(r.name))).toBe(false);
  });
  it('the cursor walks every page exactly once and ends with nextCursor null', async () => {
    const seen = new Set<string>(); let cursor: string | null = null; let pages = 0;
    do { const p: any = await svc.nearby({ cursor: cursor ?? undefined, limit: 50 }); pages++; for (const r of p.results) { expect(seen.has(r.salon_id)).toBe(false); seen.add(r.salon_id); } cursor = p.nextCursor; } while (cursor);
    expect(pages).toBe(3); expect(seen.size).toBe(120);
  });
  it('limit is honoured and capped at 100; a malformed cursor is refused', async () => {
    expect(((await svc.nearby({ limit: 7 })) as any).results).toHaveLength(7);
    expect(((await svc.nearby({ limit: 500 })) as any).results).toHaveLength(100);
    await expect(svc.nearby({ cursor: 'not-a-cursor' })).rejects.toMatchObject({ code: 'invalid' });
  });
  it('city / zip / text filters are applied in SQL before the page (not to the page)', async () => {
    const city: any = await svc.nearby({ city: 'voorhees', limit: 100 });
    expect(city.results).toHaveLength(60); expect(city.results.every((r: any) => r.city === 'Voorhees')).toBe(true);
    const zip: any = await svc.nearby({ zip: '08002', limit: 10 });
    expect(zip.results).toHaveLength(10); expect(zip.nextCursor).toEqual(expect.any(String));
    const text: any = await svc.nearby({ searchText: 'salon 12', limit: 100 });
    expect(text.results).toHaveLength(10); expect(text.results.every((r: any) => /Salon 12/.test(r.name))).toBe(true);
    expect(((await svc.nearby({ searchText: 'zzz-nothing' })) as any).results).toEqual([]);
  });
  it('a located search is bounded by its radius box in SQL and sorted by distance (no page: the radius is the bound)', async () => {
    const near: any = await svc.nearby({ lat: 39.91, lng: -75.01, radiusMiles: 1 });   // Branch 01 (0 mi) and 02 (0.87 mi) of each salon; 03 is 1.7 mi out
    expect(near.results.length).toBe(24);
    expect(near.results.every((r: any) => /Branch 0[12]/.test(r.name) && r.distance_miles <= 1)).toBe(true);
    expect(near.results.slice(0, 12).every((r: any) => /Branch 01/.test(r.name))).toBe(true);   // distance order
    expect(near.nextCursor).toBeNull();
  });
});
