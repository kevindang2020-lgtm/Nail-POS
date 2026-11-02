// deals.pgtest.vitest.spec.ts — the deal lifecycle + backend policy enforcement against the real schema (migration 387).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite } from '@aipowersalon/testing';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyDealsRepository } from './deals.kysely.repository';
import { DealsService } from './deals.service';

class PgliteDriver {
  constructor(private pg: any) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return { async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; }, streamQuery() { throw new Error('no'); } } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const T = 'de000000-0000-0000-0000-000000000001';
const mgr: any = { tenantId: T, branchId: '', userId: 'de000000-0000-0000-0000-0000000000f1', role: 'OWNER', permissions: [] };
const TECH = 'de000000-0000-0000-0000-0000000000e1';
const techCtx: any = { tenantId: T, branchId: '', userId: 'de000000-0000-0000-0000-0000000000f2', role: 'TECH', permissions: [], technicianId: TECH };
const CAT = 'de000000-0000-0000-0000-0000000000a0';
const SVC = 'de000000-0000-0000-0000-0000000000a1';    // the catalog: $49 — BUILD_PLAN Phase 5, bug 8: prices come from here
const SVC50 = 'de000000-0000-0000-0000-0000000000a2';  // $50

let svc: DealsService;
let pg: any;
const BNEAR = 'de000000-0000-0000-0000-0000000000b7';
const BFAR = 'de000000-0000-0000-0000-0000000000b8';
const q = (sqlText: string, p: any[] = []) => pg.query(sqlText, p).then((r: any) => r.rows);
const salonDeal = { ownerType: 'salon' as const, title: 'Spring Mani', discountType: 'percent' as const, discountPercent: 20, serviceIds: [SVC] };
const facts = { channel: 'customer_app' as const, serviceIds: [SVC] };

beforeAll(async () => {
  pg = await migratedPglite();
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  await pg.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'L','D','slug','CODE','active')`, [T]);
  // Two branches with coordinates + one active deal each, for the nearby feed (NYC vs LA).
  await pg.query(`insert into branches (id, tenant_id, name, latitude, longitude, address, status) values ($1,$2,'NYC Nails',40.7128,-74.006,'1 Main St','active')`, [BNEAR, T]);
  await pg.query(`insert into branches (id, tenant_id, name, latitude, longitude, address, status) values ($1,$2,'LA Nails',34.05,-118.24,'2 Palm Ave','active')`, [BFAR, T]);
  await pg.query(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, T, BNEAR]);
  await pg.query(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Mani',45,4900), ($5,$2,$3,$4,'Gel',45,5000)`, [SVC, T, BNEAR, CAT, SVC50]);
  await pg.query(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Lisa','R','Lisa R')`, [TECH, T, BNEAR]);
  await pg.query(`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values ($1,$2,$3,$4)`, [T, BNEAR, TECH, SVC50]);   // Lisa does Gel, not Mani
  svc = new DealsService(new KyselyDealsRepository(db as any));
  await pg.query(`insert into deals (tenant_id, branch_id, owner_type, title, discount_type, discount_percent, original_price_cents, final_price_cents, status) values ($1,$2,'salon','NYC Mani','percent',20,5000,4000,'active')`, [T, BNEAR]);
  await pg.query(`insert into deals (tenant_id, branch_id, owner_type, title, discount_type, discount_percent, original_price_cents, final_price_cents, status) values ($1,$2,'salon','LA Mani','percent',30,5000,3500,'active')`, [T, BFAR]);
});

