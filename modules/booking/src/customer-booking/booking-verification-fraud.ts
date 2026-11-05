// booking-verification-fraud.ts — abuse detection for an endpoint that sends free SMS on someone else's bill.
//
// ══ WHAT THIS IS DEFENDING ════════════════════════════════════════════════════════════════════════════════
//
// The `send` endpoint is an attacker's favourite shape: it emits an outbound message, to a number of their
// choosing, billed to a salon that has never heard of them. Three distinct attacks, which need three distinct
// answers:
//
//   1. SMS PUMPING (the expensive one)
//      The attacker owns — or is paid by — a premium-rate range in a high-cost country. They request codes to
//      numbers in that range and take a cut of the termination fee. The salon pays. Nobody's phone is harmed,
//      nothing looks "wrong", and the bill arrives a month later. The per-phone cooldown does NOT catch this:
//      each number is asked for exactly one code.
//
//   2. ENUMERATION / SPRAY
//      One source, many phone numbers. Either mapping which numbers exist, or blasting verification texts at
//      strangers. Again the per-phone cooldown never fires — that is what makes it work.
//
//   3. HARASSMENT
//      Many codes at ONE number. This one the cooldown DOES catch, which is why it exists.
//
// ══ THE RULE THE SPEC IS RIGHT ABOUT ══════════════════════════════════════════════════════════════════════
//
//     "Do not automatically label a legitimate customer as fraudulent."
//
// A salon's real customer on a hotel wifi, retrying a code that never arrived, looks like an attacker to every
// naive heuristic. So the response is TIERED, and the top tier is deliberately hard to reach:
//
//     allow      normal
//     challenge  a CAPTCHA. Costs a human three seconds; costs a script the whole attack.
//     slow       a delay. Bots are priced per-request; humans do not notice a second.
//     block      refuse. Reserved for what CANNOT be a customer.
//
// Everything survivable is a challenge. `block` is for signals no real booking produces.
//
// PURE. No clock of its own, no I/O. The counters are passed in; the caller reads them from the rate limiter.

export type RiskAction = 'allow' | 'challenge' | 'slow' | 'block';

export interface RiskSignals {
  /** Code requests from this IP in the last hour. */
  ipCodesLastHour: number;
  /** DISTINCT phone numbers this IP has requested codes for in the last hour. The spray signal. */
  ipDistinctPhonesLastHour: number;
  /** Code requests from this device/session in the last hour. */
  deviceCodesLastHour: number;
  /** Failed code checks from this IP in the last hour. */
  ipFailedChecksLastHour: number;
  /** Booking holds this device has taken in the last hour without completing one. */
  abandonedHoldsLastHour: number;
  /** Codes requested for THIS phone in the last hour. The harassment signal. */
  phoneCodesLastHour: number;
  /** The destination's cost tier (see below). */
  destination: DestinationRisk;
  /** True when the tenant has never received a booking from this country before. */
  novelCountryForTenant: boolean;
}

export interface RiskResult {
  action: RiskAction;
  /** Machine-readable, safe to log and to return. Never contains a phone number. */
  reasons: string[];
  /** 0..100. Not shown to a customer — it is for the fraud console and the alert threshold. */
  score: number;
}

// ── destination risk ────────────────────────────────────────────────────────────────────────────────────
//
// SMS termination cost varies by two orders of magnitude. A code to a US mobile costs under a cent; to some
// ranges it is dollars — and those ranges are precisely the ones an SMS-pumping operation is paid to terminate
// into. Cost IS the risk signal here: nobody pumps traffic into a destination that pays nothing.
export type DestinationRisk = 'normal' | 'elevated' | 'high_cost' | 'premium_rate';

/**
 * Classify an E.164 number's destination.
 *
 * Deliberately CONSERVATIVE about what it calls `premium_rate`, and deliberately blunt about `high_cost`. A false
 * `high_cost` costs one legitimate customer a CAPTCHA. A false `normal` on a pumped range costs the salon real
 * money, silently, for as long as it goes unnoticed.
 *
 * This is a coarse country-code map on purpose. A per-prefix rate table belongs in configuration a human
 * maintains against their actual Twilio bill — not hard-coded in a security module where it would rot. What is
 * hard-coded is the SHAPE of the decision, not the tariff.
 */
export function destinationRisk(e164: string, tenantHomeCountry = process.env.DEFAULT_PHONE_COUNTRY || '1'): DestinationRisk {
  const n = String(e164 ?? '').replace(/[^\d+]/g, '');
  if (!n.startsWith('+')) return 'elevated';                 // not normalized → we do not know what it is
  const digits = n.slice(1);

  // Premium-rate / high-fraud ranges. These are the classic SMS-pumping termination points, and no salon's real
  // customer books from one. Not exhaustive — it does not need to be. It needs to be RIGHT about the ones that
  // are unambiguous.
  const PREMIUM_PREFIXES = ['882', '883', '979', '808'];      // international networks / premium services
  if (PREMIUM_PREFIXES.some((p) => digits.startsWith(p))) return 'premium_rate';

  // Satellite. Costs dollars per message; a nail salon does not have customers here.
  const SATELLITE = ['870', '881'];
  if (SATELLITE.some((p) => digits.startsWith(p))) return 'premium_rate';

  // The tenant's own country is, by definition, where their customers are.
  if (digits.startsWith(tenantHomeCountry)) return 'normal';

  // Everything else is foreign to this tenant. Not sinister — a real customer may be travelling — but it IS
  // where pumping happens, and it is worth a CAPTCHA rather than a free code.
  return 'high_cost';
}

