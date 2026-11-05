// sms-billing.service.ts — §47 charges feed + §22-§24 margin + §45 analytics (sms-packages P7).
//
// §47 without a shadow system: the platform ALREADY has a real invoice engine (super-admin-billing →
// billing_invoices + billing_invoice_lines). SMS charges therefore ship as a FEED whose rows are shaped exactly
// like billing_invoice_lines (kind / description / quantity / unit_price_cents / amount_cents) — the existing
// engine consumes them as lines; nothing here mints its own invoices. Amounts come from the CYCLE SNAPSHOT (§26):
// base = the month the tenant was actually on, overage = count × the snapshot unit price. Integer cents, always.
//
// §22/§23 honesty: TWILIO PROVIDER COST is reported ONLY where provider_cost_micros was actually recorded on
// ledger rows. No recorded costs → costAvailable:false and the screen says "Provider Cost Not Available" — the
// spec's exact instruction: do not invent it. Margin exists only when both sides are real.
import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

@Injectable()
export class SmsBillingService {
  constructor(private readonly db?: Kysely<any>) {}
  private need(): Kysely<any> { if (!this.db) throw new Error('sms billing: no db'); return this.need_(); }
  private need_(): Kysely<any> { return this.db as Kysely<any>; }

  /** §47 — the month's per-tenant charges, invoice-line shaped. month = 'YYYY-MM'. */
  async chargesForMonth(month: string) {
    const start = `${month}-01`;
    const rows: any = await sql`
      select c.tenant_id, t.display_name as tenant_name, c.package_code, c.package_name,
             c.monthly_price_cents, c.overage_count, c.overage_unit_price_cents, c.cycle_start, c.cycle_end
      from tenant_sms_billing_cycles c join tenants t on t.id = c.tenant_id
      where c.cycle_start = ${start}::date
      order by t.display_name asc`.execute(this.need());
    const tenants = (rows.rows ?? []).map((c: any) => {
      const base = Number(c.monthly_price_cents);
      const overageCount = Number(c.overage_count);
      const overageUnit = Number(c.overage_unit_price_cents);
      const overage = overageCount * overageUnit;
      const lines = [
        { kind: 'sms_package_base', description: `SMS Verification — ${c.package_name} (${month})`, quantity: 1, unit_price_cents: base, amount_cents: base },
        ...(overageCount > 0 ? [{ kind: 'sms_overage', description: `SMS verification overage (${month})`, quantity: overageCount, unit_price_cents: overageUnit, amount_cents: overage }] : []),
      ];
      return {
        tenantId: String(c.tenant_id), tenantName: String(c.tenant_name), packageCode: String(c.package_code),
        cycleStart: c.cycle_start, cycleEnd: c.cycle_end,
        baseCents: base, overageCents: overage, totalCents: base + overage, lines,
      };
    });
    return { month, tenants, totalCents: tenants.reduce((s: number, t: any) => s + t.totalCents, 0) };
  }

  /** §22-§24 + §45 — revenue, margin (only where cost is REAL), and usage analytics for a month. */
  async revenueAnalytics(month: string) {
    const start = `${month}-01`;
    const cyc: any = await sql`
      select package_code, package_name,
             count(*)::int as tenants,
             sum(monthly_price_cents)::bigint as base_cents,
             sum(overage_count * overage_unit_price_cents)::bigint as overage_cents,
             sum(used_included + overage_count)::bigint as sent,
             sum(failed_count)::bigint as failed
      from tenant_sms_billing_cycles where cycle_start = ${start}::date
      group by package_code, package_name order by package_code`.execute(this.need());
    const perPackage = (cyc.rows ?? []).map((r: any) => ({
      packageCode: String(r.package_code), packageName: String(r.package_name), tenants: Number(r.tenants),
      subscriptionRevenueCents: Number(r.base_cents), overageRevenueCents: Number(r.overage_cents),
      smsSent: Number(r.sent), smsFailed: Number(r.failed),
    }));
    const subscriptionRevenueCents = perPackage.reduce((s: number, p: any) => s + p.subscriptionRevenueCents, 0);
    const overageRevenueCents = perPackage.reduce((s: number, p: any) => s + p.overageRevenueCents, 0);

    const cost: any = await sql`
      select count(*) filter (where provider_cost_micros is not null)::int as with_cost,
             coalesce(sum(provider_cost_micros), 0)::bigint as micros
      from sms_usage_records
      where requested_at >= ${start}::date and requested_at < (${start}::date + interval '1 month')`.execute(this.need());
    const withCost = Number(cost.rows[0].with_cost);
    const costAvailable = withCost > 0;
    const providerCostCents = costAvailable ? Math.round(Number(cost.rows[0].micros) / 10_000) : null;
    const revenue = subscriptionRevenueCents + overageRevenueCents;
    const grossMarginCents = costAvailable ? revenue - (providerCostCents as number) : null;
    const grossMarginPct = costAvailable && revenue > 0 ? Math.round(((grossMarginCents as number) / revenue) * 100) : null;

    const purp: any = await sql`
      select purpose, count(*)::int as n from sms_usage_records
      where requested_at >= ${start}::date and requested_at < (${start}::date + interval '1 month') and billable = true
      group by purpose order by n desc`.execute(this.need());
    const stat: any = await sql`
      select status, count(*)::int as n from sms_usage_records
      where requested_at >= ${start}::date and requested_at < (${start}::date + interval '1 month')
      group by status order by n desc`.execute(this.need());

    return {
      month,
      totals: { subscriptionRevenueCents, overageRevenueCents, costAvailable, providerCostCents, grossMarginCents, grossMarginPct },
      perPackage,
      byPurpose: (purp.rows ?? []).map((r: any) => ({ purpose: String(r.purpose), count: Number(r.n) })),
      byStatus: (stat.rows ?? []).map((r: any) => ({ status: String(r.status), count: Number(r.n) })),
    };
  }
}
