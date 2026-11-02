// redaction.ts — Constitution 11 §22–28, §274, §395: ONE place that decides what may never appear in telemetry.
//
// Applied by the logger and by the exception filter, so a developer does not have to remember (§27). Two
// mechanisms, because secrets arrive two ways:
//   1. by KEY — an object field named password/token/cvv/… is replaced wherever it sits, at any depth;
//   2. by VALUE — a string that LOOKS like a secret (bearer token, card number, JWT) is masked even when it was
//      interpolated into a message, where no key can identify it.
//
// The lists are exported as data so the tests can iterate every prohibited field and prove it was removed
// (§28: "CI/tests should intentionally send sensitive fields through logger and verify they are removed").

export const REDACTED = '[REDACTED]';

/** §22 prohibited outright. Matched case-insensitively against the key, as a whole word or a suffix. */
export const SECRET_KEYS = [
  // NOT bare `code`/`pass`/`track`: those would redact error_code, status_code, zip_code, bypass, time_track —
  // the fields operations search BY (§33). Only the codes that are actually secrets are listed.
  'password', 'passwd', 'otp', 'otp_code', 'otpcode', 'verification_code', 'verificationcode', 'security_code',
  'access_code', 'accesscode', 'mfa_secret', 'mfasecret', 'mfa_code', 'mfacode', 'recovery_code', 'recoverycode', 'totp',
  'access_token', 'accesstoken', 'refresh_token', 'refreshtoken', 'token', 'id_token', 'jwt', 'api_key', 'apikey',
  'secret', 'client_secret', 'auth_token', 'authtoken', 'authorization', 'cookie', 'set-cookie', 'private_key',
  'privatekey', 'encryption_key', 'cvv', 'cvc', 'cvv2', 'pan', 'card_number', 'cardnumber', 'account_number',
  'routing_number', 'track1', 'track2', 'track_data', 'pin', 'pin_hash', 'ssn', 'tax_id', 'signature',
  // Security Deep Scan A12: provider-shaped key names the list missed
  'secret_key', 'secretkey', 'secret_access_key', 'secretaccesskey', 'signing_key', 'signingkey', 'hmac_key', 'hmackey',
  'credentials', 'passcode', 'auth_key', 'authkey', 'webhook_secret', 'webhooksecret', 'enc',
] as const;

/** §24–25 PII: masked rather than removed, because a masked value still identifies the record for support. */
export const PII_KEYS = ['phone', 'phone_number', 'phonenumber', 'mobile', 'email', 'address', 'address_line1', 'street'] as const;

/** §26: never logged automatically. */
export const AI_CONTENT_KEYS = ['prompt', 'system_prompt', 'systemprompt', 'completion', 'response_text', 'transcript', 'messages'] as const;

const secretKey = new RegExp(`(^|[_\\-.])(${SECRET_KEYS.join('|')})$`, 'i');
const piiKey = new RegExp(`(^|[_\\-.])(${PII_KEYS.join('|')})$`, 'i');
const aiKey = new RegExp(`^(${AI_CONTENT_KEYS.join('|')})$`, 'i');

// Value shapes. Card numbers are 13–19 digits, optionally separated; JWTs are three base64url segments;
// bearer tokens follow the word. Kept conservative — a false positive hides a debugging clue, a false negative
// leaks a credential, and the asymmetry favours masking.
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;   // digit-anchored at both ends: the separator is never the last char consumed
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]{8,}=*/gi;
const TWILIO_SID_SECRET = /\b(SK|AC)[0-9a-f]{32}:[A-Za-z0-9]{16,}\b/g;
// Security Deep Scan A12: raw provider key shapes in free text (OpenAI/Anthropic sk-…, SendGrid SG.…, AWS AKIA…, private keys)
const PROVIDER_KEYS = /\b(sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}|(?:AKIA|ASIA)[0-9A-Z]{16}|rk_live_[A-Za-z0-9]{16,}|xox[abpr]-[A-Za-z0-9-]{10,})\b/g;
// Security Deep Scan §128: the platform's OWN bearer tokens — refresh tokens (rt_), the "This wasn't me" link (nm_), the
// platform device-approval link (pda_) — are opaque random strings no other rule recognises
const PLATFORM_TOKENS = /\b(?:rt|nm|pda)_[A-Za-z0-9_-]{24,}/g;
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g;

export function maskValueSecrets(s: string): string {
  return s.replace(PRIVATE_KEY_BLOCK, REDACTED).replace(JWT, REDACTED).replace(BEARER, `$1 ${REDACTED}`).replace(TWILIO_SID_SECRET, REDACTED).replace(PROVIDER_KEYS, REDACTED).replace(PLATFORM_TOKENS, REDACTED).replace(CARD, (m) => {
    const digits = m.replace(/\D/g, '');
    return digits.length >= 13 && luhn(digits) ? `****${digits.slice(-4)}` : m;   // Luhn keeps order numbers and timestamps intact
  });
}

function luhn(d: string): boolean {
  let sum = 0, dbl = false;
  for (let i = d.length - 1; i >= 0; i--) { let n = Number(d[i]); if (dbl) { n *= 2; if (n > 9) n -= 9; } sum += n; dbl = !dbl; }
  return sum % 10 === 0;
}

export function maskPhone(v: string): string { const d = v.replace(/\D/g, ''); return d.length >= 4 ? `***${d.slice(-4)}` : '***'; }
export function maskEmail(v: string): string { const [u, dom] = v.split('@'); return dom ? `${(u || '').slice(0, 1)}***@${dom}` : '***'; }

const MAX_DEPTH = 12;

/**
 * Returns a deep copy with secrets removed and PII masked. Never throws — a redactor that throws on a weird
 * object would either lose the log line or, worse, let a caller fall back to logging the raw object.
 */
export function redact<T>(value: T, depth = 0, seen = new WeakSet<object>()): T {
  try {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return maskValueSecrets(value) as T;
    if (typeof value !== 'object') return value;
    if (depth > MAX_DEPTH) return '[TRUNCATED]' as T;
    if (seen.has(value as object)) return '[CIRCULAR]' as T;
    seen.add(value as object);
    if (value instanceof Error) {
      return { name: value.name, message: maskValueSecrets(value.message), stack: value.stack ? maskValueSecrets(value.stack) : undefined } as T;
    }
    if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen)) as T;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Keys are matched on a normalised form: `X-Api-Key` → `x_api_key`, so header casing and hyphens cannot
      // slip a secret past a list written in snake_case. (A test with X-Api-Key found exactly that gap.)
      const nk = k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/-/g, '_').toLowerCase();   // twilioAuthToken → twilio_auth_token
      if (secretKey.test(nk)) out[k] = REDACTED;
      else if (aiKey.test(nk)) out[k] = '[AI_CONTENT_OMITTED]';
      else if (piiKey.test(nk) && typeof v === 'string') out[k] = /email/.test(nk) ? maskEmail(v) : maskPhone(v);
      else out[k] = redact(v, depth + 1, seen);
    }
    return out as T;
  } catch {
    return '[UNREDACTABLE]' as T;
  }
}