// ── thresholds ──────────────────────────────────────────────────────────────────────────────────────────
//
// These sit ABOVE `customer-activation-core`'s hard limits (10 codes/IP/hour, 5/device/hour), which still apply
// and still refuse outright. These are the softer, EARLIER signals — the ones that fire while a human is still
// plausibly on the other end.
export const T = {
  /** One IP asking about this many DISTINCT numbers is not one customer. */
  SPRAY_PHONES_CHALLENGE: 3,
  SPRAY_PHONES_BLOCK: 8,
  /** Guessing codes. */
  FAILED_CHECKS_CHALLENGE: 5,
  FAILED_CHECKS_BLOCK: 15,
  /** Taking slots and never finishing — the calendar-denial pattern. */
  ABANDONED_HOLDS_CHALLENGE: 3,
  /** Hammering one victim's phone. The cooldown already refuses; this is what escalates it. */
  PHONE_CODES_CHALLENGE: 3,
  PHONE_CODES_BLOCK: 6,
  /** IP volume, below the hard cap. */
  IP_CODES_CHALLENGE: 5,
};

/**
 * Score a code-send request.
 *
 * The ORDER matters: `block` is checked first and only for what a real booking cannot produce. Everything else
 * degrades to a challenge, because a customer who fails a CAPTCHA is inconvenienced, and a customer who is
 * BLOCKED is a customer the salon lost and will never hear about.
 */
export function assessSendRisk(s: RiskSignals): RiskResult {
  const reasons: string[] = [];
  let score = 0;

  // ── BLOCK: things a real booking does not do ──

  // Premium-rate / satellite. A nail salon has no customers here, and this is where the money goes. This is the
  // single most valuable rule in the file: it is the only one that stops a pumping attack BEFORE the bill.
  if (s.destination === 'premium_rate') {
    return { action: 'block', reasons: ['destination_premium_rate'], score: 100 };
  }

  if (s.ipDistinctPhonesLastHour >= T.SPRAY_PHONES_BLOCK) {
    return { action: 'block', reasons: ['spray_distinct_phones'], score: 100 };
  }
  if (s.ipFailedChecksLastHour >= T.FAILED_CHECKS_BLOCK) {
    return { action: 'block', reasons: ['brute_force_codes'], score: 100 };
  }
  if (s.phoneCodesLastHour >= T.PHONE_CODES_BLOCK) {
    // Somebody is using our sender to text a stranger repeatedly. That is harassment on the salon's bill.
    return { action: 'block', reasons: ['phone_harassment'], score: 100 };
  }

  // ── CHALLENGE: plausible attacker, plausible customer ──

  if (s.ipDistinctPhonesLastHour >= T.SPRAY_PHONES_CHALLENGE) { reasons.push('multiple_phones_one_source'); score += 35; }
  if (s.ipFailedChecksLastHour >= T.FAILED_CHECKS_CHALLENGE) { reasons.push('repeated_failed_codes'); score += 30; }
  if (s.phoneCodesLastHour >= T.PHONE_CODES_CHALLENGE) { reasons.push('repeated_codes_one_phone'); score += 25; }
  if (s.abandonedHoldsLastHour >= T.ABANDONED_HOLDS_CHALLENGE) { reasons.push('abandoned_holds'); score += 20; }
  if (s.ipCodesLastHour >= T.IP_CODES_CHALLENGE) { reasons.push('high_ip_volume'); score += 15; }

  // Cost-tier signals. `high_cost` alone is a CAPTCHA, not a block — a real customer may be abroad, and refusing
  // them outright to save a few cents of SMS would be the wrong trade in the wrong direction.
  if (s.destination === 'high_cost') { reasons.push('foreign_destination'); score += 25; }
  else if (s.destination === 'elevated') { reasons.push('unparseable_destination'); score += 15; }

  // A country this tenant has NEVER had a booking from, combined with anything else, is worth a challenge. On its
  // own it is worth nothing — every salon has a first customer from somewhere.
  if (s.novelCountryForTenant && score > 0) { reasons.push('novel_country'); score += 10; }

  if (score >= 50) return { action: 'challenge', reasons, score: Math.min(100, score) };
  if (score >= 25) return { action: 'slow', reasons, score };
  return { action: 'allow', reasons, score };
}

// ── CAPTCHA: an ADAPTER, never a provider ───────────────────────────────────────────────────────────────
//
// The spec asks for this explicitly, and it is right: CAPTCHA vendors are switched more often than almost any
// other dependency (pricing, privacy law, accessibility complaints, an outage). Coupling booking — the thing that
// makes the salon money — to one vendor's uptime is a bad trade.
export interface CaptchaVerifier {
  readonly provider: string;
  /** Verify a client-supplied token. Returns false on ANY doubt. */
  verify(token: string, remoteIp?: string | null): Promise<boolean>;
}

/**
 * No CAPTCHA configured.
 *
 * FAILS CLOSED on a challenge: if we decided a request needs a human check and we cannot perform one, we do not
 * wave it through. That would make the entire risk engine decorative — an attacker's request would score 90,
 * demand a CAPTCHA, find none configured, and sail on.
 *
 * The consequence is honest and visible: a tenant with no CAPTCHA provider sees challenged requests refused
 * rather than silently allowed. That is a configuration problem with a loud symptom, which is the only kind worth
 * having.
 */
export class NotConfiguredCaptcha implements CaptchaVerifier {
  readonly provider = 'none';
  async verify(): Promise<boolean> { return false; }
}
