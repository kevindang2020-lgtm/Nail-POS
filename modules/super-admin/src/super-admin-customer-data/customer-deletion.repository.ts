// Repository for customer permanent-deletion requests. The request row is the durable dual-approval trail; the
// actual destructive customer delete happens via hardDeleteCustomer only after every gate passes. In-memory
// implementation simulates the delete + a permissive retention check so the workflow is fully testable.

import type { DeletionRequest } from '@aipowersalon/api-contracts/platform';
export type { DeletionRequest };   // owned by packages/api-contracts (Constitution 13 §13)
import type { DeletionStatus } from './deletion-workflow';

export interface CreateDeletionInput { tenantId: string; customerId: string; reason: string; requestedByUserId: string | null }
export interface DeletionAudit { actionType: string; requestId: string; tenantId: string; customerId: string; detail: Record<string, unknown>; actorUserId?: string; ip?: string }

export interface DeletionRepo {
  create(input: CreateDeletionInput): Promise<DeletionRequest>;
  get(id: string): Promise<DeletionRequest | null>;
  list(scope: { tenantId?: string; status?: string }): Promise<DeletionRequest[]>;
  setStatus(id: string, status: DeletionStatus, patch?: Partial<DeletionRequest>): Promise<void>;
  retentionAllows(tenantId: string, customerId: string): Promise<{ ok: boolean; note: string | null }>;
  hardDeleteCustomer(tenantId: string, customerId: string): Promise<boolean>;
  writeAudit(entry: DeletionAudit): Promise<void>;
}

export class InMemoryDeletionRepo implements DeletionRepo {
  private reqs: DeletionRequest[] = [];
  private audit: DeletionAudit[] = [];
  private deleted = new Set<string>();
  private seq = 0;
  retentionResult: { ok: boolean; note: string | null } = { ok: true, note: null }; // override in tests

  async create(input: CreateDeletionInput): Promise<DeletionRequest> {
    const now = new Date().toISOString();
    const req: DeletionRequest = {
      id: `del_${++this.seq}`, tenantId: input.tenantId, customerId: input.customerId, reason: input.reason, status: 'requested',
      requestedByUserId: input.requestedByUserId, approvedByUserId: null, executedByUserId: null, rejectReason: null,
      retentionChecked: false, retentionNote: null, legalHoldBlocked: false, requestedAt: now, approvedAt: null, executedAt: null,
    };
    this.reqs.push(req); return { ...req };
  }
  async get(id: string): Promise<DeletionRequest | null> { const r = this.reqs.find((x) => x.id === id); return r ? { ...r } : null; }
  async list(scope: { tenantId?: string; status?: string }): Promise<DeletionRequest[]> {
    return this.reqs.filter((r) => (!scope.tenantId || r.tenantId === scope.tenantId) && (!scope.status || r.status === scope.status)).map((r) => ({ ...r }));
  }
  async setStatus(id: string, status: DeletionStatus, patch: Partial<DeletionRequest> = {}): Promise<void> {
    const r = this.reqs.find((x) => x.id === id); if (!r) return; r.status = status; Object.assign(r, patch);
  }
  async retentionAllows(): Promise<{ ok: boolean; note: string | null }> { return { ...this.retentionResult }; }
  async hardDeleteCustomer(_tenantId: string, customerId: string): Promise<boolean> { this.deleted.add(customerId); return true; }
  async writeAudit(entry: DeletionAudit): Promise<void> { this.audit.push({ ...entry }); }
  getAudit(): DeletionAudit[] { return [...this.audit]; }
  wasDeleted(customerId: string): boolean { return this.deleted.has(customerId); }
}
