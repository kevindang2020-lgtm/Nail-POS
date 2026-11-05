// Pure logic for IP blocking. No DB/Nest deps. Validates IPv4/IPv6 + CIDR syntax, performs IPv4 CIDR containment, and —
// critically — refuses to block protected sources (loopback/reserved, allowlisted, and configured trusted/office/
// health-check/emergency ranges) so a block can never lock out administrators or monitoring. Controlled threat/status
// vocabularies; expiration logic. The block itself is written + audited in the repo.

export const THREAT_TYPES = ['brute_force', 'malware', 'sql_injection', 'credential_stuffing', 'known_bot', 'suspicious_proxy', 'abuse_source', 'manual_block'] as const;
export const BLOCK_STATUSES = ['blocked', 'expired', 'under_review', 'allowed', 'whitelisted'] as const;
export type BlockStatus = (typeof BLOCK_STATUSES)[number];

export function normalizeThreatType(t: string): string {
  const v = String(t || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (THREAT_TYPES as readonly string[]).includes(v) ? v : 'manual_block';
}

function ipv4Octets(ip: string): number[] | null {
  const p = ip.split('.');
  if (p.length !== 4) return null;
  const nums = p.map((o) => (/^\d{1,3}$/.test(o) ? Number(o) : -1));
  return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
}
function isIpv6(ip: string): boolean {
  if (!ip.includes(':')) return false;
  // Accept the common forms (full, compressed ::). Groups are 1-4 hex digits.
  return /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(ip) && (ip.match(/::/g) || []).length <= 1;
}

export type TargetResult = { ok: true; kind: 'exact' | 'cidr'; version: 4 | 6; normalized: string } | { ok: false; reason: string };
export function validateBlockTarget(target: string): TargetResult {
  const s = String(target || '').trim();
  if (!s) return { ok: false, reason: 'IP or CIDR is required' };
  if (s.includes('/')) {
    const [ip, prefixStr] = s.split('/');
    const prefix = Number(prefixStr);
    if (ipv4Octets(ip)) { if (!(prefix >= 0 && prefix <= 32)) return { ok: false, reason: 'IPv4 CIDR prefix must be 0–32' }; return { ok: true, kind: 'cidr', version: 4, normalized: `${ip}/${prefix}` }; }
    if (isIpv6(ip)) { if (!(prefix >= 0 && prefix <= 128)) return { ok: false, reason: 'IPv6 CIDR prefix must be 0–128' }; return { ok: true, kind: 'cidr', version: 6, normalized: `${ip}/${prefix}` }; }
    return { ok: false, reason: 'invalid CIDR address' };
  }
  if (ipv4Octets(s)) return { ok: true, kind: 'exact', version: 4, normalized: s };
  if (isIpv6(s)) return { ok: true, kind: 'exact', version: 6, normalized: s };
  return { ok: false, reason: 'invalid IP address' };
}

// IPv4 containment (int + mask). IPv6 containment is exact-match only here (documented limitation).
function ipv4ToInt(ip: string): number | null { const o = ipv4Octets(ip); return o ? ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3] : null; }
export function ipv4InCidr(ip: string, cidr: string): boolean {
  const [net, prefixStr] = cidr.split('/'); const prefix = Number(prefixStr);
  const a = ipv4ToInt(ip), b = ipv4ToInt(net);
  if (a == null || b == null || !(prefix >= 0 && prefix <= 32)) return false;
  if (prefix === 0) return true;
  const mask = prefix === 32 ? 0xffffffff : (~((1 << (32 - prefix)) - 1)) >>> 0;
  return (a & mask) === (b & mask);
}

// Always-protected: loopback, unspecified, link-local. (Private ranges are treated as protected via configured allowlist,
// since offices/health-checks commonly use them.)
export function isReservedOrLoopback(ip: string): boolean {
  const s = String(ip || '').trim().toLowerCase();
  if (s === '::1' || s === '::' || s.startsWith('fe80:')) return true;
  const o = ipv4Octets(s);
  if (!o) return false;
  return o[0] === 127 || (o[0] === 0) || (o[0] === 169 && o[1] === 254); // loopback / this-host / link-local
}

// The safety gate: is a target protected from blocking? Checks reserved/loopback, exact allowlist membership, and
// configured protected CIDRs (trusted monitoring / approved office / health-check / emergency-access ranges).
export function isProtectedSource(target: string, opts: { allowlist?: string[]; protectedCidrs?: string[] } = {}): { protected: boolean; reason?: string } {
  const t = validateBlockTarget(target);
  const ip = t.ok ? (t.kind === 'cidr' ? t.normalized.split('/')[0] : t.normalized) : target;
  if (isReservedOrLoopback(ip)) return { protected: true, reason: 'loopback/reserved address' };
  if ((opts.allowlist || []).map((a) => a.trim()).includes(ip)) return { protected: true, reason: 'address is allowlisted' };
  for (const cidr of opts.protectedCidrs || []) { if (ipv4InCidr(ip, cidr)) return { protected: true, reason: `within protected range ${cidr}` }; }
  return { protected: false };
}

export const STATUS_TRANSITIONS: Record<string, BlockStatus[]> = { blocked: ['expired', 'under_review', 'allowed'], under_review: ['blocked', 'allowed', 'whitelisted'], expired: ['blocked'], allowed: ['blocked'], whitelisted: ['blocked'] };
export function canBlockTransition(from: string, to: string): boolean { return (STATUS_TRANSITIONS[String(from || '').toLowerCase()] || []).includes(String(to || '').toLowerCase() as BlockStatus); }
export function isBlockExpired(expiresAt: string | null, nowMs: number): boolean { if (!expiresAt) return false; const t = Date.parse(expiresAt); return !Number.isNaN(t) && t <= nowMs; }
