// sms-tenant-plan.service.ts — §7/§8/§28/§29: Super Admin's per-tenant SMS plan operations (sms-packages P3).
//
// assignPackage semantics (documented, no silent proration — §27):
//   · effective 'immediate'  → the subscription changes NOW, and the OPEN cycle is RE-SNAPSHOTTED to the new
//     package's terms with its counters preserved. That is "immediate" without inventing proration: usage so far
//     counts against the new allowance; base-price billing treatment belongs to P7's billing integration.
//   · effective 'next_cycle' → the pending pair is set on the subscription; the entitlement resolver promotes it
//     lazily at the first touch on/after the boundary (migration 428). The open cycle keeps its old snapshot to
//     the end — §26.
//   · DEFAULT when the caller omits `effective` (§28): a DOWNGRADE (new included < current included) waits for
//     next cycle; anything else applies immediately. Super Admin can always override explicitly.
// Manual credit (§29): adds to credit_allowance on the OPEN cycle — it inherently expires at cycle end, which is
// the spec's default. A custom expiry date is deliberately NOT implemented yet; when Kevin needs it, it becomes a
// credits table, not a column hack. Reason is REQUIRED on both operations; both audit with before/after.
import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { SmsEntitlementService } from './sms-entitlement.service';
import { SmsPlatformControlsService } from './sms-platform-controls.service';
import { utcDate } from '@aipowersalon/date-time';

export type AdminCtx = { userId?: string | null; ip?: string | null; role?: string };
export class SmsTenantPlanError extends Error { constructor(public code: string, msg?: string) { super(msg || code); } }

@Injectable()
export class SmsTenantPlanService {
  constructor(private readonly db: Kysely<any> | undefined, private readonly entitlement: SmsEntitlementService, private readonly controls?: SmsPlatformControlsService) {}
  private need(): Kysely<any> { if (!this.db) throw new SmsTenantPlanError('no_db'); return this.db; }

  /** §7 — the SA tenant-detail panel: assignment + live cycle state + pending change + recent history. */
  async tenantPlan(tenantId: string) {
    const balance = await this.entitlement.balance(tenantId);       // opens the cycle if a package is assigned
    const sub: any = await sql`select s.*, p.name as package_name, p.code as package_code,
        pp.name as pending_package_name
      from tenant_sms_subscriptions s
      join sms_verification_packages p on p.id = s.package_id
      left join sms_verification_packages pp on pp.id = s.pending_package_id
      where s.tenant_id = ${tenantId}`.execute(this.need());
    const row = sub.rows?.[0] ?? null;
    const changes: any = await sql`select c.*, np.name as new_package_name, op.name as previous_package_name
      from tenant_sms_package_changes c
      join sms_verification_packages np on np.id = c.new_package_id
      left join sms_verification_packages op on op.id = c.previous_package_id
      where c.tenant_id = ${tenantId} order by c.changed_at desc limit 10`.execute(this.need());
    return {
      assignment: row ? {
        packageId: String(row.package_id), packageName: String(row.package_name), packageCode: String(row.package_code),
        status: String(row.status), effectiveAt: row.effective_at, customAllowance: row.custom_allowance ?? null,
        pending: row.pending_package_id ? { packageId: String(row.pending_package_id), packageName: String(row.pending_package_name), effectiveAt: row.pending_effective_at } : null,
      } : null,
      balance,
      recentChanges: (changes.rows ?? []).map((c: any) => ({
        changedAt: c.changed_at, effectiveAt: c.effective_at, reason: String(c.reason),
        from: c.previous_package_name ? String(c.previous_package_name) : null, to: String(c.new_package_name),
        changedBy: c.changed_by_user_id ?? null,
      })),
    };
  }

