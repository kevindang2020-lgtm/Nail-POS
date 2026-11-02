// aiusage-extra.mjs — the AI Usage & Limits part of the catalog harness (Oct 30 2026): /tenant/ai/usage on the REAL
// AiUsageScreenController + repository + SQL (and the real access-gate alert writer). Fixtures only — no real billing:
//   Pilot: 4 paid (one yearly, one at 80 %, one at 90 %, one at 100 %), one past due, one trial running, two trials ended
//   (one still stored "trialing" — the screenshot's contradiction), one cancelled, one turned off by the platform, one
//   disabled for the salon, usage of a previous period that must not count, failed calls that must not count, one recorded
//   payment. Empty salon: nothing subscribed. Other salon: its own subscription + usage (never visible to Pilot).
import { AiUsageScreenController } from '../../modules/super-admin/src/tenant-ai/ai-usage-screen.controller.ts';
import { AiUsageScreenRepository } from '../../modules/super-admin/src/tenant-ai/ai-usage-screen.repository.ts';
import { FixtureInvoiceClient } from '../../modules/ai/src/ai/ai-billing-invoices.ts';
import { PILOT, OTHER } from './seed.mjs';

// Round 2 (Four-Module Completion Guide AI-01): the READ-ONLY provider fixture behind "Re-check invoices". The guide's
// acceptance invoice ($59 base, -$10 proration credit, $3 tax, $0 paid → finalized $52, due $52) + one paid Booking invoice.
// Nothing is stored until the owner re-checks; no provider is called, nothing is charged.
const today = () => new Date().toISOString().slice(0, 10);
export const aiInvoiceFixtures = () => new FixtureInvoiceClient({
  [PILOT]: [
    { id: 'in_h_mkt', number: 'AI-1001', reference: 'AI-1001', packageCode: 'ai_marketing_assistant', status: 'open', currency: 'USD', invoiceDate: today(), periodStart: today(), periodEnd: today(),
      taxCents: 300, totalCents: 5200, amountPaidCents: 0, amountDueCents: 5200, updatedAt: new Date(Date.now() - 3600e3).toISOString(),
      lines: [{ id: 'l1', kind: 'subscription', amountCents: 5900, packageCode: 'ai_marketing_assistant', description: 'AI Marketing Assistant (monthly)' },
              { id: 'l2', kind: 'proration', amountCents: -1000, packageCode: 'ai_marketing_assistant', description: 'Unused time credit' }] },
    { id: 'in_h_book', number: 'AI-1000', reference: 'AI-1000', packageCode: 'ai_booking_assistant', status: 'paid', currency: 'USD', invoiceDate: today(), periodStart: today(), periodEnd: today(),
      taxCents: 0, totalCents: 4900, amountPaidCents: 4900, amountDueCents: 0, updatedAt: new Date(Date.now() - 7200e3).toISOString(),
      lines: [{ id: 'l1', kind: 'subscription', amountCents: 4900, packageCode: 'ai_booking_assistant' }] },
  ],
  [OTHER]: [{ id: 'in_h_other', number: 'O-1', status: 'open', taxCents: 0, totalCents: 5900, updatedAt: new Date().toISOString(), lines: [{ id: 'l1', kind: 'subscription', amountCents: 5900, packageCode: 'ai_marketing_assistant' }] }],
}, 'fixture');

