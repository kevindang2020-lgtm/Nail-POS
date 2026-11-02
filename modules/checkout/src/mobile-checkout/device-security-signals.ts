// device-security-signals.ts — Secure Tap to Pay §51 (Oct 26 2026): the payment-device counters and security alerts, on the
// platform's EXISTING systems — no new dashboard, no new store:
//   • counters  → @aipowersalon/observability recordPaymentDeviceEvent / recordPaymentDeviceAppVersion (the /metrics
//                 registry, closed vocabulary, next to aipowersalon_payment_events_total);
//   • alerts    → the ONE security-event recorder (modules/security-center SecurityEvents → security_events, Constitution 12
//                 §189), for the attempts the mandate names: a REVOKED phone still calling, a request whose device
//                 signature does not match (a copied session / cloned phone / tampered body), a replayed signed request,
//                 and a payment phone on an unsupported (below-minimum) app version.
// No new event type (the catalog is a DB CHECK): a device attack is FRAUD_PATTERN_DETECTED (HIGH), an unsupported version the
// same type at LOW — the reason text names which. A normal card decline is never a security event (§51).
//
// VOLUME AT THE SOURCE (security-events.ts §194): every attempt is COUNTED, but a security event is written at most once per
// (kind, salon, phone) per 10 minutes in this process (bounded map) — a revoked phone retrying in a loop is one alert, not a
// thousand rows. Never throws; never blocks the refusal it reports.
import { recordPaymentDeviceEvent, recordPaymentDeviceAppVersion, type PaymentDeviceEvent } from '@aipowersalon/observability';
import type { SecurityEvents } from '@aipowersalon/security-center';
type SecurityEventInput = Parameters<SecurityEvents['record']>[0];

export type DeviceSecurityKind = 'revoked_device_attempt' | 'key_mismatch' | 'request_replayed' | 'app_version_refused' | 'attestation_failed' | 'unusual_registration';
/** The slice of SecurityEvents.record this needs (structural — tests pass a fake). */
export interface DeviceSecurityEventsPort { record(e: SecurityEventInput): Promise<boolean> }

const WHAT: Record<DeviceSecurityKind, { severity: 'HIGH' | 'MEDIUM' | 'LOW'; reason: string }> = {
  revoked_device_attempt: { severity: 'HIGH', reason: 'a REVOKED payment phone is still calling the payment API (lost / stolen phone, or a copied session)' },
  key_mismatch: { severity: 'HIGH', reason: 'a payment-phone request failed its device signature (copied session, cloned phone or altered request)' },
  request_replayed: { severity: 'HIGH', reason: 'a signed payment-phone request was replayed (same nonce twice)' },
  attestation_failed: { severity: 'HIGH', reason: 'a payment phone FAILED device attestation (§5 — an integrity signal; see TTP_ATTESTATION_POLICY)' },
  app_version_refused: { severity: 'LOW', reason: 'a payment phone tried to take a payment on an unsupported app version (below the minimum)' },
  unusual_registration: { severity: 'MEDIUM', reason: 'an unusual number of NEW payment phones was registered (a stolen login enrolling phones, or a mass enrolment to review)' },
};

/**
 * §51 "unusual registration" (Oct 27 2026). A salon enrols a handful of payment phones in its life; many NEW phones in one day
 * — or several by ONE employee — is what a stolen manager login enrolling phones looks like. The rule counts NEW
 * registrations (a re-register of a known phone is not one) in the last 24 h, the new phone included, and fires when either
 * count is ABOVE its limit. Limits: TTP_UNUSUAL_REG_TENANT_PER_DAY (default 4 per salon) and TTP_UNUSUAL_REG_USER_PER_DAY
 * (default 2 per employee). It never blocks the registration (a new phone is 'pending' until the owner approves it anyway);
 * it raises ONE MEDIUM security event per salon per 10 minutes and counts `unusual_registration`.
 */
export const UNUSUAL_REGISTRATION_DEFAULTS = { tenantPerDay: 4, userPerDay: 2 } as const;
export function unusualRegistrationLimits(env: Record<string, string | undefined> = process.env): { tenantPerDay: number; userPerDay: number } {
  const n = (v: string | undefined, d: number) => { const x = Math.floor(Number(v)); return Number.isFinite(x) && x >= 1 && x <= 1000 ? x : d; };
  return { tenantPerDay: n(env.TTP_UNUSUAL_REG_TENANT_PER_DAY, UNUSUAL_REGISTRATION_DEFAULTS.tenantPerDay), userPerDay: n(env.TTP_UNUSUAL_REG_USER_PER_DAY, UNUSUAL_REGISTRATION_DEFAULTS.userPerDay) };
}
/** The reason text when the counts are unusual, else null. Pure. */
export function unusualRegistration(c: { tenantLast24h: number; userLast24h: number }, limits: { tenantPerDay: number; userPerDay: number } = UNUSUAL_REGISTRATION_DEFAULTS): string | null {
  if (c.userLast24h > limits.userPerDay) return `one employee registered ${c.userLast24h} new payment phones in 24 h (limit ${limits.userPerDay})`;
  if (c.tenantLast24h > limits.tenantPerDay) return `${c.tenantLast24h} new payment phones were registered for this salon in 24 h (limit ${limits.tenantPerDay})`;
  return null;
}
export const DEVICE_SIGNAL_DEDUPE_MS = 10 * 60_000;
const MAX_KEYS = 5_000;

export class DeviceSecuritySignals {
  private readonly last = new Map<string, number>();
  constructor(private readonly events?: DeviceSecurityEventsPort | null, private readonly now: () => number = Date.now) {}

  /** Count one device event (lifecycle or attack) — the closed vocabulary of the metrics registry. */
  count(event: PaymentDeviceEvent): void { recordPaymentDeviceEvent(event); }
  /** The app version a phone reported (bucketed by the registry: major.minor, bounded). */
  appVersion(version: string | null | undefined): void { if (version) recordPaymentDeviceAppVersion(version); }

  /** Count the attempt; write ONE security event per (kind, salon, phone) per window. Returns true when an event was written. */
  signal(kind: DeviceSecurityKind, who: { tenantId?: string | null; deviceId?: string | null; userId?: string | null; ip?: string | null; detail?: string | null }): boolean {
    try {
      recordPaymentDeviceEvent(kind);
      if (!this.events) return false;
      const key = `${kind}|${who.tenantId ?? '-'}|${who.deviceId ?? '-'}`;
      const t = this.now(); const prev = this.last.get(key);
      if (prev !== undefined && t - prev < DEVICE_SIGNAL_DEDUPE_MS) return false;
      if (prev === undefined && this.last.size >= MAX_KEYS) this.last.clear();   // bounded under a flood
      this.last.set(key, t);
      const w = WHAT[kind];
      void this.events.record({ type: 'FRAUD_PATTERN_DETECTED', severity: w.severity, tenantId: who.tenantId ?? null, actorType: who.userId ? 'user' : 'device', actorId: who.userId ?? null,
        resourceType: 'payment_device', resourceId: who.deviceId ?? null, reason: `${kind}: ${w.reason}${who.detail ? ` — ${who.detail}` : ''}`, ip: who.ip ?? null, device: who.deviceId ?? null })
        .catch((e: unknown) => console.warn('[device-signal] security event write failed (the refusal stands):', (e as Error)?.message));
      return true;
    } catch (e) { console.warn('[device-signal] could not count / report a device signal (the refusal stands):', (e as Error)?.message); return false; }   // a signal never breaks the request it describes
  }
}