describe('salon deal lifecycle', () => {
  let id: string;
  it('create → draft, with a backend-computed final price (never trusts the client)', async () => {
    const d = await svc.createDeal(mgr, salonDeal);
    id = d.id;
    expect(d.status).toBe('draft');
    expect(d.originalPriceCents).toBe(4900);  // the catalog price (Phase 5, bug 8)
    expect(d.finalPriceCents).toBe(3920);   // 4900 * 0.8, computed server-side
    expect(d.savingsCents).toBe(980);
    expect(d.ownerType).toBe('salon');
  });
  it('submit → pending_approval; approve → approved (+ approval recorded)', async () => {
    expect((await svc.submit(mgr, id)).status).toBe('pending_approval');
    expect((await svc.approve(mgr, id, 'looks good')).status).toBe('approved');
  });
  it('publish → active; pause → paused; resume → active', async () => {
    expect((await svc.publish(mgr, id)).status).toBe('active');
    expect((await svc.pause(mgr, id)).status).toBe('paused');
    expect((await svc.resume(mgr, id)).status).toBe('active');
  });
  it('an illegal transition (approve a draft) is a conflict, not a silent mutation', async () => {
    const draft = await svc.createDeal(mgr, { ...salonDeal, title: 'Draft2' });
    await expect(svc.approve(mgr, draft.id)).rejects.toMatchObject({ name: 'DealConflictError' });
  });
  it('reject requires a reason and records it', async () => {
    const d = await svc.createDeal(mgr, { ...salonDeal, title: 'ToReject' });
    await svc.submit(mgr, d.id);
    await expect(svc.reject(mgr, d.id)).rejects.toMatchObject({ name: 'DealValidationError' });
    expect((await svc.reject(mgr, d.id, 'off-brand')).status).toBe('rejected');
  });
});

describe('technician deals — backend policy enforcement', () => {
  const techDeal = { ownerType: 'technician' as const, technicianId: TECH, title: 'Lisa Gel Deal', discountType: 'percent' as const, discountPercent: 15, serviceIds: [SVC50] };

  it('blocked when the salon setting is OFF (default)', async () => {
    await expect(svc.createDeal(techCtx, techDeal)).rejects.toMatchObject({ name: 'DealValidationError' });
  });
  it('with on_with_approval → creates as pending_approval', async () => {
    await svc.updateSettings(mgr, { allowTechnicianDeals: 'on_with_approval', maxDiscountPercent: 30 });
    const d = await svc.createDeal(techCtx, techDeal);
    expect(d.status).toBe('pending_approval');
    expect(d.ownerType).toBe('technician');
    expect(d.technicianId).toBe(TECH);
  });
  it('discount over the salon cap is rejected', async () => {
    await svc.updateSettings(mgr, { allowTechnicianDeals: 'on_with_approval', maxDiscountPercent: 10 });
    await expect(svc.createDeal(techCtx, { ...techDeal, discountPercent: 25, title: 'TooBig' })).rejects.toMatchObject({ name: 'DealValidationError' });
  });
  it('a technician cannot create a deal for another technician', async () => {
    await svc.updateSettings(mgr, { allowTechnicianDeals: 'on_with_approval', maxDiscountPercent: 30 });
    await expect(svc.createDeal(techCtx, { ...techDeal, technicianId: 'de000000-0000-0000-0000-0000000000e9', title: 'NotMine' })).rejects.toMatchObject({ name: 'DealForbiddenError' });
  });
  it('settings round-trip (get returns what was set)', async () => {
    await svc.updateSettings(mgr, { allowTechnicianDeals: 'on_auto', maxDiscountPercent: 25, minServicePriceCents: 3000 });
    const s = await svc.getSettings(mgr);
    expect(s.allowTechnicianDeals).toBe('on_auto');
    expect(s.maxDiscountPercent).toBe(25);
    expect(s.minServicePriceCents).toBe(3000);
  });
});

