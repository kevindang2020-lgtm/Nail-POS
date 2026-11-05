// Privileged-access engine — time-boxed, reviewable, expiring, audited. Requests are validated (mandatory bounded
// expiry); approval enforces separation of duties (approver != requester); a sweep expires past-window grants.
import { validateGrantRequest, normalizePrivilege, canGrantTransition, enforceSeparation, isCurrentlyElevated } from './grant-core';
import type { GrantRepositoryPort, GrantActor } from './grant.repository';

export class GrantError extends Error { constructor(public code: 'invalid' | 'not_found' | 'conflict' | 'forbidden', message: string) { super(message); } }

export class GrantService {
  constructor(private readonly repo: GrantRepositoryPort) {}

  async request(input: { userId: string; privilege: string; scope: string; target?: string | null; reason: string; expiresAt: string }, actor: GrantActor) {
    const v = validateGrantRequest(input, Date.now());
    if (!v.ok) throw new GrantError('invalid', v.reason);
    return this.repo.insert({ userId: input.userId, privilege: normalizePrivilege(input.privilege), scope: String(input.scope).toLowerCase(), target: input.target ?? null, reason: input.reason, expiresAt: input.expiresAt }, actor);
  }

  async approve(id: string, actor: GrantActor) {
    const g = await this.repo.get(String(id || ''));
    if (!g) throw new GrantError('not_found', 'Grant not found');
    if (!canGrantTransition(g.status, 'active')) throw new GrantError('conflict', `cannot approve a grant in status "${g.status}"`);
    const sep = enforceSeparation(g.requestedBy, actor.userId);
    if (!sep.ok) throw new GrantError('forbidden', sep.reason);
    return this.repo.transition(g.id, 'active', 'approved', { approvedBy: actor.userId, grantedAt: new Date().toISOString() }, actor);
  }

  async deny(id: string, reason: string | null, actor: GrantActor) {
    const g = await this.repo.get(String(id || ''));
    if (!g) throw new GrantError('not_found', 'Grant not found');
    if (!canGrantTransition(g.status, 'denied')) throw new GrantError('conflict', `cannot deny a grant in status "${g.status}"`);
    return this.repo.transition(g.id, 'denied', reason, {}, actor);
  }

  async revoke(id: string, reason: string | null, actor: GrantActor) {
    const g = await this.repo.get(String(id || ''));
    if (!g) throw new GrantError('not_found', 'Grant not found');
    if (!canGrantTransition(g.status, 'revoked')) throw new GrantError('conflict', `cannot revoke a grant in status "${g.status}"`);
    if (!String(reason || '').trim()) throw new GrantError('invalid', 'revocation requires a reason');
    return this.repo.transition(g.id, 'revoked', reason, { revokedAt: new Date().toISOString() }, actor);
  }

  async expireSweep(actor: GrantActor) { return { expired: await this.repo.expireOverdue(actor) }; }
  async list(limit = 20) { return this.repo.list(limit); }
  async listActive() { return this.repo.listActive(); }
  async get(id: string) { const g = await this.repo.get(String(id || '')); if (!g) throw new GrantError('not_found', 'Grant not found'); return { ...g, currentlyElevated: isCurrentlyElevated(g.status, g.expiresAt, Date.now()) }; }
}
