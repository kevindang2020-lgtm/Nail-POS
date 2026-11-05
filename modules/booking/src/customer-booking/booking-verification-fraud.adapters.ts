// booking-verification-fraud.adapters.ts — the drivers behind the risk engine.
//
// ── Why this file exists ────────────────────────────────────────────────────────────────────────────────
// I wrote `assessSendRisk()` (pure, 19 tests) and injected it into the send route as
// `@Optional() @Inject('BookingRiskCounters')` — and then provided nothing. So the risk engine was **dead code
// in production**: every request read `this.counters === undefined`, `screen()` returned immediately, and not one
// of those 19 tests described anything that would ever run.
//
// That is exactly the bug class this whole session has been about — a module built, tested, and never wired. It
// is worth naming, because it is the easiest one to ship: everything is green, and nothing is connected.

import type { CaptchaClientConfig } from '@aipowersalon/api-contracts';
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { RiskSignals } from './booking-verification-fraud';
import type { CaptchaVerifier } from './booking-verification-fraud';
import { phoneKey, callingCode } from '@aipowersalon/customers';

// ── counters ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Velocity counters, read from the data we ALREADY write.
 *
 * No new counter store, no Redis dependency for this path: `booking_verification_sessions` already records every
 * code request with its tenant, phone hash, status and timestamp. The signals the risk engine needs are a
 * handful of `count(*)` queries over a table that exists.
 *
 * A second counter store would be a second thing to keep in sync, and the first time they disagreed the risk
 * engine would be scoring a world that never happened.
 */
export class KyselyRiskCounters {
  constructor(private readonly db: AppDatabase | null) {}

  /** The tenant's home country, for destination scoring. Defaults to US. */
  homeCountry(_tenantId: string): string {
    return process.env.PLATFORM_HOME_COUNTRY_CODE || '1';
  }

  async read(tenantId: string, ip: string, device: string, phoneE164: string): Promise<Omit<RiskSignals, 'destination'>> {
    const empty: Omit<RiskSignals, 'destination'> = {
      ipCodesLastHour: 0, ipDistinctPhonesLastHour: 0, deviceCodesLastHour: 0,
      ipFailedChecksLastHour: 0, abandonedHoldsLastHour: 0, phoneCodesLastHour: 0,
      novelCountryForTenant: false,
    };
    if (!this.db) return empty;

    const hash = phoneE164 ? phoneKey(phoneE164) : '';

    // NOTE the failure mode, and that it is the SAFE direction. If these counters cannot be read we return zeros,
    // which the risk engine scores as `allow`. That is deliberate: refusing every booking at every salon because a
    // COUNT timed out would be a self-inflicted outage, and it would be triggered by exactly the kind of load an
    // attack produces — handing them a denial-of-service for free.
    //
    // The hard caps (10 codes/IP/hour, 5/device/hour, across every salon) are enforced in BookingVerificationService.send
    // and do NOT depend on this query, so the floor stays in place even when the scoring does not.
    try {
      const r: any = await sql`
        SELECT
          -- request_ip / device_id (migration 370). My first version compared correlation_id::text against an IP
          -- -- and correlation_id is a UUID. An IP is not a UUID, so that predicate could NEVER match, and every
          -- IP signal was permanently 0. Same failure as the POS badge that counted an impossible status: a query
          -- that cannot be true, returning 0 forever, with nothing to say it is broken.
          (SELECT count(*)::int FROM booking_verification_sessions
             WHERE tenant_id = ${tenantId} AND request_ip = ${ip}
               AND created_at > now() - interval '1 hour')                                   AS ip_codes,
          (SELECT count(DISTINCT phone_hash)::int FROM booking_verification_sessions
             WHERE tenant_id = ${tenantId} AND request_ip = ${ip}
               AND created_at > now() - interval '1 hour')                                   AS ip_phones,
          (SELECT count(*)::int FROM booking_verification_sessions
             WHERE tenant_id = ${tenantId} AND device_id = ${device}
               AND created_at > now() - interval '1 hour')                                   AS device_codes,
          -- Phase 4 (audit): this summed EVERY failed/locked session at the salon — not this IP's — so one guesser
          -- raised the score of every honest customer, and a guesser on a still-open session counted nothing. It is
          -- now the wrong codes entered on sessions requested from THIS address (a proof's one right attempt excluded).
          (SELECT coalesce(sum(attempt_count - CASE WHEN status = 'verified' AND override_at IS NULL THEN 1 ELSE 0 END), 0)::int
             FROM booking_verification_sessions
             WHERE tenant_id = ${tenantId} AND request_ip = ${ip}
               AND updated_at > now() - interval '1 hour')                                   AS failed_checks,
          (SELECT count(*)::int FROM booking_holds
             WHERE tenant_id = ${tenantId} AND released_at IS NOT NULL
               AND converted_appointment_id IS NULL
               AND created_at > now() - interval '1 hour')                                   AS abandoned_holds,
          (SELECT count(*)::int FROM booking_verification_sessions
             WHERE tenant_id = ${tenantId} AND phone_hash = ${hash}
               AND created_at > now() - interval '1 hour')                                   AS phone_codes,
          -- Phase 4: a destination country this salon has never had a customer from (it has customers, none with this
          -- calling code). A salon with no customers yet has no history to be novel against.
          (SELECT EXISTS (SELECT 1 FROM customers WHERE tenant_id = ${tenantId} AND normalized_phone IS NOT NULL)
              AND NOT EXISTS (SELECT 1 FROM customers WHERE tenant_id = ${tenantId} AND normalized_phone LIKE ${'+' + (callingCode(phoneE164) ?? '') + '%'}))
                                                                                              AS novel_country
      `.execute(this.db as any);

      const row = r.rows?.[0] ?? {};
      return {
        ipCodesLastHour: Number(row.ip_codes ?? 0),
        ipDistinctPhonesLastHour: Number(row.ip_phones ?? 0),
        deviceCodesLastHour: Number(row.device_codes ?? 0),
        ipFailedChecksLastHour: Number(row.failed_checks ?? 0),
        abandonedHoldsLastHour: Number(row.abandoned_holds ?? 0),
        phoneCodesLastHour: Number(row.phone_codes ?? 0),
        novelCountryForTenant: !!phoneE164 && row.novel_country === true,
      };
    } catch {
      return empty;
    }
  }

