// ai-money-protection-investigations.repository.ts — investigation + append-only notes store (port + in-memory).
import type { MoneyProtectionContext } from './ai-money-protection.dto';
import type {
  Investigation, InvestigationNote, InvestigationStatus, ResolutionType, InvestigationRelated,
} from './ai-money-protection-investigations.dto';

export interface InvestigationFilters { status?: string; branchId?: string; limit?: number; }

export interface InvestigationPatch {
  status?: InvestigationStatus;
  /** Phase 12 (#27): the status the caller read — a status write lands only from it (else null: changed underneath) */
  fromStatus?: InvestigationStatus;
  assignedUserId?: string | null;
  resolution?: ResolutionType | null;
  recoveryAmountCents?: number;
  closedAt?: string | null;
}

export interface MoneyProtectionInvestigationRepositoryPort {
  create(ctx: MoneyProtectionContext, data: {
    title: string; category: string; severity: Investigation['severity']; branchId: string | null;
    valueUnderReviewCents: number; related: InvestigationRelated; createdByUserId: string;
  }): Promise<Investigation>;
  get(ctx: MoneyProtectionContext, id: string): Promise<Investigation | null>;
  list(ctx: MoneyProtectionContext, f: InvestigationFilters): Promise<Investigation[]>;
  update(ctx: MoneyProtectionContext, id: string, patch: InvestigationPatch): Promise<Investigation | null>;
  addNote(ctx: MoneyProtectionContext, investigationId: string, authorUserId: string, body: string): Promise<InvestigationNote>;
  listNotes(ctx: MoneyProtectionContext, investigationId: string): Promise<InvestigationNote[]>;
}

export class InMemoryInvestigationRepository implements MoneyProtectionInvestigationRepositoryPort {
  private inv: Investigation[] = [];
  private notes: InvestigationNote[] = [];

  async create(ctx: MoneyProtectionContext, data: any): Promise<Investigation> {
    const now = new Date().toISOString();
    const inv: Investigation = {
      id: 'inv_' + (this.inv.length + 1), tenantId: ctx.tenantId, branchId: data.branchId ?? null,
      title: data.title, category: data.category, severity: data.severity, status: 'OPEN',
      assignedUserId: null, valueUnderReviewCents: data.valueUnderReviewCents, recoveryAmountCents: 0,
      resolution: null, related: data.related, createdByUserId: data.createdByUserId, createdAt: now, updatedAt: now, closedAt: null,
    };
    this.inv.push(inv);
    return inv;
  }
  async get(ctx: MoneyProtectionContext, id: string) {
    return this.inv.find((i) => i.tenantId === ctx.tenantId && i.id === id) ?? null;
  }
  async list(ctx: MoneyProtectionContext, f: InvestigationFilters) {
    let rows = this.inv.filter((i) => i.tenantId === ctx.tenantId);
    if (f.status) rows = rows.filter((i) => i.status === f.status);
    if (f.branchId) rows = rows.filter((i) => i.branchId === f.branchId);
    return rows.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, Math.min(100, Math.max(1, f.limit ?? 50)));
  }
  async update(ctx: MoneyProtectionContext, id: string, patch: InvestigationPatch) {
    const inv = await this.get(ctx, id);
    if (!inv) return null;
    if (patch.fromStatus !== undefined && inv.status !== patch.fromStatus) return null;   // the conditional write (Phase 12 #27)
    if (patch.status !== undefined) inv.status = patch.status;
    if (patch.assignedUserId !== undefined) inv.assignedUserId = patch.assignedUserId;
    if (patch.resolution !== undefined) inv.resolution = patch.resolution;
    if (patch.recoveryAmountCents !== undefined) inv.recoveryAmountCents = patch.recoveryAmountCents;
    if (patch.closedAt !== undefined) inv.closedAt = patch.closedAt;
    inv.updatedAt = new Date().toISOString();
    return inv;
  }
  async addNote(ctx: MoneyProtectionContext, investigationId: string, authorUserId: string, body: string) {
    const note: InvestigationNote = { id: 'note_' + (this.notes.length + 1), investigationId, authorUserId, body, createdAt: new Date().toISOString() };
    this.notes.push({ ...note }); // append-only: never mutated after insert
    return note;
  }
  async listNotes(ctx: MoneyProtectionContext, investigationId: string) {
    const inv = await this.get(ctx, investigationId);
    if (!inv) return [];
    return this.notes.filter((n) => n.investigationId === investigationId).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }
}
