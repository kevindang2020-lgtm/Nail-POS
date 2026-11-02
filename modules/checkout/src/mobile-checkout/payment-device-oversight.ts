// payment-device-oversight.ts — Secure Tap to Pay §51 (Oct 27 2026): the payment-phone security PANELS over what already
// exists — no new store, no new metric pipeline:
//   • the device registry          mobile_pay_devices        (trust states, NEW registrations by created_at, app versions)
//   • the audit trail              audit_events              (mobile_pay_device_revoked / _suspended, checkout_payment_claim_conflict)
//   • the ONE security-event table security_events           (resource_type 'payment_device'; the reason starts with the kind —
//                                                               device-security-signals.ts: key_mismatch, revoked_device_attempt, …)
//   • the /metrics registry        integrationBusinessCounts (platform only — this instance's raw attempt counters)
//
// Two readers:
//   tenantDeviceSecuritySummary   the OWNER's salon — every statement is `tenant_id = $salon` (GET /mobile-checkout/devices/security-summary)
//   platformDeviceSecuritySummary the Super Admin fleet view (GET /super-admin/system/payment-devices)
// CROSS-TENANT BY DESIGN: platformDeviceSecuritySummary aggregates COUNTS across every salon for the Super Admin System
// Operations panel (SuperAdminGuard + super_admin.system_operations.view); the only per-salon rows it returns are the ten
// salons with the most NEW phones in 24 h (id + display name + a count) — the unusual-registration watch list. No device id,
// key, session or customer leaves either reader.
import { sql, type Kysely } from 'kysely';
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { integrationBusinessCounts } from '@aipowersalon/observability';
import { PAYMENT_DEVICE_SIGNAL_KINDS, type PaymentDeviceSecuritySummary, type PaymentDeviceSignalKind } from '@aipowersalon/api-contracts';

type Db = Kysely<any> | null | undefined;
export const SUMMARY_WINDOW_DAYS = { default: 30, max: 90 } as const;
const windowOf = (d: unknown) => { const n = Math.floor(Number(d)); return Number.isFinite(n) && n >= 1 ? Math.min(n, SUMMARY_WINDOW_DAYS.max) : SUMMARY_WINDOW_DAYS.default; };
const zeroSignals = () => Object.fromEntries(PAYMENT_DEVICE_SIGNAL_KINDS.map((k) => [k, 0])) as Record<PaymentDeviceSignalKind, number>;
const empty = (scope: 'tenant' | 'platform', windowDays: number): PaymentDeviceSecuritySummary => ({
  scope, windowDays, generatedAt: new Date().toISOString(), devices: {}, registrations: { last24h: 0, window: 0 }, revocations: 0, suspensions: 0, claimConflicts: 0, signals: zeroSignals(), appVersions: [],
});
/** a security event's kind = the reason's prefix before ':' (device-security-signals.ts writes `${kind}: …`) */
const signalsFrom = (rows: Array<{ kind: string; n: number }>) => {
  const s = zeroSignals();
  for (const r of rows) if ((PAYMENT_DEVICE_SIGNAL_KINDS as readonly string[]).includes(r.kind)) s[r.kind as PaymentDeviceSignalKind] += Number(r.n);
  return s;
};

/** The owner's view of ONE salon. Every statement is scoped `tenant_id = ${tenantId}`. */
export async function tenantDeviceSecuritySummary(db: Db, tenantId: string, windowDays?: number): Promise<PaymentDeviceSecuritySummary> {
  const w = windowOf(windowDays);
  if (!db) return empty('tenant', w);
  const [st, reg, aud, sig, ver] = await Promise.all([
    sql<{ status: string; n: number }>`select status, count(*)::int as n from mobile_pay_devices where tenant_id = ${tenantId} group by status`.execute(db),
    sql<{ d: number; w: number }>`select count(*) filter (where created_at >= now() - interval '24 hours')::int as d, count(*)::int as w
                                     from mobile_pay_devices where tenant_id = ${tenantId} and created_at >= now() - (${w} * interval '1 day')`.execute(db),
    sql<{ action: string; n: number }>`select action, count(*)::int as n from audit_events
                                          where tenant_id = ${tenantId} and occurred_at >= now() - (${w} * interval '1 day')
                                            and action in ('mobile_pay_device_revoked', 'mobile_pay_device_suspended', 'checkout_payment_claim_conflict') group by action`.execute(db),
    sql<{ kind: string; n: number }>`select split_part(reason, ':', 1) as kind, count(*)::int as n from security_events
                                        where tenant_id = ${tenantId} and resource_type = 'payment_device' and occurred_at >= now() - (${w} * interval '1 day') group by 1`.execute(db),
    sql<{ version: string; n: number }>`select coalesce(nullif(app_version, ''), 'unknown') as version, count(*)::int as n from mobile_pay_devices
                                           where tenant_id = ${tenantId} and status not in ('revoked', 'compromised') group by 1 order by 2 desc, 1 limit 20`.execute(db),
  ]);
  const a = new Map(aud.rows.map((r) => [r.action, Number(r.n)]));
  return {
    scope: 'tenant', windowDays: w, generatedAt: new Date().toISOString(),
    devices: Object.fromEntries(st.rows.map((r) => [r.status, Number(r.n)])),
    registrations: { last24h: Number(reg.rows[0]?.d ?? 0), window: Number(reg.rows[0]?.w ?? 0) },
    revocations: a.get('mobile_pay_device_revoked') ?? 0, suspensions: a.get('mobile_pay_device_suspended') ?? 0, claimConflicts: a.get('checkout_payment_claim_conflict') ?? 0,
    signals: signalsFrom(sig.rows), appVersions: ver.rows.map((r) => ({ version: String(r.version), devices: Number(r.n) })),
  };
}

