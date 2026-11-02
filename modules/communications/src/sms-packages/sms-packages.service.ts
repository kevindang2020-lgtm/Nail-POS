// sms-packages.service.ts — Super Admin CRUD for the three SMS Verification Packages (spec §4-§5, P1).
// Pricing is DATA, never code (§1): this service is how Super Admin changes every number without a deploy.
// Exactly three packages exist by seed (§53); there is deliberately no create/delete here — the schema permits a
// future tier, but the product surface stays three until Kevin says otherwise.
import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

/** A Super Admin's request, or a system job (systemContext() — userId 'system:<job>', role SYSTEM). The writers keep a user id only
 *  when it is a UUID and name the job in the audit metadata otherwise (B-14 remainder, Oct 20 2026). */
export type AdminCtx = { userId?: string | null; ip?: string | null; role?: string | null };
export class SmsPackagesError extends Error { constructor(public code: string, msg?: string) { super(msg || code); } }

const EDITABLE = [
  'name', 'description', 'monthly_price_cents', 'included_verification_count', 'overage_enabled',
  'overage_unit_price_cents', 'hard_limit_enabled', 'warning_threshold_percent', 'critical_threshold_percent',
  'self_service_available', 'display_order',
] as const;
type Editable = (typeof EDITABLE)[number];

@Injectable()
export class SmsPackagesService {
  constructor(private readonly db?: Kysely<any>) {}
  private need(): Kysely<any> { if (!this.db) throw new SmsPackagesError('no_db'); return this.db; }

  /** §4 — the management list: every package with its live tenant count. */
  async listPackages() {
    const rows: any = await sql`
      select p.*, (select count(*)::int from tenant_sms_subscriptions s
                    where s.package_id = p.id and s.status = 'active') as tenant_count
      from sms_verification_packages p
      order by p.display_order asc, p.created_at asc`.execute(this.need());
    return { packages: (rows.rows ?? []).map(toView) };
  }

  async getPackage(packageId: string) {
    const r: any = await sql`select * from sms_verification_packages where id = ${packageId}`.execute(this.need());
    const row = r.rows?.[0];
    if (!row) throw new SmsPackagesError('not_found');
    return toView(row);
  }

  /** §5 — full Super Admin control over every configurable field. Money arrives as integer cents (§6). */
  async updatePackage(ctx: AdminCtx, packageId: string, patch: Record<string, unknown>) {
    const before = await this.getPackage(packageId);
    const sets: string[] = [];
    const applied: Record<string, unknown> = {};
    for (const key of EDITABLE) {
      if (!(key in patch)) continue;
      const v = patch[key as string];
      if (key.endsWith('_cents') || key.endsWith('_count') || key.endsWith('_percent') || key === 'display_order') {
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new SmsPackagesError('bad_value', `${key} must be a non-negative integer`);
      }
      if (key.endsWith('_enabled') || key === 'self_service_available') {
        if (typeof v !== 'boolean') throw new SmsPackagesError('bad_value', `${key} must be boolean`);
      }
      if (key === 'name') {
        if (typeof v !== 'string' || !v.trim()) throw new SmsPackagesError('bad_value', 'name must be a non-empty string');
      }
      if (key === 'description') {
        if (v !== null && typeof v !== 'string') throw new SmsPackagesError('bad_value', 'description must be a string or null');
      }
      applied[key] = v;
      sets.push(key);
    }
    if (!sets.length) throw new SmsPackagesError('empty_patch');
    if ('warning_threshold_percent' in applied || 'critical_threshold_percent' in applied) {
      const warn = (applied.warning_threshold_percent as number) ?? before.warningThresholdPercent;
      const crit = (applied.critical_threshold_percent as number) ?? before.criticalThresholdPercent;
      if (warn >= crit) throw new SmsPackagesError('bad_value', 'warning threshold must be below critical threshold');
    }
    // Dynamic-column update: column names come ONLY from the EDITABLE whitelist (safe for sql.raw); every VALUE
    // travels as a bound parameter — the house pattern (see ai-admin.repository), replacing an earlier
    // hand-escaped string build found in the Jul 29 bug sweep.
    const assignments = sql.join(sets.map((k) => sql`${sql.raw(k)} = ${applied[k] as any}`), sql`, `);
    await sql`update sms_verification_packages set ${assignments}, updated_at = now() where id = ${packageId}`.execute(this.need());
    const after = await this.getPackage(packageId);
    await this.audit(ctx, 'super_admin.sms_package_updated', packageId, { before, after, fields: sets });
    return after;
  }

  /** §4 Enable/Disable. Disabling never touches existing tenant assignments — it stops NEW offering only. */
  async setActive(ctx: AdminCtx, packageId: string, active: boolean) {
    const before = await this.getPackage(packageId);
    await sql`update sms_verification_packages set active = ${active}, updated_at = now() where id = ${packageId}`.execute(this.need());
    await this.audit(ctx, active ? 'super_admin.sms_package_enabled' : 'super_admin.sms_package_disabled', packageId, { before: { active: before.active }, after: { active } });
    return this.getPackage(packageId);
  }

  private async audit(ctx: AdminCtx, action: string, packageId: string, metadata: Record<string, unknown>) {
    await sql`
      insert into audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, ip_address, metadata_json)
      values (null, ${ctx.userId ?? null}, 'SUPER_ADMIN', ${action}, 'sms_verification_package', ${packageId},
              ${ctx.ip ?? null}, ${JSON.stringify(metadata)}::jsonb)`.execute(this.need()).catch(() => {});
  }
}


function toView(r: any) {
  return {
    id: String(r.id), code: String(r.code), name: String(r.name), description: r.description ?? null,
    monthlyPriceCents: Number(r.monthly_price_cents), includedVerificationCount: Number(r.included_verification_count),
    overageEnabled: !!r.overage_enabled, overageUnitPriceCents: Number(r.overage_unit_price_cents),
    hardLimitEnabled: !!r.hard_limit_enabled,
    warningThresholdPercent: Number(r.warning_threshold_percent), criticalThresholdPercent: Number(r.critical_threshold_percent),
    selfServiceAvailable: !!r.self_service_available, active: !!r.active, displayOrder: Number(r.display_order),
    tenantCount: r.tenant_count !== undefined ? Number(r.tenant_count) : undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