  /** §44 — the all-tenants usage table. Filters run client-side (SA tenant counts are small); this returns
   *  every active tenant with its assignment + open-cycle state, or nulls when no package is assigned. */
  async listTenantPlans() {
    const rows: any = await sql`
      select t.id as tenant_id, t.display_name as tenant_name, t.status as tenant_status,
             p.id as package_id, p.name as package_name, p.code as package_code,
             s.pending_package_id, s.custom_allowance,
             c.included_count, c.credit_allowance, c.used_included, c.overage_count, c.failed_count,
             c.overage_unit_price_cents, c.monthly_price_cents, c.hard_limit_enabled, c.overage_enabled,
             c.cycle_start, c.cycle_end,
             l.last_sms_at
      from tenants t
      left join tenant_sms_subscriptions s on s.tenant_id = t.id and s.status = 'active'
      left join sms_verification_packages p on p.id = s.package_id
      left join tenant_sms_billing_cycles c on c.tenant_id = t.id and c.status = 'open'
      left join lateral (
        select max(requested_at) as last_sms_at from sms_usage_records u where u.tenant_id = t.id
      ) l on true
      where t.status <> 'deleted'
      order by t.display_name asc`.execute(this.need());
    return {
      tenants: (rows.rows ?? []).map((r: any) => {
        const included = r.included_count === null ? null : Number(r.included_count) + Number(r.credit_allowance ?? 0) + Number(r.custom_allowance ?? 0);
        const used = r.used_included === null ? null : Number(r.used_included);
        return {
          tenantId: String(r.tenant_id), tenantName: String(r.tenant_name ?? ''), tenantStatus: String(r.tenant_status ?? ''),
          packageId: r.package_id ? String(r.package_id) : null,
          packageName: r.package_name ? String(r.package_name) : null,
          packageCode: r.package_code ? String(r.package_code) : null,
          hasPending: !!r.pending_package_id,
          includedAllowance: included, usedIncluded: used,
          usedPercent: included && included > 0 && used !== null ? Math.round((used / included) * 100) : null,
          overageCount: r.overage_count === null ? null : Number(r.overage_count),
          failedCount: r.failed_count === null ? null : Number(r.failed_count),
          estimatedBillCents: r.monthly_price_cents === null ? null
            : Number(r.monthly_price_cents) + Number(r.overage_count ?? 0) * Number(r.overage_unit_price_cents ?? 0),
          hardLimitEnabled: r.hard_limit_enabled === null ? null : !!r.hard_limit_enabled,
          overageEnabled: r.overage_enabled === null ? null : !!r.overage_enabled,
          cycleStart: r.cycle_start ?? null, cycleEnd: r.cycle_end ?? null,
          lastSmsAt: r.last_sms_at ?? null,
        };
      }),
    };
  }

  /** §8 — assign/change with required reason. Returns the effective mode actually applied. */
  async assignPackage(ctx: AdminCtx, tenantId: string, packageId: string, opts: { effective?: 'immediate' | 'next_cycle'; reason: string; auditAction?: string }) {
    const reason = String(opts?.reason ?? '').trim();
    if (!reason) throw new SmsTenantPlanError('reason_required', 'A reason is required for every package change.');
    const pkg: any = await sql`select * from sms_verification_packages where id = ${packageId} and active = true`.execute(this.need());
    const target = pkg.rows?.[0];
    if (!target) throw new SmsTenantPlanError('package_not_found', 'That package does not exist or is disabled.');

    const cur: any = await sql`select s.*, p.included_verification_count as cur_included
      from tenant_sms_subscriptions s join sms_verification_packages p on p.id = s.package_id
      where s.tenant_id = ${tenantId}`.execute(this.need());
    const current = cur.rows?.[0] ?? null;
    if (current && String(current.package_id) === String(packageId) && !current.pending_package_id) {
      throw new SmsTenantPlanError('already_assigned', 'The tenant already has this package.');
    }

    const isDowngrade = current ? Number(target.included_verification_count) < Number(current.cur_included) : false;
    const effective: 'immediate' | 'next_cycle' = opts.effective ?? (isDowngrade ? 'next_cycle' : 'immediate');

    const now = new Date();
    const nextCycleStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const effectiveAt = effective === 'immediate' ? now : nextCycleStart;

    if (!current) {
      // §40: new-tenant enrollment can be paused platform-wide. EXISTING assignments are never disturbed.
      if (this.controls) {
        const c = await this.controls.getControls();
        if (!c['sms.new_tenant_enrollment_enabled']) throw new SmsTenantPlanError('enrollment_paused', 'New SMS package enrollment is paused platform-wide.');
      }
      await sql`insert into tenant_sms_subscriptions (tenant_id, package_id, effective_at) values (${tenantId}, ${packageId}, ${effectiveAt})`.execute(this.need());
    } else if (effective === 'immediate') {
      await sql`update tenant_sms_subscriptions set package_id = ${packageId}, effective_at = ${effectiveAt},
                pending_package_id = null, pending_effective_at = null, updated_at = now()
                where tenant_id = ${tenantId}`.execute(this.need());
      // Re-snapshot the OPEN cycle to the new terms, counters preserved (see header — immediate, no proration).
      await sql`update tenant_sms_billing_cycles set package_id = ${packageId}, package_code = ${target.code},
                package_name = ${target.name}, monthly_price_cents = ${target.monthly_price_cents},
                included_count = ${target.included_verification_count}, overage_enabled = ${target.overage_enabled},
                overage_unit_price_cents = ${target.overage_unit_price_cents}, hard_limit_enabled = ${target.hard_limit_enabled},
                updated_at = now()
                where tenant_id = ${tenantId} and status = 'open'`.execute(this.need());
    } else {
      await sql`update tenant_sms_subscriptions set pending_package_id = ${packageId}, pending_effective_at = ${effectiveAt},
                updated_at = now() where tenant_id = ${tenantId}`.execute(this.need());
    }

    await sql`insert into tenant_sms_package_changes (tenant_id, previous_package_id, new_package_id, changed_by_user_id, effective_at, reason)
              values (${tenantId}, ${current ? current.package_id : null}, ${packageId}, ${ctx.userId ?? null}, ${effectiveAt}, ${reason})`.execute(this.need());
    await this.audit(ctx, opts.auditAction ?? 'super_admin.sms_tenant_package_assigned', tenantId, {
      previousPackageId: current ? String(current.package_id) : null, newPackageId: packageId, effective, effectiveAt: effectiveAt.toISOString(), reason, downgradeDefaultApplied: !opts.effective && isDowngrade,
    });
    return { effective, effectiveAt };
  }

