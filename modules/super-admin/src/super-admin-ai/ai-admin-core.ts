// ai-admin-core.ts — PURE helpers for the Super-Admin AI subscription manager: roll real subscriptions up per package
// (subscribers, status breakdown, MRR) and normalize an assign/grant request against the catalog. No DB — testable.
import { AI_PACKAGES, getAiPackage, type AiUsageUnit } from '@aipowersalon/ai';

export type AiSubStatus = 'active' | 'trialing' | 'past_due' | 'unpaid' | 'cancelled' | 'expired' | 'disabled' | 'suspended';
const STATUSES: AiSubStatus[] = ['active', 'trialing', 'past_due', 'unpaid', 'cancelled', 'expired', 'disabled', 'suspended'];

export interface SubRow {
  tenantId: string; packageCode: string; status: AiSubStatus; billingPeriod: 'monthly' | 'yearly';
  priceCents: number; usageLimit: number; overageEnabled: boolean;
  trialEndsAt: string | Date | null; currentPeriodStartsAt: string | Date | null;
}

export interface PackageRollup {
  code: string; name: string; category: string; monthlyPriceCents: number; includedUsageLimit: number;
  usageUnit: AiUsageUnit; trialDays: number; sortOrder: number;
  subscribers: number; activeSubscribers: number; byStatus: Record<string, number>; mrrCents: number;
}

/** Per-package rollup over the full subscription set. MRR counts only 'active' (yearly → monthly-equivalent). */
export function catalogWithRollup(subs: SubRow[]): PackageRollup[] {
  const roll = new Map<string, { subscribers: number; active: number; byStatus: Record<string, number>; mrrCents: number }>();
  for (const s of subs) {
    const e = roll.get(s.packageCode) ?? { subscribers: 0, active: 0, byStatus: {}, mrrCents: 0 };
    e.subscribers++;
    e.byStatus[s.status] = (e.byStatus[s.status] ?? 0) + 1;
    if (s.status === 'active') { e.active++; e.mrrCents += s.billingPeriod === 'yearly' ? Math.round(s.priceCents / 12) : s.priceCents; }
    roll.set(s.packageCode, e);
  }
  return AI_PACKAGES.map((p) => {
    const e = roll.get(p.code);
    return {
      code: p.code, name: p.name, category: p.category, monthlyPriceCents: p.monthlyPriceCents,
      includedUsageLimit: p.includedUsageLimit, usageUnit: p.usageUnit, trialDays: p.trialDays, sortOrder: p.sortOrder,
      subscribers: e?.subscribers ?? 0, activeSubscribers: e?.active ?? 0, byStatus: e?.byStatus ?? {}, mrrCents: e?.mrrCents ?? 0,
    };
  });
}

export interface AssignInput {
  packageCode: string; status?: string; billingPeriod?: string; priceCents?: number;
  usageLimit?: number; overageEnabled?: boolean; trialDays?: number; trial?: boolean;
}
export interface NormalizedAssign {
  packageCode: string; status: AiSubStatus; billingPeriod: 'monthly' | 'yearly'; priceCents: number; currency: string;
  usageLimit: number; overageEnabled: boolean; trialStartsAt: Date | null; trialEndsAt: Date | null; currentPeriodStartsAt: Date;
}

/** Validate + fill an assign/grant request from catalog defaults. Returns ok:false for an unknown package code. */
export function normalizeAssign(input: AssignInput, now: Date = new Date()): { ok: true; value: NormalizedAssign } | { ok: false; error: string } {
  const pkg = getAiPackage(input.packageCode);
  if (!pkg) return { ok: false, error: 'unknown_ai_package' };
  const requested = input.status && STATUSES.includes(input.status as AiSubStatus) ? (input.status as AiSubStatus) : undefined;
  const status: AiSubStatus = requested ?? (input.trial ? 'trialing' : 'active');
  const billingPeriod = input.billingPeriod === 'yearly' ? 'yearly' : 'monthly';
  const priceCents = Number.isFinite(input.priceCents as number) ? Math.max(0, Math.round(input.priceCents as number)) : pkg.monthlyPriceCents;
  const usageLimit = Number.isFinite(input.usageLimit as number) ? Math.max(0, Math.round(input.usageLimit as number)) : pkg.includedUsageLimit;
  const trialDays = input.trialDays !== undefined ? Math.max(0, Math.floor(input.trialDays)) : (status === 'trialing' ? pkg.trialDays : 0);
  const trialEndsAt = status === 'trialing' && trialDays > 0 ? new Date(now.getTime() + trialDays * 86400000) : null;
  return {
    ok: true,
    value: {
      packageCode: pkg.code, status, billingPeriod, priceCents, currency: 'usd', usageLimit,
      overageEnabled: !!input.overageEnabled, trialStartsAt: trialEndsAt ? now : null, trialEndsAt, currentPeriodStartsAt: now,
    },
  };
}

export interface UpdateInput { status?: string; usageLimit?: number; overageEnabled?: boolean; billingPeriod?: string; priceCents?: number }
/** Validate a partial update; only known fields pass through. */
export function normalizeUpdate(input: UpdateInput): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const v: Record<string, unknown> = {};
  if (input.status !== undefined) { if (!STATUSES.includes(input.status as AiSubStatus)) return { ok: false, error: 'invalid_status' }; v.status = input.status; }
  if (input.usageLimit !== undefined) { if (!Number.isFinite(input.usageLimit)) return { ok: false, error: 'invalid_usage_limit' }; v.usageLimit = Math.max(0, Math.round(input.usageLimit)); }
  if (input.overageEnabled !== undefined) v.overageEnabled = !!input.overageEnabled;
  if (input.billingPeriod !== undefined) v.billingPeriod = input.billingPeriod === 'yearly' ? 'yearly' : 'monthly';
  if (input.priceCents !== undefined) { if (!Number.isFinite(input.priceCents)) return { ok: false, error: 'invalid_price' }; v.priceCents = Math.max(0, Math.round(input.priceCents)); }
  if (Object.keys(v).length === 0) return { ok: false, error: 'no_fields' };
  return { ok: true, value: v };
}