export async function aiUsageSeed(pg) {
  const q = (s, p = []) => pg.query(s, p);
  const sub = (t, code, status, o = {}) => q(`insert into tenant_ai_subscriptions (tenant_id, package_code, status, billing_period, price_cents, usage_limit, trial_starts_at, trial_ends_at, current_period_starts_at, created_at)
    values ($1,$2,$3,$4,$5,$6, ${o.ts ?? 'null'}, ${o.te ?? 'null'}, now() - interval '12 days', now() - make_interval(days => $7))`, [t, code, status, o.period ?? 'monthly', o.price ?? 0, o.limit ?? 0, o.age ?? 30]);
  await sub(PILOT, 'ai_booking_assistant', 'active', { price: 4900, limit: 1000, age: 60 });
  await sub(PILOT, 'ai_marketing_assistant', 'active', { price: 5900, limit: 500, age: 45 });
  await sub(PILOT, 'ai_customer_profile_assistant', 'active', { price: 46800, period: 'yearly', limit: 2000, age: 90 });
  await sub(PILOT, 'ai_checkout_upsell_assistant', 'active', { price: 4900, limit: 3000, age: 20 });
  await sub(PILOT, 'ai_fraud_money_protection', 'past_due', { price: 6900, limit: 10000, age: 70 });
  await sub(PILOT, 'ai_inventory_assistant', 'trialing', { price: 3900, limit: 1000, ts: "now() - interval '4 days'", te: "now() + interval '10 days'", age: 4 });
  await sub(PILOT, 'ai_business_assistant', 'trialing', { price: 5900, limit: 1000, ts: "now() - interval '20 days'", te: "now() - interval '6 days'", age: 20 });
  await sub(PILOT, 'ai_analytics_forecasting', 'expired', { price: 7900, limit: 500, ts: "now() - interval '50 days'", te: "now() - interval '36 days'", age: 50 });
  await sub(PILOT, 'ai_reception_copilot', 'cancelled', { price: 5900, limit: 2000, age: 80 });
  await sub(PILOT, 'ai_ocr_receipt_scanner', 'disabled', { price: 2900, limit: 500, age: 40 });
  await sub(OTHER, 'ai_marketing_assistant', 'active', { price: 5900, limit: 500 });
  await q(`insert into platform_ai_package_settings (package_code, enabled, disabled_reason) values ('ai_voice_transcription', false, 'Speech provider maintenance') on conflict do nothing`);
  const use = (t, code, n, unit, ago, status = 'success') => q(`insert into ai_usage_logs (tenant_id, package_code, usage_unit, usage_amount, status, action, request_id, created_at)
    values ($1,$2,$3,$4,$5,'invoke', gen_random_uuid()::text, now() - $6::interval)`, [t, code, unit, n, status, ago]);
  for (let i = 0; i < 8; i++) await use(PILOT, 'ai_booking_assistant', 30 + i * 5, 'messages', `${i + 1} days`);
  await use(PILOT, 'ai_marketing_assistant', 400, 'generations', '3 days');
  await use(PILOT, 'ai_marketing_assistant', 40, 'generations', '2 days', 'failed');
  await use(PILOT, 'ai_customer_profile_assistant', 1820, 'messages', '5 days');
  await use(PILOT, 'ai_checkout_upsell_assistant', 3000, 'calls', '1 day');
  await use(PILOT, 'ai_checkout_upsell_assistant', 25, 'calls', '6 hours', 'blocked_limit');
  await use(PILOT, 'ai_checkout_upsell_assistant', 900, 'calls', '20 days');      // the previous period
  await use(PILOT, 'ai_inventory_assistant', 120, 'runs', '2 days');
  await use(OTHER, 'ai_marketing_assistant', 480, 'generations', '1 day');
  await q(`insert into ai_billing_events (event_id, tenant_id, package_code, event_type, provider, payment_status, applied, created_at) values ('h-ev-1', $1, 'ai_booking_assistant', 'payment_succeeded', 'cardpointe', 'paid', true, now() - interval '11 days') on conflict do nothing`, [PILOT]);
  return { aiPackages: 10 };
}
export function aiUsageRoutes(db, routesOf) {
  return routesOf('modules/super-admin/src/tenant-ai/ai-usage-screen.controller.ts', '/tenant/ai/usage-screen', new AiUsageScreenController(new AiUsageScreenRepository(db, aiInvoiceFixtures())));
}
export const aiUsageSql = (T) => ({
  aisubs: [`select package_code, status from tenant_ai_subscriptions where tenant_id = $1 order by package_code`, [T]],
  aialerts: [`select package_code, threshold, acknowledged_at from ai_usage_alerts where tenant_id = $1 order by package_code, threshold`, [T]],
  aievents: [`select package_code, event_type, from_status, to_status from tenant_ai_subscription_events where tenant_id = $1 order by created_at`, [T]],
  aiaudit: [`select action, status from audit_events where tenant_id = $1 and module = 'ai' order by occurred_at`, [T]],
  aiinvoices: [`select provider_invoice_id, status, total_cents, amount_paid_cents, amount_due_cents, tax_cents from ai_billing_invoice_links where tenant_id = $1 order by provider_invoice_id`, [T]],
  airuns: [`select status, invoices_seen, created_count, unchanged_count from ai_billing_reconciliation_runs where tenant_id = $1 order by started_at`, [T]],
  aibranch: [`select b.package_code, br.name, b.override_enabled, b.version from tenant_ai_branch_settings b join branches br on br.id = b.branch_id where b.tenant_id = $1 order by b.package_code, br.name`, [T]],
  aibranchhist: [`select package_code, version, from_override, to_override from tenant_ai_branch_settings_history where tenant_id = $1 order by created_at`, [T]],
});
