// Emergency-lockdown engine — deliberate, multi-step, self-preservation-safe, reversible, audited. Propose → confirm
// (step-up + typed phrase) → execute → lift. On execute, account/tenant lockdowns delegate to the session-revoke engine
// (preserving the initiator's session); platform lockdowns record active and rely on the auth gate (documented). Never
// one-click; the initiator is never locked out.
import { validateProposal, verifyConfirmation, expectedConfirmationPhrase, canLockdownTransition, mapToRevokeScope, violatesSelfPreservation } from './lockdown-core';
import type { LockdownRepositoryPort, LockdownActor } from './lockdown.repository';
import type { SessionRevokeService } from './session-revoke.service';

export class LockdownError extends Error { constructor(public code: 'invalid' | 'not_found' | 'conflict' | 'forbidden', message: string) { super(message); } }

export class LockdownService {
  constructor(private readonly repo: LockdownRepositoryPort, private readonly revoke: SessionRevokeService,
    /** Constitution 12 M13: a PLATFORM lockdown revokes every non-SUPER_ADMIN session and is enforced on every request. */
    private readonly platform?: { revokeAllNonSuperAdmin(reason: string, keepSessionId: string | null): Promise<number>; invalidate(): void }) {}

  async propose(input: { scope: string; target?: string | null; reason: string }, actor: LockdownActor) {
    const v = validateProposal(input.scope, input.target, input.reason);
    if (!v.ok) throw new LockdownError('invalid', v.reason);
    if (violatesSelfPreservation(input.scope, input.target ?? null, actor.userId)) throw new LockdownError('forbidden', 'refusing to lock out your own account (self-preservation)');
    const row = await this.repo.insert(String(input.scope).toLowerCase(), input.target ?? null, input.reason, actor);
    return { lockdown: row, confirmationPhrase: expectedConfirmationPhrase(row.scope), nextStep: 'confirm with step-up re-authentication and the exact confirmation phrase' };
  }

  async confirm(id: string, typedPhrase: string, stepUpVerified: boolean, actor: LockdownActor) {
    const l = await this.repo.get(String(id || ''));
    if (!l) throw new LockdownError('not_found', 'Lockdown not found');
    if (!canLockdownTransition(l.status, 'confirmed')) throw new LockdownError('conflict', `cannot confirm a lockdown in status "${l.status}"`);
    const c = verifyConfirmation(l.scope, typedPhrase, stepUpVerified);
    if (!c.ok) throw new LockdownError('forbidden', c.reason);
    return this.repo.transition(l.id, 'confirmed', 'confirmed with step-up + phrase', { stepUpVerified: true, confirmedBy: actor.userId }, actor);
  }

  async execute(id: string, actor: LockdownActor) {
    const l = await this.repo.get(String(id || ''));
    if (!l) throw new LockdownError('not_found', 'Lockdown not found');
    if (!canLockdownTransition(l.status, 'active')) throw new LockdownError('conflict', `cannot execute a lockdown in status "${l.status}" (must be confirmed)`);
    if (!l.stepUpVerified) throw new LockdownError('forbidden', 'step-up confirmation missing');
    // Apply: revoke in-scope sessions, preserving the initiator's current session. A PLATFORM lockdown revokes every
    // non-SUPER_ADMIN session and is then enforced on every request (PlatformLockdownGate) — it used to "rely on the auth
    // gate", which never read it (M13). Without the platform hook it refuses to activate rather than pretend.
    let affected = 0;
    if (String(l.scope).toLowerCase() === 'platform') {
      if (!this.platform) throw new LockdownError('conflict', 'platform lockdown enforcement is not wired in this deployment — refusing to report a lockdown that would not lock anything');
      affected = await this.platform.revokeAllNonSuperAdmin(`emergency lockdown ${l.lockdownRef}`, actor.sessionId ?? null);
    }
    const { revokeScope } = mapToRevokeScope(l.scope);
    if (revokeScope && l.target) {
      const res = await this.revoke.revoke({ scope: revokeScope, target: l.target, reason: `emergency lockdown ${l.lockdownRef}`, currentSessionId: actor.sessionId, includeCurrent: false }, actor);
      affected = res.revokedSessions;
    }
    const out = await this.repo.transition(l.id, 'active', `activated (${affected} sessions revoked)`, { affectedSessions: affected }, actor);
    this.platform?.invalidate();
    return out;
  }

  async lift(id: string, reason: string | null, actor: LockdownActor) {
    const l = await this.repo.get(String(id || ''));
    if (!l) throw new LockdownError('not_found', 'Lockdown not found');
    if (!canLockdownTransition(l.status, 'lifted')) throw new LockdownError('conflict', `cannot lift a lockdown in status "${l.status}"`);
    if (!String(reason || '').trim()) throw new LockdownError('invalid', 'lifting requires a reason');
    const out = await this.repo.transition(l.id, 'lifted', reason, {}, actor);
    this.platform?.invalidate();
    return out;
  }

  async cancel(id: string, actor: LockdownActor) {
    const l = await this.repo.get(String(id || ''));
    if (!l) throw new LockdownError('not_found', 'Lockdown not found');
    if (!canLockdownTransition(l.status, 'cancelled')) throw new LockdownError('conflict', `cannot cancel a lockdown in status "${l.status}"`);
    return this.repo.transition(l.id, 'cancelled', 'cancelled before activation', {}, actor);
  }

  async list(limit = 20) { return this.repo.list(limit); }
  async get(id: string) { const l = await this.repo.get(String(id || '')); if (!l) throw new LockdownError('not_found', 'Lockdown not found'); return l; }
}
