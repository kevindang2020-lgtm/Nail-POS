// network-policy.ts — Security Deep Scan §136 / §29: the cached Super Admin network policy (rules in network-policy-core).
//
// SOURCES: ip_block_rules (active blocks + allowlist rows, managed on Super Admin → Security → IP blocks) and the
// SUPER_ADMIN_IP_ALLOWLIST environment variable (IPs / CIDRs). The allowlist is the UNION of both.
// CACHE: the DB rules are read at most once per TTL (default 15 s, NETWORK_POLICY_CACHE_MS) per process; a rule change
// made through IpBlockService invalidates THIS process at once, other replicas within one TTL.
// FAILURE: a DB error keeps the last rules that loaded (none on a cold start → only the env allowlist applies) — the
// policy fails OPEN on the database, never closed: a DB outage must not lock every administrator out.
// BREAK-GLASS: SUPER_ADMIN_NETWORK_POLICY=off disables enforcement (report = record refusals, refuse nothing);
// loopback is always admitted. See docs/security/SUPER_ADMIN_NETWORK_POLICY.md.
import { decidePlatformAccess, networkPolicyMode, parseAllowlistEnv, type NetworkRules, type PlatformAccessDecision, type NetworkPolicyMode } from './network-policy-core';

export interface NetworkRulesSource { networkRules(): Promise<NetworkRules> }
export const DEFAULT_NETWORK_POLICY_CACHE_MS = 15_000;

export class PlatformNetworkPolicy {
  private rules: NetworkRules | null = null;
  private loadedAt = 0;
  private inflight: Promise<NetworkRules> | null = null;
  private readonly ttlMs: number;
  readonly envAllowlist: string[];
  readonly envInvalid: string[];
  constructor(
    private readonly source: NetworkRulesSource | null,
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly now: () => number = Date.now,
  ) {
    const p = parseAllowlistEnv(env.SUPER_ADMIN_IP_ALLOWLIST);
    this.envAllowlist = p.entries; this.envInvalid = p.invalid;
    const t = Number(env.NETWORK_POLICY_CACHE_MS);
    this.ttlMs = Number.isFinite(t) && t >= 0 && t <= 300_000 ? t : DEFAULT_NETWORK_POLICY_CACHE_MS;
  }

  mode(): NetworkPolicyMode { return networkPolicyMode(this.env); }

  /** Drop the cached DB rules (called by IpBlockService after every block / unblock / allowlist change). */
  invalidate(): void { this.loadedAt = 0; this.inflight = null; }

  private async dbRules(): Promise<NetworkRules> {
    if (!this.source) return { blocks: [], allowlist: [] };
    if (this.rules && this.now() - this.loadedAt < this.ttlMs) return this.rules;
    if (!this.inflight) {
      this.inflight = this.source.networkRules()
        .then((r) => { this.rules = { blocks: r.blocks ?? [], allowlist: r.allowlist ?? [] }; this.loadedAt = this.now(); return this.rules; })
        .catch(() => { this.loadedAt = this.now(); return this.rules ?? { blocks: [], allowlist: [] }; })   // fail open on the DB: last good rules
        .finally(() => { this.inflight = null; });
    }
    return this.inflight;
  }

  /** The effective rules: DB blocks, DB allowlist ∪ env allowlist. */
  async effectiveRules(): Promise<NetworkRules> {
    const db = await this.dbRules();
    return { blocks: db.blocks, allowlist: [...new Set([...db.allowlist, ...this.envAllowlist])] };
  }

  async decide(ip: string | null | undefined): Promise<PlatformAccessDecision> {
    return decidePlatformAccess(ip, await this.effectiveRules(), this.now());
  }
}
