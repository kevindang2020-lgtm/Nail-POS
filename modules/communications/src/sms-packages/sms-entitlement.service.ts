// sms-entitlement.service.ts — the §14 CENTRALIZED gate: every tenant-funded verification send asks this service
// first, and reports back here after the provider accepts. No controller talks to Twilio pricing logic directly.
//
// ROLLOUT-SAFE DEFAULT (deliberate, documented): a tenant with NO package assigned keeps verifying — precheck
// allows with billable:false and reason 'no_package_unbilled', and the ledger row records it unbilled. Enforcement
// (limits, overage, hard stop) begins the moment Super Admin assigns a package. Shipping hard enforcement before
// any package exists would break every live salon's booking verification on deploy day — the opposite of §15's
// "never fail silently" spirit.
//
// §16: this service is for TENANT_VERIFICATION purposes only. Platform-security SMS (super-admin OTP) must never
// call it — that traffic is never tenant-billed, so it simply doesn't pass through this gate.
//
// Money: tenant prices in integer cents from the CYCLE SNAPSHOT (§26) — never from today's package row.
// Concurrency honesty: counters advance by atomic UPDATE ... = x + 1; two simultaneous sends exactly at a hard
// limit can land ±1 around it (no advisory lock here by design — a verification send path must stay fast; the
// ledger remains exact and reconciliation (P6) trues up the cycle).
import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { SmsPlatformControlsService } from './sms-platform-controls.service';
import type { EntitlementSource } from '@aipowersalon/permissions';

/** BUILD_PLAN Phase 12 (#13): the SMS verification precheck as the 'sms_verification' source of the ONE
 *  EntitlementService (key = the purpose). Not cacheable — the allowance moves with every send. The send path keeps
 *  calling precheck() on this same instance; the source is how the shared service (and a screen asking "may this salon
 *  send?") reaches the same answer. */
export const SMS_VERIFICATION_KIND = 'sms_verification';
export function smsVerificationSource(svc: Pick<SmsEntitlementService, 'precheck'>): EntitlementSource<Precheck> {
  return { kind: SMS_VERIFICATION_KIND, cacheable: false, decide: (tenantId, purpose) => svc.precheck(tenantId, purpose as SmsPurpose) };
}

export type SmsPurpose =
  | 'BOOKING_VERIFICATION' | 'CUSTOMER_PHONE_VERIFICATION' | 'CUSTOMER_PHONE_CHANGE'
  | 'TECHNICIAN_VERIFICATION' | 'PASSWORD_RESET' | 'OWNER_VERIFICATION' | 'LOGIN_OTP' | 'OTHER_VERIFICATION';

export type Precheck =
  | { allowed: true; billable: false; reason: 'no_package_unbilled' }
  | { allowed: true; billable: true; cycleId: string; willBeOverage: boolean; remainingIncluded: number; overageUnitPriceCents: number }
  | { allowed: false; reason: 'hard_limit_reached'; cycleId: string; remainingIncluded: 0 };

@Injectable()
export class SmsEntitlementService {
  /** controls is OPTIONAL: without it the service behaves exactly as before (all switches at their safe
   *  defaults), so every existing test and harness is unaffected. */
  constructor(private readonly db?: Kysely<any>, private readonly controls?: SmsPlatformControlsService) {}
  private need(): Kysely<any> { if (!this.db) throw new Error('sms entitlement: no db'); return this.db; }

  /** §14/§15 — ask BEFORE sending. Hard limit is the only refusal; everything else stays a clear, honest allow. */
  async precheck(tenantId: string, _purpose: SmsPurpose): Promise<Precheck> {
    // §40 master controls, checked before anything tenant-specific.
    if (this.controls) {
      const c = await this.controls.getControls();
      if (c['sms.emergency_send_disabled'] || !c['sms.verification_platform_enabled']) {
        // The stop button. Same shape as a hard limit so every caller already handles it.
        return { allowed: false, reason: 'hard_limit_reached', cycleId: '', remainingIncluded: 0 };
      }
      if (!c['sms.package_billing_enabled']) {
        // Billing paused platform-wide: sends CONTINUE, unbilled. A billing problem must never become an outage.
        return { allowed: true, billable: false, reason: 'no_package_unbilled' };
      }
    }
    const ctx = await this.resolve(tenantId);
    if (!ctx) return { allowed: true, billable: false, reason: 'no_package_unbilled' };
    const { cycle, sub } = ctx;
    const allowance = cycle.included_count + cycle.credit_allowance + (sub.custom_allowance ?? 0);
    const remaining = Math.max(0, allowance - cycle.used_included);
    if (remaining > 0) {
      return { allowed: true, billable: true, cycleId: cycle.id, willBeOverage: false, remainingIncluded: remaining, overageUnitPriceCents: Number(cycle.overage_unit_price_cents) };
    }
    if (cycle.hard_limit_enabled || !cycle.overage_enabled) {
      // §15: a hard stop is explicit — the caller surfaces a clear message, never a silent drop. A package with
      // overage disabled behaves as a hard limit by definition: there is no priced path past the allowance.
      return { allowed: false, reason: 'hard_limit_reached', cycleId: cycle.id, remainingIncluded: 0 };
    }
    return { allowed: true, billable: true, cycleId: cycle.id, willBeOverage: true, remainingIncluded: 0, overageUnitPriceCents: Number(cycle.overage_unit_price_cents) };
  }