describe('technician "My Deals" — self-service via tech methods', () => {
  const techDeal = { title: 'Lisa Weekend', discountType: 'percent' as const, discountPercent: 15, serviceIds: [SVC50] };

  it('techGetSettings exposes the policy so the app can show an honest enabled/disabled state', async () => {
    await svc.updateSettings(mgr, { allowTechnicianDeals: 'off' });
    expect((await svc.techGetSettings(techCtx)).allowTechnicianDeals).toBe('off');
  });
  it('techCreateDeal is blocked when the salon has technician deals OFF', async () => {
    await svc.updateSettings(mgr, { allowTechnicianDeals: 'off' });
    await expect(svc.techCreateDeal(techCtx, techDeal as any)).rejects.toMatchObject({ name: 'DealValidationError' });
  });
  it('techCreateDeal creates a pending, technician-owned deal when allowed; techListMyDeals returns only mine', async () => {
    await svc.updateSettings(mgr, { allowTechnicianDeals: 'on_with_approval', maxDiscountPercent: 30 });
    const d = await svc.techCreateDeal(techCtx, techDeal as any);
    expect(d.status).toBe('pending_approval');
    expect(d.ownerType).toBe('technician');
    expect(d.technicianId).toBe(TECH);
    const mine = await svc.techListMyDeals(techCtx);
    expect(mine.every((x) => x.technicianId === TECH)).toBe(true);
    expect(mine.find((x) => x.id === d.id)).toBeTruthy();
  });
  it('Phase 5 (bug 8): the technician picks from THEIR services at catalog price; a typed-in price is ignored', async () => {
    await svc.updateSettings(mgr, { allowTechnicianDeals: 'on_with_approval', maxDiscountPercent: 30 });
    expect(await svc.techServices(techCtx)).toEqual([{ id: SVC50, name: 'Gel', priceCents: 5000 }]);
    const d = await svc.techCreateDeal(techCtx, { ...techDeal, title: 'Typed price', originalPriceCents: 99999 } as any);
    expect(d.originalPriceCents).toBe(5000);
    expect(d.finalPriceCents).toBe(4250);
    await expect(svc.techCreateDeal(techCtx, { ...techDeal, serviceIds: [SVC] } as any)).rejects.toThrow('services you perform');
    await expect(svc.techCreateDeal(techCtx, { ...techDeal, serviceIds: [] } as any)).rejects.toThrow('Pick at least one');
  });
  it('Phase 5: switched off by the platform reads as "off" in the technician app', async () => {
    await svc.updateSettings(mgr, { allowTechnicianDeals: 'on_auto' });
    await pg.query(`update deal_settings set platform_disabled = true, platform_disabled_reason = 'review' where tenant_id = $1`, [T]);
    try { expect((await svc.techGetSettings(techCtx)).allowTechnicianDeals).toBe('off'); }
    finally { await pg.query(`update deal_settings set platform_disabled = false, platform_disabled_reason = null where tenant_id = $1`, [T]); }
    expect((await svc.techGetSettings(techCtx)).allowTechnicianDeals).toBe('on_auto');
  });
  it('Phase 5 owner app: the summary carries the approval queue, the dashboard and whether deals run at all', async () => {
    await svc.updateSettings(mgr, { allowTechnicianDeals: 'on_with_approval', maxDiscountPercent: 30 });
    const d = await svc.techCreateDeal(techCtx, { ...techDeal, title: 'Owner queue' } as any);
    const s1 = await svc.ownerSummary(mgr);
    expect(s1.pending.map((x) => x.id)).toContain(d.id);
    expect(s1.switches).toMatchObject({ running: true, allowTechnicianDeals: 'on_with_approval' });
    expect(s1.dashboard).toHaveProperty('totals');
    await svc.reject(mgr, d.id, 'Too deep a discount for gel');
    expect((await svc.ownerSummary(mgr)).pending.map((x) => x.id)).not.toContain(d.id);
    await pg.query(`update deal_settings set platform_disabled = true, platform_disabled_reason = 'Under review' where tenant_id = $1`, [T]);
    try { expect((await svc.ownerSummary(mgr)).switches).toMatchObject({ running: false, reason: 'Under review' }); }
    finally { await pg.query(`update deal_settings set platform_disabled = false, platform_disabled_reason = null where tenant_id = $1`, [T]); }
  });
  it('a technician cannot submit/act on a deal that is not theirs', async () => {
    const other = await svc.createDeal(mgr, { ownerType: 'salon', title: 'SalonOnly', discountType: 'percent', discountPercent: 10, serviceIds: [SVC] });
    await expect(svc.techSubmit(techCtx, other.id)).rejects.toMatchObject({ name: 'DealForbiddenError' });
  });
});