  /** §29 — manual credit onto the OPEN cycle. Expires at cycle end by construction. */
  async addCredit(ctx: AdminCtx, tenantId: string, amount: number, reason: string) {
    if (!Number.isInteger(amount) || amount <= 0) throw new SmsTenantPlanError('bad_amount', 'Credit must be a positive whole number of verifications.');
    const r = String(reason ?? '').trim();
    if (!r) throw new SmsTenantPlanError('reason_required', 'A reason is required for every manual credit.');
    const balance = await this.entitlement.balance(tenantId);       // ensures the cycle exists
    if (!balance.hasPackage) throw new SmsTenantPlanError('no_package', 'Assign a package before adding credit — credit lives on a billing cycle.');
    const upd: any = await sql`update tenant_sms_billing_cycles set credit_allowance = credit_allowance + ${amount}, updated_at = now()
              where tenant_id = ${tenantId} and status = 'open'`.execute(this.need());
    if (Number(upd.numAffectedRows ?? 0) === 0) throw new SmsTenantPlanError('no_open_cycle');
    await this.audit(ctx, 'super_admin.sms_manual_credit_added', tenantId, { amount, reason: r, expires: 'cycle_end' });
    return this.entitlement.balance(tenantId);
  }

  /** §41 — called by tenant creation (both SA-direct and application approval flow through createTenant()).
   *  FIRE-AND-FORGET SEMANTICS: every failure is swallowed into {applied:false} — a new salon must never fail
   *  to exist because of an SMS package setting. No default configured → no-op. */
  async applyDefaultForNewTenant(tenantId: string): Promise<{ applied: boolean; packageCode?: string }> {
    try {
      const code = await this.controls?.getDefaultPackageCode();
      if (!code) return { applied: false };
      const pkg: any = await sql`select id from sms_verification_packages where code = ${code} and active = true`.execute(this.need());
      if (!pkg.rows?.[0]) return { applied: false };
      await this.assignPackage({ userId: null, role: 'SYSTEM' }, tenantId, String(pkg.rows[0].id),
        { reason: 'Default package for new tenants (§41)', auditAction: 'system.sms_default_package_applied' });
      return { applied: true, packageCode: code };
    } catch { return { applied: false }; }
  }