  /** §11/§12 — report AFTER the provider accepts. Idempotent on the provider SID: a retry returns duplicate:true
   *  and moves no counter (the partial UNIQUE from migration 427 is the enforcement; this just reads the verdict). */
  async recordSubmission(tenantId: string, purpose: SmsPurpose, input: { providerMessageId?: string | null; recipientMasked?: string | null; branchId?: string | null; provider?: string }): Promise<{ recorded: boolean; duplicate: boolean; billable: boolean; overage: boolean }> {
    const ctx = await this.resolve(tenantId);
    const provider = input.provider ?? 'twilio';
    const sid = input.providerMessageId ?? null;

    if (!ctx) {
      const r = await this.insertLedger({ tenantId, purpose, provider, sid, recipientMasked: input.recipientMasked ?? null, branchId: input.branchId ?? null, packageId: null, cycleId: null, billable: false, unitPriceCents: null });
      return { recorded: r, duplicate: !r, billable: false, overage: false };
    }
    const { cycle } = ctx;
    const allowance = cycle.included_count + cycle.credit_allowance + (ctx.sub.custom_allowance ?? 0);
    const overage = cycle.used_included >= allowance;
    const unit = overage ? Number(cycle.overage_unit_price_cents) : 0;
    const inserted = await this.insertLedger({ tenantId, purpose, provider, sid, recipientMasked: input.recipientMasked ?? null, branchId: input.branchId ?? null, packageId: cycle.package_id, cycleId: cycle.id, billable: true, unitPriceCents: unit });
    if (!inserted) return { recorded: false, duplicate: true, billable: true, overage };
    if (overage) {
      await sql`update tenant_sms_billing_cycles set overage_count = overage_count + 1, updated_at = now() where id = ${cycle.id}`.execute(this.need());
    } else {
      await sql`update tenant_sms_billing_cycles set used_included = used_included + 1, updated_at = now() where id = ${cycle.id}`.execute(this.need());
    }
    return { recorded: true, duplicate: false, billable: true, overage };
  }

  /** §20 — failures are visible, never billed. */
  async recordFailure(tenantId: string, purpose: SmsPurpose, input: { providerMessageId?: string | null; branchId?: string | null; provider?: string } = {}): Promise<void> {
    const ctx = await this.resolve(tenantId);
    await this.insertLedger({ tenantId, purpose, provider: input.provider ?? 'twilio', sid: input.providerMessageId ?? null, recipientMasked: null, branchId: input.branchId ?? null, packageId: ctx?.cycle.package_id ?? null, cycleId: ctx?.cycle.id ?? null, billable: false, unitPriceCents: null, status: 'FAILED' });
    if (ctx) await sql`update tenant_sms_billing_cycles set failed_count = failed_count + 1, updated_at = now() where id = ${ctx.cycle.id}`.execute(this.need());
  }

