// ai-plans.ts — canonical catalog of the AI package PLANS: five named bundles of the 15 assistant packages. Single
// source of truth for plan codes, names, and membership (every package belongs to exactly one plan, no overlap).
// Pricing: each plan's FULL price defaults to the SUM of its member packages' monthly prices; Super Admin may override
// the price and/or apply an optional discount (percent or flat) to produce the effective (new) price. Money is integer
// cents. PURE — depends only on the package catalog, fully testable.
import { AI_PACKAGES, getAiPackage, type AiPackageDef } from './ai-catalog';

export type AiDiscountType = 'percent' | 'flat' | null;

export interface AiPlanDef {
  code: string;
  name: string;
  description: string;
  packageCodes: readonly string[];
  essential?: boolean; // the two daily-essential plans
  sortOrder: number;
}

export const AI_PLANS: readonly AiPlanDef[] = [
  { code: 'plan_booking_calls',        name: 'Booking & Calls',        description: 'The inbound layer — answer calls and book appointments.',                packageCodes: ['ai_booking_assistant', 'ai_phone_call_assistant'], essential: true, sortOrder: 1 },
  { code: 'plan_checkin_queue',        name: 'Check-In & Queue',       description: 'The floor layer — greet, queue, and assign technicians.',                 packageCodes: ['ai_reception_copilot', 'ai_queue_technician_assignment'], essential: true, sortOrder: 2 },
  { code: 'plan_client_growth',        name: 'Client & Growth',        description: 'Win and keep clients — profiles, upsells, marketing, and reviews.',       packageCodes: ['ai_customer_profile_assistant', 'ai_checkout_upsell_assistant', 'ai_marketing_assistant', 'ai_review_reputation_assistant'], sortOrder: 3 },
  { code: 'plan_money_owner',          name: 'Money & Owner',          description: 'Protect the money and guide the business.',                               packageCodes: ['ai_fraud_money_protection', 'ai_ocr_receipt_scanner', 'ai_business_assistant'], sortOrder: 4 },
  { code: 'plan_operations_insights',  name: 'Operations & Insights',  description: 'Run the back of house — forecasting, scheduling, inventory, and notes.',   packageCodes: ['ai_analytics_forecasting', 'ai_scheduling_optimizer', 'ai_inventory_assistant', 'ai_voice_transcription'], sortOrder: 5 },
];

export const AI_PLAN_CODES = AI_PLANS.map((p) => p.code);
const BY_CODE = new Map(AI_PLANS.map((p) => [p.code, p]));
export function getAiPlan(code: string): AiPlanDef | undefined { return BY_CODE.get(code); }
export function isAiPlanCode(code: string): boolean { return BY_CODE.has(code); }
export function planForPackage(packageCode: string): AiPlanDef | undefined { return AI_PLANS.find((pl) => pl.packageCodes.includes(packageCode)); }

/** Default full price = sum of the plan's member packages' monthly prices (integer cents). */
export function planFullPriceCents(code: string): number {
  const plan = BY_CODE.get(code); if (!plan) return 0;
  return plan.packageCodes.reduce((sum, pc) => sum + (getAiPackage(pc)?.monthlyPriceCents ?? 0), 0);
}

export interface AiPlanPricing { priceCentsOverride?: number | null; discountType?: AiDiscountType; discountValue?: number | null }
export type AiBillingPeriod = 'monthly' | 'yearly';

/** Effective (new) price after an optional manual full-price override and an optional discount. All clamped >= 0.
 *  - priceCentsOverride: when set (>=0), replaces the default summed full price.
 *  - discountType 'percent': discountValue is 0..100; 'flat': discountValue is cents off; null: no discount. */
