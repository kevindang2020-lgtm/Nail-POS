// checkout-price-preview.ts — SERVICE PRICING 08, Live Price Preview (Nov 12 2026).
//
// How one service (at its catalog price, or a price the manager is about to set) with the add-ons she picks would ring up at
// Checkout for a walk-in — built ONLY from the functions Checkout itself uses:
//   • the deals: DealsCheckoutService.previewLines — every live deal that needs no code, judged and priced together by the one
//     engine under the salon's stacking policy (a deal that needs a customer is "not for a walk-in" here);
//   • the tax: taxableSubtotal (a line not taxable is left out; the discount is shared by price) and totalsForMethod with the
//     salon's resolved checkout settings (resolveCheckoutSettings: rate, surcharge switch);
//   • the card surcharge is decided only when the card is read (computeTotals estimates 0 before that) — said, never guessed.
// Nothing is charged, reserved, counted, audited or written.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import type { PricePreviewResponse, PricePreviewLine } from '@aipowersalon/api-contracts/tenant';
import type { DealsCheckoutService } from '@aipowersalon/deals';
import { resolveCheckoutSettings } from './checkout-settings.resolver';
import { taxableSubtotal, totalsForMethod } from './checkout.dto';

export interface PricePreviewCtx { tenantId: string; branchId: string | null; userId?: string | null; role?: string | null; permissions?: string[] }
/** carries its code for the controller (→ HTTP { code, message }) and, through withCode, for the coded-error checks */
export class PricePreviewError extends Error {
  constructor(message: string, readonly code: 'SERVICE_NOT_FOUND' | 'PRICE_INVALID' | 'VALIDATION_FAILED', readonly status: number) { super(message); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const N = (v: unknown) => (v == null ? 0 : Number(v) || 0);
export const PRICE_PREVIEW_MAX_ADD_ONS = 10;

export class CheckoutPricePreview {
  constructor(private readonly db: Kysely<DB>, private readonly deals: DealsCheckoutService | null) {}

  async preview(ctx: PricePreviewCtx, q: { serviceId?: unknown; addOns?: unknown; priceCents?: unknown }): Promise<PricePreviewResponse> {
    const T = ctx.tenantId; const B = ctx.branchId && UUID.test(ctx.branchId) ? ctx.branchId : null;
    const sid = String(q.serviceId ?? '');
    if (!UUID.test(sid)) throw withCode(new PricePreviewError('Service not found.', 'SERVICE_NOT_FOUND', 404), 'SERVICE_NOT_FOUND');
    const svc = (await sql<{ id: string; name: string; price_cents: number; is_taxable: boolean | null }>`select s.id, s.name, s.price_cents, s.is_taxable from services s
      where s.tenant_id = ${T} and s.id = ${sid} and s.archived_at is null and (${B}::uuid is null or s.branch_id is null or s.branch_id = ${B}::uuid)`.execute(this.db)).rows[0];
    if (!svc) throw withCode(new PricePreviewError('Service not found.', 'SERVICE_NOT_FOUND', 404), 'SERVICE_NOT_FOUND');
    const catalog = N(svc.price_cents);
    const raw = q.priceCents === undefined || q.priceCents === null || q.priceCents === '' ? catalog : Number(q.priceCents);
    if (!Number.isInteger(raw) || raw < 0 || raw > 10_000_000) throw withCode(new PricePreviewError('Price must be a whole number of cents, 0 or more.', 'PRICE_INVALID', 400), 'PRICE_INVALID');
    const keys = [...new Set(String(q.addOns ?? '').split(',').map((k) => k.trim()).filter(Boolean))];
    if (keys.length > PRICE_PREVIEW_MAX_ADD_ONS) throw withCode(new PricePreviewError('Pick at most 10 add-ons.', 'VALIDATION_FAILED', 400), 'VALIDATION_FAILED');
    const offered = (await sql<{ add_on_key: string; name: string; price_cents: number | string; is_taxable: boolean }>`select a.add_on_key, a.name, a.price_cents, a.is_taxable from service_add_ons a
      where a.tenant_id = ${T} and a.service_id = ${sid} and a.is_active and (${B}::uuid is null or a.branch_id is null or a.branch_id = ${B}::uuid)
      order by a.sort_order, lower(a.name), a.add_on_key`.execute(this.db)).rows;
    const picked = offered.filter((a) => keys.includes(a.add_on_key));
    if (picked.length !== keys.length) throw withCode(new PricePreviewError('An add-on is not offered on this service.', 'VALIDATION_FAILED', 400), 'VALIDATION_FAILED');

    // the hypothetical ticket: the service line, then each add-on line (an add-on line names no service: a service deal covers the service)
    const base = [{ lineId: 'service', serviceId: sid, priceCents: raw, taxable: svc.is_taxable !== false, kind: 'service' as const, key: null as string | null, name: String(svc.name) },
      ...picked.map((a) => ({ lineId: 'add_on:' + a.add_on_key, serviceId: null, priceCents: N(a.price_cents), taxable: !!a.is_taxable, kind: 'add_on' as const, key: a.add_on_key, name: String(a.name) }))];
    const dctx = { tenantId: T, branchId: B ?? '', userId: String(ctx.userId ?? ''), role: String(ctx.role ?? ''), permissions: ctx.permissions ?? [] };
    const d = this.deals ? await this.deals.previewLines(dctx, base.map((l) => ({ lineId: l.lineId, serviceId: l.serviceId, priceCents: l.priceCents }))) : null;
    const discount = d?.totalDiscountCents ?? 0;
    const gross = base.reduce((a, l) => a + l.priceCents, 0);
    const subtotal = Math.max(0, gross - discount);
    const taxable = taxableSubtotal(base.map((l) => ({ priceCents: l.priceCents, taxable: l.taxable })), discount);
    const settings = await resolveCheckoutSettings(this.db, T, B);
    const cash = totalsForMethod(subtotal, 0, settings, 'cash', 0, taxable);
    const lines: PricePreviewLine[] = base.map((l) => {
      const pl = d?.lines.find((x) => x.lineId === l.lineId);
      return { kind: l.kind, key: l.key, name: l.name, priceCents: l.priceCents, taxable: l.taxable, discountCents: pl?.discountCents ?? 0, netCents: pl?.netCents ?? l.priceCents };
    });
    return {
      service: { id: sid, name: String(svc.name), catalogPriceCents: catalog, previewPriceCents: raw },
      lines,
      addOnsAvailable: offered.map((a) => ({ key: a.add_on_key, name: String(a.name), priceCents: N(a.price_cents), taxable: !!a.is_taxable })),
      discounts: { available: !!d, policy: d?.policy ?? null, totalCents: discount, applied: d?.applied ?? [],
        notForWalkIn: (d?.notEligible ?? []).map((x) => ({ dealId: x.dealId, title: x.title, reason: x.reasons[0]?.code ?? null })) },
      tax: { ratePercent: settings.taxRatePercent, taxableCents: taxable, taxCents: cash.taxCents },
      totals: { grossCents: gross, subtotalCents: subtotal, totalDueCents: cash.totalDueCents, cardSurcharge: settings.creditCardSurchargeEnabled ? 'decided_when_card_is_read' : 'off' },
      chargesAnyone: false,
    };
  }
}