describe('customer nearby feed (public, cross-tenant)', () => {
  it('returns active deals near the origin, nearest-first, and filters out far ones by radius', async () => {
    const feed = await svc.nearbyDeals({ lat: 40.7128, lng: -74.006, radiusMiles: 25, sort: 'nearest' });
    const titles = feed.map((c) => c.title);
    expect(titles).toContain('NYC Mani');
    expect(titles).not.toContain('LA Mani'); // ~2400mi away, outside 25mi
    expect(feed[0].distanceMiles).not.toBeNull();
    expect(feed.find((c) => c.title === 'NYC Mani')?.savingsCents).toBe(1000);
  });
  it('no origin → both returned with null distance (ZIP/city or location-denied fallback)', async () => {
    const feed = await svc.nearbyDeals({});
    const titles = feed.map((c) => c.title);
    expect(titles).toContain('NYC Mani');
    expect(titles).toContain('LA Mani');
    expect(feed.every((c) => c.distanceMiles === null)).toBe(true);
  });
  it('a draft/non-active deal never appears in the public feed', async () => {
    await q(`insert into deals (tenant_id, branch_id, owner_type, title, discount_type, discount_percent, original_price_cents, final_price_cents, status) values ($1,$2,'salon','Hidden Draft','percent',50,5000,2500,'draft')`, [T, BNEAR]);
    const feed = await svc.nearbyDeals({ lat: 40.7128, lng: -74.006, radiusMiles: 25 });
    expect(feed.map((c) => c.title)).not.toContain('Hidden Draft');
  });
  it('Phase 5: a deal with every place taken, or its budget spent, is not advertised (feed, salon list, phone)', async () => {
    const full = (await q(`insert into deals (tenant_id, branch_id, owner_type, title, discount_type, discount_percent, original_price_cents, final_price_cents, status, max_redemptions) values ($1,$2,'salon','Full Mani','percent',10,5000,4500,'active',1) returning id`, [T, BNEAR]))[0].id;
    const spent = (await q(`insert into deals (tenant_id, branch_id, owner_type, title, discount_type, discount_percent, original_price_cents, final_price_cents, status, budget_cents, budget_reserved_cents) values ($1,$2,'salon','Spent Mani','percent',10,5000,4500,'active',1000,1000) returning id`, [T, BNEAR]))[0].id;
    const titles = async () => (await svc.nearbyDeals({ lat: 40.7128, lng: -74.006, radiusMiles: 25 })).map((c) => c.title);
    expect(await titles()).toContain('Full Mani');
    await q(`insert into deal_redemption_holds (deal_id, tenant_id, customer_id, idempotency_key, status, expires_at) values ($1,$2,null,'k-full','consumed', now())`, [full, T]);
    expect(await titles()).not.toContain('Full Mani');
    expect(await titles()).not.toContain('Spent Mani');
    const salon = (await svc.salonDealsForCustomers({ ...mgr, branchId: BNEAR }, 'customer_app')).map((d) => d.title);
    expect(salon).not.toContain('Full Mani'); expect(salon).not.toContain('Spent Mani'); expect(salon).toContain('NYC Mani');
    await q(`update deals set status = 'canceled' where id in ($1, $2)`, [full, spent]);
  });
  it('publicDeal returns detail for an active deal and null for a non-existent one', async () => {
    const rows = await q(`select id from deals where title='NYC Mani' limit 1`);
    const detail = await svc.publicDeal(String(rows[0].id));
    expect(detail?.title).toBe('NYC Mani');
    expect(detail?.salonName).toBeTruthy();
    expect(await svc.publicDeal('de000000-0000-0000-0000-0000000000ff')).toBeNull();
  });
});

