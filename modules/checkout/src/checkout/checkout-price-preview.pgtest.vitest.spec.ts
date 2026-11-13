// checkout-price-preview.pgtest — SERVICE PRICING 08, Live Price Preview, on the REAL schema: a service + add-ons for a walk-in,
// priced by the deals engine (a service-scoped automatic deal applies; a code-only coupon and a new-customer-only deal do not),
// taxed on the taxable lines at the salon's rate, at the catalog price or a proposed one; nothing is reserved or written.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyDealsRepository, DealsService, DealsCheckoutService } from '@aipowersalon/deals';
import { CheckoutPricePreview, PricePreviewError } from './checkout-price-preview';

const id = (n: number) => `86200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B = id(2), X = id(3), BX = id(4), OWNER = id(10), CAT = id(20), GEL = id(21), PED = id(22), GELX = id(23);
const ctx = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.services.view', 'pos.marketing.manage', 'pos.marketing.view'] };
let pg: any; let db: any; let pp: CheckoutPricePreview; let deals: DealsService;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e: any) { return e instanceof PricePreviewError ? `${e.status}:${e.code}` : String(e?.message); } }
async function live(input: Record<string, unknown>) {
  const v = await deals.createDeal(ctx as any, { ownerType: 'salon', discountType: 'percent', ...input } as any);
  await deals.submit(ctx as any, v.id); await deals.approve(ctx as any, v.id);
  return deals.publish(ctx as any, v.id);
}

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  const repo = new KyselyDealsRepository(db);
  deals = new DealsService(repo);
  pp = new CheckoutPricePreview(db, new DealsCheckoutService(deals, repo.ledger));
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Pilot','pp-862','PP862','active'), ($2,'X','Other','pp-862x','PP862X','active')`, [T, X]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'Main','America/New_York'), ($3,$4,'Other','America/New_York')`, [B, T, BX, X]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, is_taxable) values
    ($1,$2,$3,$4,'Gel manicure',45,5000,true), ($5,$2,$3,$4,'Medical pedicure',60,6000,false)`, [GEL, T, B, CAT, PED]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails X')`, [id(24), X, BX]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Gel X',45,5000)`, [GELX, X, BX, id(24)]);
  await q(`insert into service_add_ons (tenant_id, branch_id, service_id, add_on_key, name, price_cents, duration_delta_minutes, is_taxable, is_active, sort_order) values
    ($1,$2,$3,'french','French tips',1000,10,true,true,1), ($1,$2,$3,'paraffin','Paraffin (not taxed)',800,10,false,true,2), ($1,$2,$3,'old','Retired add-on',500,5,true,false,3)`, [T, B, GEL]);
  await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, null, 'tax', '{"enabled": true, "taxRatePercent": 8}'::jsonb)`, [T]);
  // a 10% automatic deal on Gel only; a 50% coupon that needs a code; a 30% deal for new customers only
  await live({ kind: 'deal', title: 'Gel week 10%', discountPercent: 10, serviceIds: [GEL] });
  await live({ kind: 'coupon', title: 'Secret 50%', discountPercent: 50, code: 'SECRET50', serviceIds: [] });
  await live({ kind: 'deal', title: 'Newcomer 30%', discountPercent: 30, serviceIds: [], newCustomersOnly: true });
}, 240_000);

describe('SERVICE PRICING 08 — Live Price Preview', () => {
  it('service + add-ons for a walk-in: the engine\'s deal on the service line, tax on taxable lines only, the total due; code-only and customer-only offers are not applied', async () => {
    const before = await q(`select (select count(*) from deal_redemptions)::int r, (select count(*) from audit_logs)::int a`);
    const r = await pp.preview(ctx, { serviceId: GEL, addOns: 'french,paraffin' });
    expect(r.service).toEqual({ id: GEL, name: 'Gel manicure', catalogPriceCents: 5000, previewPriceCents: 5000 });
    expect(r.lines).toEqual([
      { kind: 'service', key: null, name: 'Gel manicure', priceCents: 5000, taxable: true, discountCents: 500, netCents: 4500 },
      { kind: 'add_on', key: 'french', name: 'French tips', priceCents: 1000, taxable: true, discountCents: 0, netCents: 1000 },
      { kind: 'add_on', key: 'paraffin', name: 'Paraffin (not taxed)', priceCents: 800, taxable: false, discountCents: 0, netCents: 800 }]);
    expect(r.discounts.applied).toEqual([{ dealId: expect.any(String), title: 'Gel week 10%', appliedCents: 500 }]);
    expect(r.discounts.totalCents).toBe(500);
    expect(r.discounts.notForWalkIn.map((x) => x.title)).toContain('Newcomer 30%');
    expect(r.discounts.applied.some((x) => x.title === 'Secret 50%')).toBe(false);              // never without its code
    // gross 6800 − 500 = 6300 subtotal; taxable share = 6300 × 6000/6800 = 5559 → 8 % = 445 (Checkout's own taxableSubtotal + computeTotals)
    expect(r.totals).toEqual({ grossCents: 6800, subtotalCents: 6300, totalDueCents: 6300 + r.tax.taxCents, cardSurcharge: 'off' });
    expect(r.tax).toEqual({ ratePercent: 8, taxableCents: 5559, taxCents: 445 });
    expect(r.addOnsAvailable.map((a) => a.key)).toEqual(['french', 'paraffin']);                 // the inactive add-on is not offered
    expect(r.chargesAnyone).toBe(false);
    expect(await q(`select (select count(*) from deal_redemptions)::int r, (select count(*) from audit_logs)::int a`)).toEqual(before);
  });
  it('a proposed price is previewed before saving; a not-taxable service carries no tax; refusals are coded', async () => {
    const r = await pp.preview(ctx, { serviceId: GEL, priceCents: '6000' });
    expect(r.service).toMatchObject({ catalogPriceCents: 5000, previewPriceCents: 6000 });
    expect(r.totals).toMatchObject({ grossCents: 6000, subtotalCents: 5400 });                 // 10 % deal on the new price
    expect(r.tax.taxCents).toBe(432);
    const p = await pp.preview(ctx, { serviceId: PED });
    expect(p.tax).toEqual({ ratePercent: 8, taxableCents: 0, taxCents: 0 });
    expect(p.discounts.totalCents).toBe(0);                                                     // the Gel deal does not cover a pedicure
    expect(await code(pp.preview(ctx, { serviceId: GELX }))).toBe('404:SERVICE_NOT_FOUND');    // another salon's service
    expect(await code(pp.preview(ctx, { serviceId: 'x' }))).toBe('404:SERVICE_NOT_FOUND');
    expect(await code(pp.preview(ctx, { serviceId: GEL, priceCents: '-1' }))).toBe('400:PRICE_INVALID');
    expect(await code(pp.preview(ctx, { serviceId: GEL, addOns: 'old' }))).toBe('400:VALIDATION_FAILED');   // inactive add-on
    expect(await code(pp.preview(ctx, { serviceId: GEL, addOns: 'nope' }))).toBe('400:VALIDATION_FAILED');
  });
  it('without the deals engine the preview says discounts are unavailable — never "no discount"', async () => {
    const r = await new CheckoutPricePreview(db, null).preview(ctx, { serviceId: GEL });
    expect(r.discounts).toEqual({ available: false, policy: null, totalCents: 0, applied: [], notForWalkIn: [] });
    expect(r.totals.subtotalCents).toBe(5000);
  });
});