  /** §31 — the tenant-facing balance view (POS Settings consumes this in P5). */
  async balance(tenantId: string) {
    const ctx = await this.resolve(tenantId);
    if (!ctx) return { hasPackage: false as const };
    const { cycle, sub } = ctx;
    const allowance = cycle.included_count + cycle.credit_allowance + (sub.custom_allowance ?? 0);
    return {
      hasPackage: true as const,
      packageName: cycle.package_name, packageCode: cycle.package_code,
      cycleStart: cycle.cycle_start, cycleEnd: cycle.cycle_end,
      includedAllowance: allowance, usedIncluded: cycle.used_included,
      remainingIncluded: Math.max(0, allowance - cycle.used_included),
      overageCount: cycle.overage_count, overageUnitPriceCents: Number(cycle.overage_unit_price_cents),
      overageEnabled: cycle.overage_enabled, hardLimitEnabled: cycle.hard_limit_enabled,
      failedCount: cycle.failed_count,
      estimatedOverageCents: cycle.overage_count * Number(cycle.overage_unit_price_cents),
      warningThresholdPercent: Number(sub.p_warn ?? 80), criticalThresholdPercent: Number(sub.p_crit ?? 95),
      monthlyPriceCents: Number(cycle.monthly_price_cents),
    };
  }

  // ── internals ──────────────────────────────────────────────────────────────────────────────────────────
  private async resolve(tenantId: string): Promise<null | { sub: any; cycle: any }> {
    // §8/§28 lazy promotion: a due next-cycle change becomes THE package the first time anything needs the
    // subscription at/after its effective moment. Atomic single UPDATE — no cron, no window where a due pending
    // is half-applied.
    await sql`update tenant_sms_subscriptions
              set package_id = pending_package_id, effective_at = pending_effective_at,
                  pending_package_id = null, pending_effective_at = null, updated_at = now()
              where tenant_id = ${tenantId} and pending_package_id is not null
                and pending_effective_at <= now()`.execute(this.need());
    const s: any = await sql`select s.*, p.code as p_code, p.name as p_name, p.monthly_price_cents as p_price,
        p.included_verification_count as p_included, p.overage_enabled as p_over_on,
        p.overage_unit_price_cents as p_over_price, p.hard_limit_enabled as p_hard,
        p.warning_threshold_percent as p_warn, p.critical_threshold_percent as p_crit
      from tenant_sms_subscriptions s join sms_verification_packages p on p.id = s.package_id
      where s.tenant_id = ${tenantId} and s.status = 'active'`.execute(this.need());
    const sub = s.rows?.[0];
    if (!sub) return null;
    const cycle = await this.getOrOpenCycle(tenantId, sub);
    return { sub, cycle };
  }

  /** Calendar-month cycles; terms SNAPSHOT at open (§25/§26). Editing the package later never rewrites this row. */
  private async getOrOpenCycle(tenantId: string, sub: any): Promise<any> {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const existing: any = await sql`select * from tenant_sms_billing_cycles
      where tenant_id = ${tenantId} and cycle_start = ${iso(start)}`.execute(this.need());
    if (existing.rows?.[0]) return existing.rows[0];
    await sql`insert into tenant_sms_billing_cycles
        (tenant_id, package_id, cycle_start, cycle_end, package_code, package_name, monthly_price_cents,
         included_count, overage_enabled, overage_unit_price_cents, hard_limit_enabled)
      values (${tenantId}, ${sub.package_id}, ${iso(start)}, ${iso(end)}, ${sub.p_code}, ${sub.p_name},
              ${sub.p_price}, ${sub.p_included}, ${sub.p_over_on}, ${sub.p_over_price}, ${sub.p_hard})
      on conflict (tenant_id, cycle_start) do nothing`.execute(this.need());
    const again: any = await sql`select * from tenant_sms_billing_cycles
      where tenant_id = ${tenantId} and cycle_start = ${iso(start)}`.execute(this.need());
    return again.rows[0];
  }

  private async insertLedger(x: { tenantId: string; purpose: SmsPurpose; provider: string; sid: string | null; recipientMasked: string | null; branchId: string | null; packageId: string | null; cycleId: string | null; billable: boolean; unitPriceCents: number | null; status?: string }): Promise<boolean> {
    const r: any = await sql`insert into sms_usage_records
        (tenant_id, branch_id, package_id, billing_cycle_id, purpose, category, provider, provider_message_id,
         recipient_masked, status, billable, unit_price_cents, submitted_at)
      values (${x.tenantId}, ${x.branchId}, ${x.packageId}, ${x.cycleId}, ${x.purpose}, 'TENANT_VERIFICATION',
              ${x.provider}, ${x.sid}, ${x.recipientMasked}, ${x.status ?? 'SUBMITTED'}, ${x.billable},
              ${x.unitPriceCents}, now())
      on conflict (provider, provider_message_id) where provider_message_id is not null do nothing`.execute(this.need());
    return Number(r.numAffectedRows ?? 0) > 0;
  }
}