/** The Super Admin fleet view — counts across every salon (see the header: cross-tenant by design). */
export async function platformDeviceSecuritySummary(db: Db, windowDays?: number): Promise<PaymentDeviceSecuritySummary> {
  const w = windowOf(windowDays);
  const proc = integrationBusinessCounts();
  const base: PaymentDeviceSecuritySummary = { ...empty('platform', w), topRegistrations: [], process: { events: proc.paymentDevices, appVersions: proc.paymentAppVersions } };
  if (!db) return base;
  const [st, reg, aud, sig, ver, top] = await Promise.all([
    sql<{ status: string; n: number }>`select status, count(*)::int as n from mobile_pay_devices group by status`.execute(db),
    sql<{ d: number; w: number }>`select count(*) filter (where created_at >= now() - interval '24 hours')::int as d, count(*)::int as w
                                     from mobile_pay_devices where created_at >= now() - (${w} * interval '1 day')`.execute(db),
    sql<{ action: string; n: number }>`select action, count(*)::int as n from audit_events
                                          where occurred_at >= now() - (${w} * interval '1 day') and module = 'mobile_checkout'
                                            and action in ('mobile_pay_device_revoked', 'mobile_pay_device_suspended', 'checkout_payment_claim_conflict') group by action`.execute(db),
    sql<{ kind: string; n: number }>`select split_part(reason, ':', 1) as kind, count(*)::int as n from security_events
                                        where resource_type = 'payment_device' and occurred_at >= now() - (${w} * interval '1 day') group by 1`.execute(db),
    sql<{ version: string; n: number }>`select coalesce(nullif(app_version, ''), 'unknown') as version, count(*)::int as n from mobile_pay_devices
                                           where status not in ('revoked', 'compromised') group by 1 order by 2 desc, 1 limit 20`.execute(db),
    sql<{ tenant_id: string; name: string; n: number }>`select d.tenant_id, coalesce(t.display_name, t.legal_name, '') as name, count(*)::int as n
                                           from mobile_pay_devices d join tenants t on t.id = d.tenant_id
                                          where d.created_at >= now() - interval '24 hours' group by d.tenant_id, t.display_name, t.legal_name order by 3 desc, 2 limit 10`.execute(db),
  ]);
  const a = new Map(aud.rows.map((r) => [r.action, Number(r.n)]));
  return {
    ...base,
    devices: Object.fromEntries(st.rows.map((r) => [r.status, Number(r.n)])),
    registrations: { last24h: Number(reg.rows[0]?.d ?? 0), window: Number(reg.rows[0]?.w ?? 0) },
    revocations: a.get('mobile_pay_device_revoked') ?? 0, suspensions: a.get('mobile_pay_device_suspended') ?? 0, claimConflicts: a.get('checkout_payment_claim_conflict') ?? 0,
    signals: signalsFrom(sig.rows), appVersions: ver.rows.map((r) => ({ version: String(r.version), devices: Number(r.n) })),
    topRegistrations: top.rows.map((r) => ({ tenantId: String(r.tenant_id), tenantName: String(r.name), last24h: Number(r.n) })),
  };
}

/** Super Admin → System Operations → "Payment phones" (§51). */
@UseGuards(SuperAdminGuard)
@Controller('super-admin/system')
export class PaymentDeviceOversightController {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase) {}
  @Get('payment-devices') @RequirePermission('super_admin.system_operations.view')
  summary(): Promise<PaymentDeviceSecuritySummary> { return platformDeviceSecuritySummary(this.db as never); }
}
