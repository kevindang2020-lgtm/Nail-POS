// checkout-settings.resolver.ts — resolves the EFFECTIVE CheckoutSettings for a tenant (+ optional branch) from the
// generic tenant_settings JSONB store (categories 'tips', 'tax', 'payments-checkout'). Branch-level rows override
// tenant-level (branch_id IS NULL). Every missing category/key falls back to DEFAULT_CHECKOUT_SETTINGS, so a tenant that
// hasn't customized anything computes exactly as before. Used by BOTH the POS checkout repo and the kiosk so the two
// never diverge on tip %, tax, or surcharge.
import { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { CheckoutSettings, DEFAULT_CHECKOUT_SETTINGS, GiftCardSaleSettings, DEFAULT_GIFT_CARD_SALE_SETTINGS } from './checkout-display.dto';

const num = (v: unknown, fallback: number): number => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : fallback; };
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v ? v : fallback);

export async function resolveCheckoutSettings(db: Kysely<DB>, tenantId: string, branchId?: string | null): Promise<CheckoutSettings> {
  const d = DEFAULT_CHECKOUT_SETTINGS;
  try {
    const rows = await db.selectFrom('tenant_settings').select(['branch_id', 'category', 'settings_json'])
      .where('tenant_id', '=', tenantId)
      .where('category', 'in', ['tips', 'tax', 'payments-checkout'])
      .where((eb: any) => eb.or([eb('branch_id', 'is', null), ...(branchId ? [eb('branch_id', '=', branchId)] : [])]))
      .execute().catch(() => [] as any[]);
    // for a category, prefer the branch-level row, else the tenant-level (null) row
    const pick = (cat: string): Record<string, any> => {
      const branchRow = branchId ? rows.find((r: any) => r.category === cat && r.branch_id === branchId) : undefined;
      const tenantRow = rows.find((r: any) => r.category === cat && r.branch_id === null);
      const j = (branchRow ?? tenantRow)?.settings_json;
      return j && typeof j === 'object' ? (j as Record<string, any>) : {};
    };
    const tips = pick('tips'), tax = pick('tax'), pc = pick('payments-checkout');

    const taxEnabled = bool(tax.enabled, true);
    const percents = Array.isArray(tips.defaultTipPercents)
      ? tips.defaultTipPercents.filter((x: unknown) => Number.isFinite(Number(x)) && Number(x) >= 0).map((x: unknown) => Number(x))
      : [];

    return {
      creditCardSurchargeEnabled: bool(pc.creditCardSurchargeEnabled, d.creditCardSurchargeEnabled),
      creditCardSurchargePercent: num(pc.creditCardSurchargePercent, d.creditCardSurchargePercent),
      surchargeLabel: str(pc.surchargeLabel, d.surchargeLabel),
      taxRatePercent: taxEnabled ? num(tax.taxRatePercent, d.taxRatePercent) : 0,
      cashDiscountEnabled: bool(pc.cashDiscountEnabled, d.cashDiscountEnabled),
      defaultTipPercents: percents.length ? percents : d.defaultTipPercents,
      customerDisplayPayButtonEnabled: pc.customerDisplayMode === 'customer_pays' ? true : (pc.customerDisplayMode ? false : d.customerDisplayPayButtonEnabled),
      customerDisplayCaptureMode: pc.customerDisplayCaptureMode === 'terminal' ? 'terminal' : d.customerDisplayCaptureMode,
      maxTipPercent: num(tips.maxTipPercent, d.maxTipPercent),
      checkoutCompleteTimeoutSeconds: num(pc.checkoutCompleteTimeoutSeconds, d.checkoutCompleteTimeoutSeconds),
    };
  } catch {
    return { ...d };
  }
}

// Resolve the EFFECTIVE gift-card SALE settings (from the 'gift-card-settings' category) enforced at issuance.
// Branch-level overrides tenant-level; missing keys fall back to DEFAULT_GIFT_CARD_SALE_SETTINGS.
export async function resolveGiftCardSaleSettings(db: Kysely<DB>, tenantId: string, branchId?: string | null): Promise<GiftCardSaleSettings> {
  const d = DEFAULT_GIFT_CARD_SALE_SETTINGS;
  try {
    const rows = await db.selectFrom('tenant_settings').select(['branch_id', 'category', 'settings_json'])
      .where('tenant_id', '=', tenantId)
      .where('category', '=', 'gift-card-settings')
      .where((eb: any) => eb.or([eb('branch_id', 'is', null), ...(branchId ? [eb('branch_id', '=', branchId)] : [])]))
      .execute().catch(() => [] as any[]);
    const branchRow = branchId ? rows.find((r: any) => r.branch_id === branchId) : undefined;
    const tenantRow = rows.find((r: any) => r.branch_id === null);
    const j = (branchRow ?? tenantRow)?.settings_json;
    const g = j && typeof j === 'object' ? (j as Record<string, any>) : {};
    return {
      enabled: bool(g.enabled, d.enabled),
      posSalesEnabled: bool(g.posSalesEnabled, d.posSalesEnabled),
      minAmountCents: num(g.minAmountCents, d.minAmountCents),
      maxAmountCents: num(g.maxAmountCents, d.maxAmountCents),
    };
  } catch {
    return { ...d };
  }
}
