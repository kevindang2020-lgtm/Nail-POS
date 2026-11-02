// IP-block engine — validated, protected-source-safe, idempotent, audited. Refuses to block loopback/reserved,
// allowlisted, or configured trusted/office/health-check/emergency ranges (impact preview surfaces this before commit).
import { validateBlockTarget, isProtectedSource, normalizeThreatType, canBlockTransition } from './ip-block-core';
import type { IpBlockRepositoryPort, BlockActor } from './ip-block.repository';
import { allowlistWouldLockOut } from './network-policy-core';

/** §136: `onChange` invalidates the cached platform network policy after every rule change; `lockoutGuard` refuses an
 *  allowlist entry that would leave the admin adding it OUTSIDE the (now enforced) Super Admin allowlist. */
export interface IpBlockServiceOptions { onChange?: () => void; lockoutGuard?: boolean }

export class IpBlockError extends Error { constructor(public code: 'invalid' | 'protected' | 'not_found' | 'conflict', message: string) { super(message); } }

export interface CreateBlockInput { target: string; threatType?: string; source?: string; reason?: string; country?: string; tenantId?: string | null; expiresAt?: string | null }

export class IpBlockService {
  constructor(private readonly repo: IpBlockRepositoryPort, private readonly opts: IpBlockServiceOptions = {}) {}
  private changed<T>(v: T): T { this.opts.onChange?.(); return v; }   // the policy's invalidate() only resets two fields

  private async protection() { const [allowlist, protectedCidrs] = await Promise.all([this.repo.allowlistExact(), this.repo.allowlistCidrs()]); return { allowlist, protectedCidrs }; }

  // Preview never mutates — validates syntax and reports whether the target is protected (so the UI can warn/prevent).
  async preview(target: string) {
    const v = validateBlockTarget(target);
    if (!v.ok) return { valid: false as const, reason: v.reason };
    const prot = isProtectedSource(target, await this.protection());
    return { valid: true as const, kind: v.kind, version: v.version, normalized: v.normalized, protected: prot.protected, protectedReason: prot.reason, wouldBlock: !prot.protected };
  }

  async createBlock(input: CreateBlockInput, actor: BlockActor) {
    const v = validateBlockTarget(input.target);
    if (!v.ok) throw new IpBlockError('invalid', v.reason);
    const prot = isProtectedSource(v.normalized, await this.protection());
    if (prot.protected) throw new IpBlockError('protected', `refusing to block a protected source (${prot.reason}) — this could lock out trusted access`);
    return this.changed(await this.repo.insertBlock({ target: v.normalized, blockKind: v.kind, ipVersion: v.version, threatType: input.threatType ? normalizeThreatType(input.threatType) : 'manual_block', source: input.source ?? null, reason: input.reason ?? null, country: input.country ?? null, tenantId: input.tenantId ?? null, expiresAt: input.expiresAt ?? null }, actor));
  }

  async unblock(id: string, actor: BlockActor) {
    const b = await this.repo.getBlock(String(id || ''));
    if (!b) throw new IpBlockError('not_found', 'Block rule not found');
    if (!canBlockTransition(b.status, 'allowed')) throw new IpBlockError('conflict', `cannot unblock a rule in status "${b.status}"`);
    return this.changed(await this.repo.setStatus(b.id, 'allowed', actor));
  }

  async addAllowlist(target: string, reason: string | null, actor: BlockActor) {
    const v = validateBlockTarget(target);
    if (!v.ok) throw new IpBlockError('invalid', v.reason);
    if (this.opts.lockoutGuard) {
      const { allowlist, protectedCidrs } = await this.protection();
      if (allowlistWouldLockOut(actor.ip, [...allowlist, ...protectedCidrs], v.normalized)) throw new IpBlockError('conflict', `refusing to add ${v.normalized}: the Super Admin allowlist is enforced, and your own address would be outside it — add your address (or its range) first`);
    }
    return this.changed(await this.repo.addAllowlist(v.normalized, v.kind, reason, actor));
  }

  async list(limit = 20) { return this.repo.listBlocks(limit); }
  async counts() { return { active: await this.repo.countActiveBlocks(), today: await this.repo.blockedToday() }; }
}
