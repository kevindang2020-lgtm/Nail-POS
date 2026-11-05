// sms-platform-controls.service.ts — §40 Super Admin master controls (sms-packages follow-up, Jul 29 2026).
// Storage is the EXISTING platform_settings table (migration 202) — four boolean rows in the 'sms_packages'
// group, seeded by migration 430 at their safe defaults. No new store, no parallel config system.
//
// How the switches bite (all enforced in ONE place — the entitlement precheck):
//   · sms.emergency_send_disabled = true       → every tenant-funded verification send is refused NOW. The stop
//     button. Platform-security OTP is untouched because it never passes through the gate at all (§16).
//   · sms.verification_platform_enabled = false → same refusal, but the "we've turned the product off" version.
//   · sms.package_billing_enabled = false      → sends CONTINUE, unbilled: precheck returns billable:false and
//     the ledger records the traffic honestly. Billing pauses; salons keep verifying. That asymmetry is the
//     point — a billing problem must never become a customer-facing outage.
//   · sms.new_tenant_enrollment_enabled        → read by assignment (a NEW subscription is refused when off);
//     existing tenants are never disturbed.
// Every change is audited with before/after and requires a reason (§55).
import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

export type AdminCtx = { userId?: string | null; ip?: string | null };
export class SmsControlsError extends Error { constructor(public code: string, msg?: string) { super(msg || code); } }

export const SMS_CONTROL_KEYS = [
  'sms.verification_platform_enabled',
  'sms.package_billing_enabled',
  'sms.new_tenant_enrollment_enabled',
  'sms.emergency_send_disabled',
] as const;
export type SmsControlKey = (typeof SMS_CONTROL_KEYS)[number];

@Injectable()
export class SmsPlatformControlsService {
  constructor(private readonly db?: Kysely<any>) {}
  private need(): Kysely<any> { if (!this.db) throw new SmsControlsError('no_db'); return this.db; }

  /** All four switches. Missing rows fall back to the SAFE default, never to "off". */
  async getControls(): Promise<Record<SmsControlKey, boolean>> {
    const r: any = await sql`select setting_key, value from platform_settings
      where setting_group = 'sms_packages'`.execute(this.need());
    const map = new Map<string, boolean>((r.rows ?? []).map((x: any) => [String(x.setting_key), x.value === true || x.value === 'true']));
    return {
      'sms.verification_platform_enabled': map.get('sms.verification_platform_enabled') ?? true,
      'sms.package_billing_enabled': map.get('sms.package_billing_enabled') ?? true,
      'sms.new_tenant_enrollment_enabled': map.get('sms.new_tenant_enrollment_enabled') ?? true,
      'sms.emergency_send_disabled': map.get('sms.emergency_send_disabled') ?? false,
    };
  }

  /** §41 — the default package code for NEW tenants, or null for none (the safe default). */
  async getDefaultPackageCode(): Promise<string | null> {
    const r: any = await sql`select value from platform_settings where setting_key = 'sms.default_package_code'`.execute(this.need());
    const v = r.rows?.[0]?.value ?? null;
    return typeof v === 'string' && v.trim() ? v : null;
  }

  async setDefaultPackageCode(ctx: AdminCtx, code: string | null, reason: string) {
    const r = String(reason ?? '').trim();
    if (!r) throw new SmsControlsError('reason_required', 'A reason is required to change the default package.');
    let next: string | null = null;
    if (code != null && String(code).trim() !== '') {
      const ok: any = await sql`select 1 from sms_verification_packages where code = ${String(code)} and active = true`.execute(this.need());
      if (!ok.rows?.[0]) throw new SmsControlsError('unknown_package', 'That package code does not exist or is disabled.');
      next = String(code);
    }
    const before = await this.getDefaultPackageCode();
    await sql`update platform_settings set value = ${JSON.stringify(next)}::jsonb, version = version + 1, updated_at = now()
      where setting_key = 'sms.default_package_code'`.execute(this.need());
    await sql`insert into audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, ip_address, metadata_json)
      values (null, ${ctx.userId ?? null}, 'SUPER_ADMIN', 'super_admin.sms_default_package_changed', 'platform_setting', null,
              ${ctx.ip ?? null}, ${JSON.stringify({ before, after: next, reason: r })}::jsonb)`.execute(this.need()).catch(() => {});
    return { defaultPackageCode: next };
  }

  async setControl(ctx: AdminCtx, key: string, enabled: boolean, reason: string) {
    if (!SMS_CONTROL_KEYS.includes(key as SmsControlKey)) throw new SmsControlsError('unknown_control', 'That is not an SMS platform control.');
    const r = String(reason ?? '').trim();
    if (!r) throw new SmsControlsError('reason_required', 'A reason is required for every master-control change.');
    const before = await this.getControls();
    await sql`update platform_settings set value = ${JSON.stringify(enabled)}::jsonb, version = version + 1, updated_at = now()
      where setting_key = ${key}`.execute(this.need());
    await sql`insert into audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, ip_address, metadata_json)
      values (null, ${ctx.userId ?? null}, 'SUPER_ADMIN', 'super_admin.sms_master_control_changed', 'platform_setting', null,
              ${ctx.ip ?? null}, ${JSON.stringify({ key, before: before[key as SmsControlKey], after: enabled, reason: r })}::jsonb)`
      .execute(this.need()).catch(() => {});
    return this.getControls();
  }
}
