import type { ApiKeyStatus, WebhookStatus } from '@aipowersalon/api-contracts/tenant';
export type { ApiKeyStatus, WebhookStatus };   // owned by packages/api-contracts (Constitution 13 §13)
// api-webhooks-core.ts — PURE helpers for tenant API keys + outbound webhooks. No IO and no randomness here:
// secret generation/hashing lives in the service (node crypto); this module only does deterministic, testable logic —
// status derivation, masking, SSRF-safe URL validation, scope/event validation, and key composition from an
// already-random token. Raw secrets are NEVER returned by anything in this file except composeKey's `raw`, which the
// service surfaces exactly once and never stores.


export function keyStatus(k: { revokedMs: number | null; expiresMs: number | null }, nowMs: number): ApiKeyStatus {
  if (k.revokedMs != null) return 'revoked';
  if (k.expiresMs != null && k.expiresMs <= nowMs) return 'expired';
  return 'active';
}

export function maskedKey(prefix: string): string {
  return `${prefix}${'•'.repeat(8)}`;
}

const SCOPE_RE = /^[a-z][a-z0-9_.:-]*$/;
const EVENT_RE = /^[a-z][a-z0-9_.]*$/;
export const isValidScope = (s: string): boolean => SCOPE_RE.test(s);
export const isValidEvent = (e: string): boolean => EVENT_RE.test(e);

// composeKey: build the displayable raw key + its identifying prefix from an env and an already-random token.
// raw = 'ak_<env>_<token>'; prefix = 'ak_<env>_<first 4 of token>'. The service hashes `raw` and stores hash+prefix.
export function composeKey(environment: string, randomToken: string): { raw: string; prefix: string } {
  const env = environment === 'test' ? 'test' : 'live';
  const raw = `ak_${env}_${randomToken}`;
  const prefix = `ak_${env}_${randomToken.slice(0, 4)}`;
  return { raw, prefix };
}

// isSafeWebhookUrl: SSRF guard. Must be https to a public host. Rejects loopback, link-local (incl. the cloud
// metadata IP 169.254.169.254), and RFC-1918 / unique-local private ranges.
export function isSafeWebhookUrl(url: string): { ok: boolean; reason?: string } {
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, reason: 'Invalid URL' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'URL must use https' };
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return { ok: false, reason: 'Loopback host not allowed' };
  if (host === '::1' || host === '0.0.0.0') return { ok: false, reason: 'Loopback/unspecified host not allowed' };
  // IPv4 literal ranges
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127) return { ok: false, reason: 'Loopback address not allowed' };
    if (a === 10) return { ok: false, reason: 'Private address not allowed' };
    if (a === 192 && b === 168) return { ok: false, reason: 'Private address not allowed' };
    if (a === 172 && b >= 16 && b <= 31) return { ok: false, reason: 'Private address not allowed' };
    if (a === 169 && b === 254) return { ok: false, reason: 'Link-local/metadata address not allowed' };
    if (a === 0) return { ok: false, reason: 'Unspecified address not allowed' };
  }
  // IPv6 unique-local (fc00::/7) / link-local (fe80::/10)
  if (/^\[?f[cd][0-9a-f]{2}:/i.test(host) || /^\[?fe80:/i.test(host)) return { ok: false, reason: 'Private IPv6 address not allowed' };
  return { ok: true };
}

export function normalizeScopes(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((x) => String(x).trim().toLowerCase()).filter((x) => x && isValidScope(x)))];
}
export function normalizeEvents(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((x) => String(x).trim().toLowerCase()).filter((x) => x && isValidEvent(x)))];
}

/* Constitution 12 §72 (SSRF): the text check above cannot see where a HOSTNAME resolves. `evil.example` may resolve to
 * 10.0.0.5 or to the cloud metadata address. This resolves the host and refuses if ANY address is private, loopback,
 * link-local or unspecified. HONEST LIMIT: fetch() resolves the name again itself, so a DNS answer that CHANGES between
 * this check and the connection (rebinding) is not stopped here; pinning the connection to the checked address needs a
 * custom agent and is listed as a remaining risk. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::' || v6 === '::1') return true;
  if (v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')) return true;           // unique-local, link-local
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));                            // IPv4-mapped
  return false;
}
export async function isSafeWebhookUrlResolved(url: string, lookup: (host: string) => Promise<string[]> = defaultLookup): Promise<{ ok: boolean; reason?: string }> {
  const text = isSafeWebhookUrl(url);
  if (!text.ok) return text;
  let addrs: string[];
  try { addrs = await lookup(new URL(url).hostname); } catch { return { ok: false, reason: 'Host does not resolve' }; }
  if (!addrs.length) return { ok: false, reason: 'Host does not resolve' };
  const bad = addrs.find(isPrivateAddress);
  return bad ? { ok: false, reason: `Host resolves to a private address` } : { ok: true };
}
async function defaultLookup(host: string): Promise<string[]> {
  const { lookup } = await import('node:dns/promises');
  return (await lookup(host, { all: true })).map((a) => a.address);
}
