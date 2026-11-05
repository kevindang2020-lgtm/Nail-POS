// payment-device-security.ts — Secure Tap to Pay §51 (Oct 27 2026): the payment-phone security panels.
//   GET /mobile-checkout/devices/security-summary   the OWNER's salon (pos.devices.manage)        scope 'tenant'
//   GET /super-admin/system/payment-devices         the platform fleet (system_operations.view)  scope 'platform'
// Counts only — never a key, a token, a session id or a customer. Durable counts come from PostgreSQL (mobile_pay_devices,
// audit_events, security_events); `process` is this API instance's /metrics counters since it started (platform only).

/** The device-security kinds a security event can carry (the reason prefix — device-security-signals.ts). */
export const PAYMENT_DEVICE_SIGNAL_KINDS = ['revoked_device_attempt', 'key_mismatch', 'request_replayed', 'app_version_refused', 'attestation_failed', 'unusual_registration'] as const;
export type PaymentDeviceSignalKind = (typeof PAYMENT_DEVICE_SIGNAL_KINDS)[number];

export interface PaymentDeviceSecuritySummary {
  scope: 'tenant' | 'platform';
  windowDays: number;
  generatedAt: string;
  /** phones by trust state now (pending / active / disabled / revoked / compromised) */
  devices: Record<string, number>;
  registrations: { last24h: number; window: number };
  revocations: number;       // revoked or marked compromised in the window (audited)
  suspensions: number;       // switched off in the window (audited)
  claimConflicts: number;    // a phone tried to claim a ticket another surface held (audited)
  /** security events in the window by kind — one event per (kind, salon, phone) per 10 minutes, so "incidents", not raw attempts */
  signals: Record<PaymentDeviceSignalKind, number>;
  /** app versions of the phones that can still pay (not revoked / compromised), most phones first */
  appVersions: Array<{ version: string; devices: number }>;
  /** platform only: salons with the most NEW phones in the last 24 h (the unusual-registration rule's input) */
  topRegistrations?: Array<{ tenantId: string; tenantName: string; last24h: number }>;
  /** platform only: this API instance's raw counters (every attempt, before the 10-minute alert dedupe) */
  process?: { events: Record<string, number>; appVersions: Record<string, number> };
}
