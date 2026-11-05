// sanitize.ts — Constitution 6 §18 / Phase 13 hard rule: no secret, token or payment detail in any persisted cache or
// journal. Field names are split into words (camelCase, snake_case, kebab-case) and a field is dropped when a word — or
// a two-word pair — names a secret. Whole-word matching keeps `footprint`, `pinned`, `shipping`.
const WORDS = new Set(['token', 'tokens', 'secret', 'password', 'passcode', 'pin', 'otp', 'cvv', 'cvc', 'pan', 'ssn', 'iban',
  'authorization', 'cookie', 'cookies', 'bearer', 'apikey', 'credential', 'credentials', 'last4', 'track1', 'track2']);
const PAIRS = new Set(['card number', 'account number', 'routing number', 'private key', 'api key', 'card exp', 'card expiry', 'security code', 'verification code', 'payment intent', 'payment method', 'payment methods', 'payment token']);
function words(key: string): string[] {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
export function isSecretField(key: string): boolean {
  const w = words(key);
  for (let i = 0; i < w.length; i++) {
    if (WORDS.has(w[i])) return true;
    if (i + 1 < w.length && PAIRS.has(`${w[i]} ${w[i + 1]}`)) return true;
  }
  return false;
}
/** A deep copy without secret-named fields. */
export function stripSecrets<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => stripSecrets(x)) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!isSecretField(k)) out[k] = stripSecrets(x);
    return out as T;
  }
  return v;
}
/** Paths of secret-named fields (empty = clean). */
export function findSecretPaths(v: unknown, path = ''): string[] {
  const out: string[] = [];
  if (Array.isArray(v)) v.forEach((x, i) => out.push(...findSecretPaths(x, path ? `${path}.${i}` : String(i))));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const p = path ? `${path}.${k}` : k;
    if (isSecretField(k)) out.push(p); else out.push(...findSecretPaths(x, p));
  }
  return out;
}