describe('book-a-deal reservation — oversell-safe + idempotent', () => {
  const CUST = 'de000000-0000-0000-0000-0000000000c1';
  const CUST2 = 'de000000-0000-0000-0000-0000000000c3';
  const CUST3 = 'de000000-0000-0000-0000-0000000000c4';
  let dealId: string;
  beforeAll(async () => {
    const r = await q(`insert into deals (tenant_id, branch_id, owner_type, title, discount_type, discount_percent, original_price_cents, final_price_cents, status, max_redemptions) values ($1,$2,'salon','Capped Deal','percent',20,5000,4000,'active',2) returning id`, [T, BNEAR]);
    dealId = String(r[0].id);
  });

  it('reserves up to the cap, then reports sold out', async () => {
    const a = await svc.reserveDeal(mgr, dealId, CUST, 'key-a', facts);
    const b = await svc.reserveDeal(mgr, dealId, CUST2, 'key-b', facts);
    expect(a.soldOut).toBe(false); expect(b.soldOut).toBe(false);
    const c = await svc.reserveDeal(mgr, dealId, CUST3, 'key-c', facts); // cap is 2
    expect(c.soldOut).toBe(true);
  });
  it('is idempotent — the same key returns the same hold without consuming more capacity', async () => {
    const first = await svc.reserveDeal(mgr, dealId, CUST, 'key-a', facts);
    expect(first.soldOut).toBe(false);
    expect(first.alreadyHeld).toBe(true);
  });
  it('releasing a hold frees capacity for a new reservation', async () => {
    const held = await q(`select id from deal_redemption_holds where deal_id=$1 and status='held' limit 1`, [dealId]);
    const rel = await svc.releaseReservation(mgr, String(held[0].id));
    expect(rel.released).toBe(true);
    const d = await svc.reserveDeal(mgr, dealId, CUST3, 'key-d', facts);
    expect(d.soldOut).toBe(false); // capacity freed
  });
  it('consuming a hold links it to the appointment (for checkout)', async () => {
    const held = await q(`select id from deal_redemption_holds where deal_id=$1 and status='held' limit 1`, [dealId]);
    const appt = 'de000000-0000-0000-0000-0000000000ab';
    const res = await svc.consumeReservation(mgr, String(held[0].id), appt);
    expect(res.consumed).toBe(true);
    const row = await q(`select status, appointment_id from deal_redemption_holds where id=$1`, [String(held[0].id)]);
    expect(String(row[0].status)).toBe('consumed');
    expect(String(row[0].appointment_id)).toBe(appt);
  });
});