  /** §46 — the per-tenant message-level drill-down. Tenant-scoped ledger rows, §21 masked recipients only. */
  async recentUsage(tenantId: string, limit = 50) {
    const n = Math.max(1, Math.min(200, Number(limit) || 50));
    const r: any = await sql`select requested_at, purpose, category, status, billable, unit_price_cents,
        recipient_masked, provider_message_id is not null as has_sid
      from sms_usage_records where tenant_id = ${tenantId}
      order by requested_at desc limit ${n}`.execute(this.need());
    return { records: (r.rows ?? []).map((x: any) => ({
      requestedAt: x.requested_at, purpose: String(x.purpose), category: String(x.category), status: String(x.status),
      billable: !!x.billable, unitPriceCents: Number(x.unit_price_cents ?? 0),
      recipientMasked: x.recipient_masked ?? null, hasSid: !!x.has_sid,
    })) };
  }

  /** wave 3 PAYI §76 / §77 / §80: the salon's plain-SMS usage this calendar month (UTC) — SEGMENTS, the billable unit —
   *  kept apart from the verification allowance above (a different cost model). Honest: rows the provider never sized
   *  are reported as unknown, never counted as one segment each. Null without a database. */
  async messagingUsageThisMonth(tenantId: string, now: Date = new Date()): Promise<{ periodStart: string; periodEnd: string; messages: number; segments: number; delivered: number; failed: number; unknownSegments: number } | null> {
    if (!this.db) return null;
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const r: any = await sql`
      SELECT count(*)::int AS messages, coalesce(sum(segment_count), 0)::int AS segments,
             count(*) FILTER (WHERE status = 'delivered')::int AS delivered, count(*) FILTER (WHERE status = 'failed')::int AS failed,
             count(*) FILTER (WHERE segment_count IS NULL)::int AS unknown_segments
      FROM notifications WHERE tenant_id = ${tenantId} AND channel = 'sms' AND status NOT IN ('simulated', 'blocked') AND created_at >= ${start.toISOString()}::timestamptz AND created_at < ${end.toISOString()}::timestamptz
    `.execute(this.db).catch(() => ({ rows: [] }));
    const x = r.rows?.[0] ?? {};
    return { periodStart: utcDate(start), periodEnd: utcDate(end), messages: Number(x.messages ?? 0), segments: Number(x.segments ?? 0), delivered: Number(x.delivered ?? 0), failed: Number(x.failed ?? 0), unknownSegments: Number(x.unknown_segments ?? 0) };
  }

  /** §9 — packages a TENANT may choose. Only active + self_service_available; §43-safe fields only. */
  async selfServicePackages() {
    const r: any = await sql`select id, code, name, description, monthly_price_cents, included_verification_count,
        overage_enabled, overage_unit_price_cents, hard_limit_enabled, display_order
      from sms_verification_packages where active = true and self_service_available = true
      order by display_order asc`.execute(this.need());
    return (r.rows ?? []).map((p: any) => ({
      id: String(p.id), code: String(p.code), name: String(p.name), description: p.description ?? null,
      monthlyPriceCents: Number(p.monthly_price_cents), includedVerificationCount: Number(p.included_verification_count),
      overageEnabled: !!p.overage_enabled, overageUnitPriceCents: Number(p.overage_unit_price_cents),
      hardLimitEnabled: !!p.hard_limit_enabled,
    }));
  }

  /** §9 — tenant self-service change. Only self-service packages; §28's default effective policy applies
   *  (upgrade immediate, downgrade next cycle) and the tenant cannot override it — that lever is Super Admin's. */
  async selfServiceChange(actor: AdminCtx, tenantId: string, packageId: string) {
    const ok: any = await sql`select 1 from sms_verification_packages
      where id = ${packageId} and active = true and self_service_available = true`.execute(this.need());
    if (!ok.rows?.[0]) throw new SmsTenantPlanError('not_self_service', 'That package is not available for self-service selection.');
    return this.assignPackage({ ...actor, role: actor.role ?? 'TENANT' }, tenantId, packageId,
      { reason: 'Tenant self-service package change', auditAction: 'tenant.sms_package_self_service_change' });
  }

  private async audit(ctx: AdminCtx, action: string, tenantId: string, metadata: Record<string, unknown>) {
    await sql`insert into audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, ip_address, metadata_json)
      values (null, ${ctx.userId ?? null}, ${ctx.role ?? 'SUPER_ADMIN'}, ${action}, 'tenant_sms_subscription', ${tenantId},
              ${ctx.ip ?? null}, ${JSON.stringify(metadata)}::jsonb)`.execute(this.need()).catch(() => {});
  }
}
