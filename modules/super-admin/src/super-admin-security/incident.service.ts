// Security-incident engine — controlled vocab, validated transitions, append-only history, audited. Invalid transitions
// are rejected; close/reopen require a reason; incidents are never deleted.
import { normalizeSeverity, normalizeCategory, buildTransition, assembleWorkflowCounts } from './incident-core';
import type { IncidentRepositoryPort, IncidentActor } from './incident.repository';

export class IncidentError extends Error { constructor(public code: 'invalid' | 'not_found' | 'conflict', message: string) { super(message); } }

export interface CreateIncidentInput { title: string; description?: string; category?: string; severity?: string; detectionSource?: string; tenantId?: string | null; branchId?: string | null; assignedTo?: string | null; correlationId?: string | null }

export class IncidentService {
  constructor(private readonly repo: IncidentRepositoryPort) {}

  async create(input: CreateIncidentInput, actor: IncidentActor) {
    if (!String(input.title || '').trim()) throw new IncidentError('invalid', 'title is required');
    return this.repo.insert({ title: input.title.trim(), description: input.description ?? null, category: normalizeCategory(input.category || ''), severity: normalizeSeverity(input.severity || ''), detectionSource: input.detectionSource ?? null, tenantId: input.tenantId ?? null, branchId: input.branchId ?? null, assignedTo: input.assignedTo ?? null, correlationId: input.correlationId ?? null }, actor);
  }

  async transition(id: string, toStatus: string, reason: string | null, actor: IncidentActor) {
    const inc = await this.repo.get(String(id || ''));
    if (!inc) throw new IncidentError('not_found', 'Incident not found');
    const t = buildTransition({ from: inc.status, to: toStatus, actor: actor.userId, reason, correlationId: inc.correlationId });
    if (!t.ok) throw new IncidentError('conflict', t.reason);
    return this.repo.applyTransition(inc.id, t.record, actor);
  }

  async list(limit = 20) { return this.repo.list(limit); }
  async get(id: string) { const inc = await this.repo.get(String(id || '')); if (!inc) throw new IncidentError('not_found', 'Incident not found'); return inc; }
  async workflow() { const byStatus = await this.repo.countByStatus(); return { stages: assembleWorkflowCounts(byStatus), openCount: await this.repo.openCount() }; }
}