describe('checkout — a booked deal is APPLIED at checkout, REDEEMED at payment (BUILD_PLAN Phase 5, bug 4)', () => {
  const CUST = 'de000000-0000-0000-0000-0000000000c2';
  const APPT = 'de000000-0000-0000-0000-0000000000d1';
  const APPT2 = 'de000000-0000-0000-0000-0000000000d2';
  const TICKET = 'de000000-0000-0000-0000-0000000000e7';
  let dealId: string;
  beforeAll(async () => {
    const r = await q(`insert into deals (tenant_id, branch_id, owner_type, title, discount_type, discount_percent, original_price_cents, final_price_cents, status, stackable) values ($1,$2,'salon','Checkout Deal','percent',20,5000,4000,'active',false) returning id`, [T, BNEAR]);
    dealId = String(r[0].id);
    // Reserve + consume against APPT (simulates a successful book-a-deal), and a second consumed hold for the release test.
    const h1 = await svc.reserveDeal(mgr, dealId, CUST, 'ck-1', facts); await svc.consumeReservation(mgr, (h1 as any).holdId, APPT);
    const h2 = await svc.reserveDeal(mgr, dealId, CUST, 'ck-2', facts); await svc.consumeReservation(mgr, (h2 as any).holdId, APPT2);
  });

  it('applies the locked discount to the subtotal, records an APPLIED application — the count does not move until payment', async () => {
    const res = await svc.redeemDealAtCheckout(mgr, APPT, 5000, { customerId: CUST, branchId: BNEAR, ticketId: TICKET });
    expect(res.applied).toBe(true);
    expect(res.discountCents).toBe(1000); // 20% of 5000
    expect(Number((await q(`select redemption_count from deals where id=$1`, [dealId]))[0].redemption_count)).toBe(0);
    const red = await q(`select amount_discounted_cents, status from deal_redemptions where ticket_id=$1 and deal_id=$2`, [TICKET, dealId]);
    expect(red).toEqual([{ amount_discounted_cents: '1000', status: 'applied' }].map((x) => ({ ...x, amount_discounted_cents: expect.anything() })));
    expect(Number(red[0].amount_discounted_cents)).toBe(1000);
  });
  it('is idempotent — replaying checkout is still one application', async () => {
    const res = await svc.redeemDealAtCheckout(mgr, APPT, 5000, { customerId: CUST, branchId: BNEAR, ticketId: TICKET });
    expect(res.applied).toBe(true);
    expect((await q(`select count(*)::int c from deal_redemptions where ticket_id=$1`, [TICKET]))[0].c).toBe(1);
  });
  it('paying the ticket redeems it (count +1); paying again changes nothing', async () => {
    await (svc as any).ledger.markTicketPaid(T, TICKET);
    await (svc as any).ledger.markTicketPaid(T, TICKET);
    expect(Number((await q(`select redemption_count from deals where id=$1`, [dealId]))[0].redemption_count)).toBe(1);
    expect((await q(`select status from deal_redemptions where ticket_id=$1`, [TICKET]))[0].status).toBe('redeemed');
  });
  it('returns applied:false (no throw) when the appointment has no deal', async () => {
    const res = await svc.redeemDealAtCheckout(mgr, 'de000000-0000-0000-0000-0000000000ee', 5000, { customerId: CUST });
    expect(res.applied).toBe(false);
  });

  it('does not apply a suspended/frozen technician\'s deal — even one reserved before the freeze', async () => {
    const GP = 'de000000-0000-0000-0000-0000000000e5';
    const TF = 'de000000-0000-0000-0000-0000000000e6';
    const APPT3 = 'de000000-0000-0000-0000-0000000000d3';
    await q(`insert into global_tech_profiles (id, tech_code, public_slug, display_name) values ($1,'RDF','rdf-slug','Redeem Frozen')`, [GP]);
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, global_tech_profile_id) values ($1,$2,$3,'Red','Frz','Red Frz',$4)`, [TF, T, BNEAR, GP]);
    const dr = await q(`insert into deals (tenant_id, branch_id, owner_type, technician_id, title, discount_type, discount_percent, original_price_cents, final_price_cents, status, stackable) values ($1,$2,'technician',$3,'Tech Frozen Deal','percent',20,5000,4000,'active',false) returning id`, [T, BNEAR, TF]);
    const tdeal = String(dr[0].id);
    const h = await svc.reserveDeal(mgr, tdeal, CUST, 'ck-frz', facts); await svc.consumeReservation(mgr, (h as any).holdId, APPT3);

    // reserved while active, but the tech is frozen before checkout → the discount is refused (non-fatal)
    await q(`update global_tech_profiles set admin_deals_frozen=true where id=$1`, [GP]);
    const res = await svc.redeemDealAtCheckout(mgr, APPT3, 5000, { customerId: CUST, ticketId: 'de000000-0000-0000-0000-0000000000e8' });
    expect(res.applied).toBe(false);
    expect(res.reason).toMatch(/frozen/i);
  });
  it('release frees a booked-but-unused place; a place already used on a ticket cannot be released', async () => {
    const rel2 = await svc.releaseDealForAppointment(mgr, APPT2); // never used
    expect(rel2.released).toBe(true);
    const rel1 = await svc.releaseDealForAppointment(mgr, APPT); // used (redeemed) on TICKET
    expect(rel1.released).toBe(false);
  });
});

describe('analytics + Super Admin oversight', () => {
  it('records view events and aggregates per-deal analytics for the tenant', async () => {
    const nyc = String((await q(`select id from deals where title='NYC Mani' limit 1`))[0].id);
    await svc.publicDeal(nyc); await svc.publicDeal(nyc); // two views (best-effort events)
    const rows = await svc.getAnalytics(mgr);
    const row = rows.find((r) => r.dealId === nyc);
    expect(row).toBeTruthy();
    expect(row!.views).toBeGreaterThanOrEqual(2);
  });
  it('reflects redemptions + discounted revenue in analytics', async () => {
    const rows = await svc.getAnalytics(mgr);
    const redeemed = rows.find((r) => r.title === 'Checkout Deal');
    expect(redeemed!.redemptions).toBeGreaterThanOrEqual(1);
    expect(redeemed!.discountedCents).toBeGreaterThanOrEqual(1000);
  });
  it('marketplaceOverview totals deals and redemptions across tenants', async () => {
    const o = await svc.marketplaceOverview();
    expect(o.totalDeals).toBeGreaterThan(0);
    expect(o.totalRedemptions).toBeGreaterThanOrEqual(1);
    expect(o.totalDiscountedCents).toBeGreaterThanOrEqual(1000);
    expect(o.tenantsWithDeals).toBeGreaterThanOrEqual(1);
  });
  it('Super Admin can force-suspend a live deal', async () => {
    const nyc = String((await q(`select id from deals where title='NYC Mani' and status='active' limit 1`))[0].id);
    await expect(svc.superSuspendDeal(nyc)).rejects.toMatchObject({ name: 'DealValidationError' });   // Phase 5, bug 17: a reason is required
    const res = await svc.superSuspendDeal(nyc, 'Misleading before/after price', { userId: 'sa' });
    expect(res.suspended).toBe(true);
    expect(String((await q(`select status from deals where id=$1`, [nyc]))[0].status)).toBe('canceled');
    expect((await q(`select count(*)::int c from audit_logs where entity_id=$1 and action_type='deal_suspended_by_platform'`, [nyc]))[0].c).toBe(1);
    await expect(svc.superSuspendDeal(nyc, 'Misleading before/after price', { userId: 'sa' })).rejects.toMatchObject({ name: 'DealConflictError' });   // already suspended
  });
});

describe('deal notifications — technician alerted on approve/reject', () => {
  it('approving a technician deal writes a technician_notifications row', async () => {
    await svc.updateSettings(mgr, { allowTechnicianDeals: 'on_with_approval', maxDiscountPercent: 30 });
    const d = await svc.techCreateDeal(techCtx, { title: 'Notify Approve', discountType: 'percent', discountPercent: 15, serviceIds: [SVC50] } as any);
    await svc.approve(mgr, d.id);
    const notes = await q(`select title from technician_notifications where technician_id=$1 and type='deal' and title='Deal approved'`, [TECH]);
    expect(notes.length).toBeGreaterThanOrEqual(1);
  });
  it('rejecting a technician deal writes a technician_notifications row', async () => {
    const d = await svc.techCreateDeal(techCtx, { title: 'Notify Reject', discountType: 'percent', discountPercent: 15, serviceIds: [SVC50] } as any);
    await svc.reject(mgr, d.id, 'Discount too steep');
    const notes = await q(`select title from technician_notifications where technician_id=$1 and type='deal' and title='Deal needs changes'`, [TECH]);
    expect(notes.length).toBeGreaterThanOrEqual(1);
  });
});

describe('user-scoped saves — shopper personal list, cross-tenant', () => {
  const USER = 'de000000-0000-0000-0000-0000000000a9';
  let dealId: string;
  beforeAll(async () => {
    const r = await q(`insert into deals (tenant_id, branch_id, owner_type, title, discount_type, discount_percent, original_price_cents, final_price_cents, status) values ($1,$2,'salon','Savable Deal','percent',20,5000,4000,'active') returning id`, [T, BNEAR]);
    dealId = String(r[0].id);
  });

  it('saves a deal keyed by user_id (no customers row needed) and lists it', async () => {
    const res = await svc.saveDeal(USER, dealId);
    expect(res.saved).toBe(true);
    expect((await q(`select count(*)::int c from deal_saves where deal_id=$1 and user_id=$2`, [dealId, USER]))[0].c).toBe(1);
    const list = await svc.listSavedDeals(USER);
    expect(list.find((c) => c.id === dealId)).toBeTruthy();
    // No customers row was created for this user in the deal's tenant.
    const custs = await q(`select count(*)::int c from customers where user_id=$1`, [USER]);
    expect(custs[0].c).toBe(0);
  });
  it('save is idempotent', async () => {
    await svc.saveDeal(USER, dealId);
    const c = await q(`select count(*)::int c from deal_saves where deal_id=$1 and user_id=$2`, [dealId, USER]);
    expect(c[0].c).toBe(1);
  });
  it('unsave removes it from the list', async () => {
    const res = await svc.unsaveDeal(USER, dealId);
    expect(res.removed).toBe(true);
    const list = await svc.listSavedDeals(USER);
    expect(list.find((c) => c.id === dealId)).toBeFalsy();
  });
  it('a guest (no user) cannot save', async () => {
    await expect(svc.saveDeal('', dealId)).rejects.toMatchObject({ name: 'DealForbiddenError' });
  });
});

describe('checkout auto-resolve — ticket → queue item → appointment', () => {
  it('resolves the appointment a POS ticket came from (so checkout can auto-find its deal)', async () => {
    const APPT = 'de000000-0000-0000-0000-0000000000f1';
    const QID = 'de000000-0000-0000-0000-0000000000f2';
    const TID = 'de000000-0000-0000-0000-0000000000f3';
    await q(`insert into pos_queue_items (id, tenant_id, customer_name, appointment_id) values ($1,$2,'Casey',$3)`, [QID, T, APPT]);
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ca','Sey','Casey') on conflict do nothing`, ['de000000-0000-0000-0000-0000000000c9', T, BNEAR]);
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, queue_item_id) values ($1,$2,$3,$4,$5)`, [TID, T, BNEAR, 'de000000-0000-0000-0000-0000000000c9', QID]);
    const mgrCtx = { tenantId: T, branchId: BNEAR, userId: 'u1', role: 'OWNER', permissions: [] };
    expect(await svc.appointmentForTicket(mgrCtx as any, TID)).toBe(APPT);
    expect(await svc.appointmentForTicket(mgrCtx as any, 'de000000-0000-0000-0000-0000000000ff')).toBeNull();
  });

  it('a Super-Admin deal freeze blocks the technician from creating new deals', async () => {
    await svc.updateSettings(mgr, { allowTechnicianDeals: 'on_with_approval', maxDiscountPercent: 30 });
    const GP = 'de000000-0000-0000-0000-0000000000c7';
    const TF = 'de000000-0000-0000-0000-0000000000c8';
    await q(`insert into global_tech_profiles (id, tech_code, public_slug, display_name, admin_deals_frozen) values ($1,'FRZ','frz-slug','Frozen Tech', true)`, [GP]);
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, global_tech_profile_id) values ($1,$2,$4,'Fro','Zen','Fro Zen',$3)`, [TF, T, GP, BNEAR]);
    const frozenCtx: any = { tenantId: T, branchId: '', userId: 'de000000-0000-0000-0000-0000000000f8', role: 'TECH', permissions: [], technicianId: TF };
    await expect(svc.createDeal(frozenCtx, { ownerType: 'technician', technicianId: TF, title: 'Frozen Deal', discountType: 'percent', discountPercent: 10, serviceIds: [SVC50] })).rejects.toMatchObject({ name: 'DealForbiddenError' });
    // lifting the freeze lets them create again
    await q(`update global_tech_profiles set admin_deals_frozen=false where id=$1`, [GP]);
    const d = await svc.createDeal(frozenCtx, { ownerType: 'technician', technicianId: TF, title: 'Thawed Deal', discountType: 'percent', discountPercent: 10, serviceIds: [SVC50] } as any);
    expect(d.title).toBe('Thawed Deal');
  });
});