  /** Record a refusal for the fraud console. Never contains a phone number or a code. */
  async recordAlert(tenantId: string, alert: { action: string; reasons: string[]; score: number; ip: string }): Promise<void> {
    if (!this.db) return;
    await sql`
      INSERT INTO audit_logs (tenant_id, role, action_type, entity_type, ip_address, metadata_json)
      VALUES (${tenantId}, 'SYSTEM', 'booking_verification.blocked', 'booking_verification', ${alert.ip || null},
              ${JSON.stringify({ action: alert.action, reasons: alert.reasons, score: alert.score })}::jsonb)
    `.execute(this.db as any).catch(() => undefined);
  }
}

// ── CAPTCHA ─────────────────────────────────────────────────────────────────────────────────────────────
//
// An ADAPTER, per the spec, and it is right to insist: CAPTCHA vendors get switched more often than almost any
// other dependency — pricing, privacy law, accessibility complaints, an outage. Coupling booking, the thing that
// makes the salon money, to one vendor's uptime is a bad trade.

/** Cloudflare Turnstile / hCaptcha — same siteverify shape. */
export class SiteverifyCaptcha implements CaptchaVerifier {
  constructor(
    readonly provider: string,
    private readonly url: string,
    private readonly secret: string,
    private readonly http: typeof fetch = fetch,
  ) {}

  async verify(token: string, remoteIp?: string | null): Promise<boolean> {
    if (!token || !this.secret) return false;
    try {
      const body = new URLSearchParams({ secret: this.secret, response: token });
      if (remoteIp) body.set('remoteip', remoteIp);
      const res = await this.http(this.url, { method: 'POST', body });
      if (!res.ok) return false;
      const j: any = await res.json().catch(() => ({}));
      return j?.success === true;
    } catch {
      // FAILS CLOSED. A CAPTCHA we could not check is a CAPTCHA that was not passed. Returning `true` on a
      // provider outage would turn every challenged request — which is to say, every request the risk engine
      // thought was probably an attack — into an allowed one, at exactly the moment we are least able to see.
      return false;
    }
  }
}

/**
 * Build the verifier from the environment.
 *
 * With nothing configured you get NULL, and the send route's `screen()` then refuses any request it wanted to
 * challenge. That is deliberate and it is the whole reason the risk engine is not decorative: a challenge we
 * cannot perform is a challenge that was not passed.
 */
export function makeCaptchaVerifier(env: NodeJS.ProcessEnv = process.env): CaptchaVerifier | null {
  const secret = env.CAPTCHA_SECRET_KEY;
  if (!secret) return null;
  const provider = (env.CAPTCHA_PROVIDER || 'turnstile').toLowerCase();
  const url =
    provider === 'hcaptcha' ? 'https://api.hcaptcha.com/siteverify'
    : provider === 'recaptcha' ? 'https://www.google.com/recaptcha/api/siteverify'
    : 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
  return new SiteverifyCaptcha(provider, url, secret);
}

/**
 * Phase 4: what a client needs to SHOW the challenge (the audit found the risk engine demanding a CAPTCHA no client
 * could render — every challenged request was simply refused). Public on purpose: a site key is meant for browsers.
 * `provider: null` = the platform has no CAPTCHA configured (challenged requests are then refused, honestly).
 */
export type { CaptchaClientConfig };
export function captchaClientConfig(env: NodeJS.ProcessEnv = process.env): CaptchaClientConfig {
  const siteKey = String(env.CAPTCHA_SITE_KEY ?? '').trim();
  if (!siteKey || !env.CAPTCHA_SECRET_KEY) return { provider: null, siteKey: null };
  const p = (env.CAPTCHA_PROVIDER || 'turnstile').toLowerCase();
  return { provider: p === 'hcaptcha' ? 'hcaptcha' : p === 'recaptcha' ? 'recaptcha' : 'turnstile', siteKey };
}
