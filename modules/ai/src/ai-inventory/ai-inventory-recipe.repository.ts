// ai-inventory-recipe.repository.ts — the write boundary for service recipes. The Kysely impl persists to the PRIMARY db
// transactionally (header + lines) and, on approve, supersedes the prior approved version for the same (service, branch
// scope); the in-memory impl mirrors that contract for tests. Ownership checks (service/products belong to the tenant)
// live in the Kysely impl; the in-memory fake trusts seeded data. All methods are tenant-scoped.
import { canApprove, canArchive, nextVersion, scopeKey, type RecipeDraftInput, type RecipeSource, type RecipeStatus } from './ai-inventory-recipe.core';

export interface RecipeLine {
  productId: string;
  expectedQuantity: number;
  consumptionUnit: string;
  wasteAllowancePct: number;
  required: boolean;
  sortOrder: number;
}

export interface Recipe {
  id: string;
  tenantId: string;
  branchId: string | null;
  serviceId: string;
  version: number;
  status: RecipeStatus;
  source: RecipeSource;
  effectiveDate: string | null;
  notes: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  lines: RecipeLine[];
}

export interface ListRecipeFilter {
  serviceId?: string | null;
  branchId?: string | null;
  status?: RecipeStatus | null;
}

export class RecipeConflictError extends Error {}
export class RecipeNotFoundError extends Error {}

export interface RecipeRepositoryPort {
  createDraft(tenantId: string, userId: string, input: RecipeDraftInput): Promise<Recipe>;
  list(tenantId: string, filter: ListRecipeFilter): Promise<Recipe[]>;
  get(tenantId: string, id: string): Promise<Recipe | null>;
  approve(tenantId: string, id: string, userId: string): Promise<Recipe>;
  archive(tenantId: string, id: string): Promise<Recipe>;
}

let counter = 0;
const uid = () => `rec_${++counter}`;

/** Deterministic in-memory repo. Keyed by tenant so cross-tenant isolation is exercised. */
export class InMemoryRecipeRepository implements RecipeRepositoryPort {
  private byTenant: Record<string, Recipe[]> = {};

  private rows(tenantId: string): Recipe[] {
    return (this.byTenant[tenantId] ??= []);
  }

  async createDraft(tenantId: string, userId: string, input: RecipeDraftInput): Promise<Recipe> {
    const rows = this.rows(tenantId);
    const branchId = input.branchId ?? null;
    const versions = rows
      .filter((r) => r.serviceId === input.serviceId && scopeKey(r.branchId) === scopeKey(branchId))
      .map((r) => r.version);
    const recipe: Recipe = {
      id: uid(), tenantId, branchId, serviceId: input.serviceId,
      version: nextVersion(versions), status: 'draft', source: input.source ?? 'manual',
      effectiveDate: input.effectiveDate ?? null, notes: input.notes ?? null,
      createdBy: userId, approvedBy: null, approvedAt: null, createdAt: new Date().toISOString(),
      lines: input.lines.map((l, i) => ({
        productId: l.productId, expectedQuantity: l.expectedQuantity, consumptionUnit: l.consumptionUnit,
        wasteAllowancePct: l.wasteAllowancePct ?? 0, required: l.required ?? true, sortOrder: l.sortOrder ?? i,
      })),
    };
    rows.push(recipe);
    return structuredClone(recipe);
  }

  async list(tenantId: string, filter: ListRecipeFilter): Promise<Recipe[]> {
    let rows = this.rows(tenantId);
    if (filter.serviceId) rows = rows.filter((r) => r.serviceId === filter.serviceId);
    if (filter.branchId !== undefined && filter.branchId !== null) rows = rows.filter((r) => r.branchId === filter.branchId);
    if (filter.status) rows = rows.filter((r) => r.status === filter.status);
    return rows.map((r) => structuredClone(r));
  }

  async get(tenantId: string, id: string): Promise<Recipe | null> {
    const r = this.rows(tenantId).find((x) => x.id === id);
    return r ? structuredClone(r) : null;
  }

  async approve(tenantId: string, id: string, userId: string): Promise<Recipe> {
    const rows = this.rows(tenantId);
    const r = rows.find((x) => x.id === id);
    if (!r) throw new RecipeNotFoundError('Recipe not found');
    if (!canApprove(r.status)) throw new RecipeConflictError(`Cannot approve a ${r.status} recipe`);
    // Supersede the prior approved version for the same (service, branch scope).
    for (const other of rows) {
      if (other.id !== r.id && other.serviceId === r.serviceId && scopeKey(other.branchId) === scopeKey(r.branchId) && other.status === 'approved') {
        other.status = 'archived';
      }
    }
    r.status = 'approved';
    r.approvedBy = userId;
    r.approvedAt = new Date().toISOString();
    return structuredClone(r);
  }

  async archive(tenantId: string, id: string): Promise<Recipe> {
    const r = this.rows(tenantId).find((x) => x.id === id);
    if (!r) throw new RecipeNotFoundError('Recipe not found');
    if (!canArchive(r.status)) throw new RecipeConflictError('Recipe already archived');
    r.status = 'archived';
    return structuredClone(r);
  }
}
