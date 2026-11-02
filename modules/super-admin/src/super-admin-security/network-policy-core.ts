// network-policy-core.ts — Security Deep Scan §136 / §29: the Super Admin network policy, as pure logic.
//
// WHAT WAS WRONG. ip_block_rules (blocks + an allowlist) were stored, validated and audited by the Super Admin Security
// screen — and never read by anything in the request path. A "blocked" address could still sign in to the platform.
//
// THE RULE (decidePlatformAccess), applied to the /super-admin realm, the platform sign-in and every SUPER_ADMIN session:
//   1. loopback / unspecified / link-local always pass (an operator on the box is the last-resort way in);
//   2. an address inside the ALLOWLIST (the DB allowlist rows ∪ SUPER_ADMIN_IP_ALLOWLIST) is never refused as "blocked" —
//      the same protected-source rule the block screen already applies when a block is created (ip-block-core);
//   3. an address inside an ACTIVE block rule (status blocked, not past expires_at) is refused  → reason 'blocked';
//   4. when the allowlist is NON-EMPTY, an address outside it is refused                     → reason 'not_allowlisted'.
//      An EMPTY allowlist means "no allowlist" — never "allow nobody" (fail-safe: no configuration cannot lock everyone out).
// An unknown client address passes rule 3 (nothing to match) and is refused by rule 4 only when an allowlist exists
// (membership cannot be proven).
//
// Matching uses node's net.BlockList, so IPv4 and IPv6 exact addresses AND CIDR ranges both match (the older
// ip-block-core containment is IPv4-only). Invalid entries are dropped (and reported by parseAllowlistEnv).
import { BlockList, isIPv4, isIPv6 } from 'node:net';
import { isReservedOrLoopback, validateBlockTarget, isBlockExpired } from './ip-block-core';

export type NetworkPolicyMode = 'enforce' | 'report' | 'off';
export interface NetworkBlockRule { target: string; expiresAt: string | null }
export interface NetworkRules { blocks: NetworkBlockRule[]; allowlist: string[] }
export type PlatformAccessDecision =
  | { allowed: true; reason: 'loopback' | 'allowlisted' | 'no_policy' | 'not_blocked' }
  | { allowed: false; reason: 'blocked' | 'not_allowlisted'; rule?: string };

const strip = (ip: string) => String(ip || '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');

/** Does `ip` fall inside `target` (an exact address or a CIDR, IPv4 or IPv6)? Invalid input → false. */
export function ipMatches(ip: string | null | undefined, target: string): boolean {
  const addr = strip(String(ip ?? ''));
  const fam = isIPv4(addr) ? 'ipv4' : isIPv6(addr) ? 'ipv6' : null;
  if (!fam) return false;
  const t = String(target || '').trim();
  const [net, prefixStr] = t.split('/');
  const tfam = isIPv4(net) ? 'ipv4' : isIPv6(net) ? 'ipv6' : null;
  if (!tfam || tfam !== fam) return false;
  const bl = new BlockList();   // both addresses were validated above (isIPv4 / isIPv6), so BlockList does not throw
  if (prefixStr === undefined) bl.addAddress(net, tfam);
  else { const p = Number(prefixStr); if (!Number.isInteger(p) || p < 0 || p > (tfam === 'ipv4' ? 32 : 128)) return false; bl.addSubnet(net, p, tfam); }
  return bl.check(addr, fam);
}

/** SUPER_ADMIN_IP_ALLOWLIST: comma / whitespace separated IPs or CIDRs. Returns the valid entries and the rejected ones. */
export function parseAllowlistEnv(raw: string | undefined | null): { entries: string[]; invalid: string[] } {
  const entries: string[] = []; const invalid: string[] = [];
  for (const part of String(raw ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)) {
    const v = validateBlockTarget(part);
    if (v.ok) entries.push(v.normalized); else invalid.push(part);
  }
  return { entries, invalid };
}

/** SUPER_ADMIN_NETWORK_POLICY: enforce (default) | report (log + event, never refuse) | off (break-glass). */
export function networkPolicyMode(env: Record<string, string | undefined> = process.env): NetworkPolicyMode {
  const v = String(env.SUPER_ADMIN_NETWORK_POLICY ?? '').trim().toLowerCase();
  return v === 'off' || v === 'report' ? v : 'enforce';
}

/** The decision for one client address. Pure; `nowMs` decides block expiry. */
export function decidePlatformAccess(ip: string | null | undefined, rules: NetworkRules, nowMs: number): PlatformAccessDecision {
  const addr = ip ? strip(ip) : '';
  if (addr && isReservedOrLoopback(addr)) return { allowed: true, reason: 'loopback' };
  const allow = rules.allowlist.filter(Boolean);
  const inAllow = !!addr && allow.some((t) => ipMatches(addr, t));
  if (inAllow) return { allowed: true, reason: 'allowlisted' };
  if (addr) {
    const hit = rules.blocks.find((b) => !isBlockExpired(b.expiresAt, nowMs) && ipMatches(addr, b.target));
    if (hit) return { allowed: false, reason: 'blocked', rule: hit.target };
  }
  if (allow.length > 0) return { allowed: false, reason: 'not_allowlisted' };
  return { allowed: true, reason: rules.blocks.length ? 'not_blocked' : 'no_policy' };
}

/** Would adding `target` to the allowlist lock out the admin doing it (`actorIp`)? Only meaningful when the actor's
 *  address is known and not loopback; used by IpBlockService.addAllowlist when the lockout guard is on. */
export function allowlistWouldLockOut(actorIp: string | null | undefined, currentAllowlist: string[], target: string): boolean {
  const ip = actorIp ? strip(actorIp) : '';
  if (!ip || isReservedOrLoopback(ip) || !(isIPv4(ip) || isIPv6(ip))) return false;
  return ![...currentAllowlist, target].some((t) => ipMatches(ip, t));
}