export function effectivePlanPriceCents(code: string, pricing?: AiPlanPricing): { fullCents: number; effectiveCents: number; discountCents: number } {
  const fullCents = pricing?.priceCentsOverride != null && pricing.priceCentsOverride >= 0 ? Math.round(pricing.priceCentsOverride) : planFullPriceCents(code);
  const dt = pricing?.discountType ?? null;
  const dv = Math.max(0, pricing?.discountValue ?? 0);
  let discountCents = 0;
  if (dt === 'percent') discountCents = Math.round((fullCents * Math.min(100, dv)) / 100);
  else if (dt === 'flat') discountCents = Math.min(fullCents, Math.round(dv));
  const effectiveCents = Math.max(0, fullCents - discountCents);
  return { fullCents, effectiveCents, discountCents };
}

/** Price for a chosen billing period. Monthly = the effective monthly price. Yearly = effective × annualMonths, where
 *  annualMonths (1..12) is how many months are charged per year (e.g. 10 = two months free; 12 = no annual discount).
 *  Also returns the monthly-equivalent (effective MRR contribution) and the annual saving vs paying 12× monthly. */
export function planPeriodPriceCents(code: string, pricing: AiPlanPricing | undefined, period: AiBillingPeriod, annualMonths = 12) {
  const { fullCents, effectiveCents, discountCents } = effectivePlanPriceCents(code, pricing);
  const months = Math.max(1, Math.min(12, Math.round(annualMonths)));
  const periodCents = period === 'yearly' ? effectiveCents * months : effectiveCents;
  const monthlyEquivalentCents = period === 'yearly' ? Math.round(periodCents / 12) : effectiveCents;
  const annualSavingsCents = period === 'yearly' ? Math.max(0, effectiveCents * 12 - periodCents) : 0;
  return { fullCents, discountCents, effectiveMonthlyCents: effectiveCents, period, annualMonths: months, periodCents, monthlyEquivalentCents, annualSavingsCents };
}

/** Member package definitions for a plan (for display / pricing breakdown). */
export function planPackages(code: string): AiPackageDef[] {
  const plan = BY_CODE.get(code); if (!plan) return [];
  return plan.packageCodes.map((pc) => getAiPackage(pc)).filter((p): p is AiPackageDef => !!p);
}

/** Distribute a plan's effective (discounted) price across its member packages proportionally to each member's list
 *  price, in integer cents that sum EXACTLY to effectiveCents (largest-remainder rounding; leftover cents go to the
 *  largest fractional parts, ties broken by larger list price). This is what lets the per-package MRR rollup equal the
 *  discounted bundle price. When members have no list price, the effective price is split evenly. */
export function proratePlanPriceCents(code: string, effectiveCents: number): { code: string; priceCents: number }[] {
  const pkgs = planPackages(code);
  if (pkgs.length === 0) return [];
  const eff = Math.max(0, Math.round(effectiveCents));
  const total = pkgs.reduce((s, p) => s + p.monthlyPriceCents, 0);
  if (total <= 0) {
    const base = Math.floor(eff / pkgs.length); const rem = eff - base * pkgs.length;
    return pkgs.map((p, i) => ({ code: p.code, priceCents: base + (i < rem ? 1 : 0) }));
  }
  const parts = pkgs.map((p) => { const exact = (eff * p.monthlyPriceCents) / total; const floor = Math.floor(exact); return { code: p.code, priceCents: floor, frac: exact - floor, list: p.monthlyPriceCents }; });
  let leftover = eff - parts.reduce((s, r) => s + r.priceCents, 0);
  for (const r of [...parts].sort((a, b) => b.frac - a.frac || b.list - a.list)) { if (leftover <= 0) break; r.priceCents += 1; leftover--; }
  return parts.map((r) => ({ code: r.code, priceCents: r.priceCents }));
}

/** Every package maps to exactly one plan — guarded by a test so a package can't ship uncovered or double-counted. */
export function planCoverage(): { code: string; planCode: string | null }[] {
  return AI_PACKAGES.map((pkg) => ({ code: pkg.code, planCode: AI_PLANS.find((pl) => pl.packageCodes.includes(pkg.code))?.code ?? null }));
}
