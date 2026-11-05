// bundles.service.ts — tenant POS Bundles use-cases. Resolves tenant/role from session context; enforces per-action
// permissions (reusing the services capability via security-core's coarse mapping); validates; writes audit logs;
// never fabricates data. The repository is async (Postgres/Kysely or in-memory), so every use-case awaits the repo.
import { hasPermission, isStaffPrincipal } from '@aipowersalon/permissions';
import {
  BundlesState, BundleRow, BundleDetail, BundleFilters, CreateBundleRequest, UpdateBundleRequest, ArchiveBundleResult,
  isBundleKind, isBundleStatus, isBundleItemType, isValidWindow,
} from './bundles.dto';
import { BundlesContext, BundlesRepositoryPort } from './bundles.repository';

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError'; } }


export interface BundlesAuditLog {
  tenantId: string; branchId?: string; userId: string; role: string; actionType: string; entityType: string;
  entityId?: string; before?: Record<string, unknown>; after?: Record<string, unknown>; metadata?: Record<string, unknown>; createdAt: string;
}

export class BundlesService {
  private audit: BundlesAuditLog[] = [];
  constructor(private readonly repo: BundlesRepositoryPort) {}

  private assertUser(ctx: BundlesContext) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!isStaffPrincipal(ctx)) throw new ForbiddenError('Bundles are not available for this role');
  }
  private need(ctx: BundlesContext, perm: string) { this.assertUser(ctx); if (!hasPermission(ctx as any, perm)) throw new ForbiddenError('Missing ' + perm); }
  private log(ctx: BundlesContext, actionType: string, entityId?: string, before?: any, after?: any, metadata?: any) {
    this.audit.push({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType, entityType: 'pos_bundle', entityId, before, after, metadata, createdAt: new Date().toISOString() });
  }
  auditLog(): BundlesAuditLog[] { return this.audit.slice(); }

  // ---- read ----
  async getState(ctx: BundlesContext, f: BundleFilters = {}): Promise<BundlesState> {
    this.need(ctx, 'pos.bundles.view');
    const st = await this.repo.query(ctx, f);
    this.log(ctx, 'pos_bundles_viewed', undefined, undefined, undefined, { filters: f });
    return st;
  }
  async getKpis(ctx: BundlesContext) { return (await this.getState(ctx)).kpis; }
  async list(ctx: BundlesContext, f: BundleFilters = {}): Promise<BundleRow[]> { return (await this.getState(ctx, f)).rows; }
  async detail(ctx: BundlesContext, bundleId: string): Promise<BundleDetail> {
    this.need(ctx, 'pos.bundles.view');
    const d = await this.repo.detail(ctx, bundleId);
    if (!d) throw new ValidationError('Bundle not found');
    return d;
  }

  // ---- validation ----
  private validate(req: Partial<CreateBundleRequest>, requireAll: boolean) {
    if (requireAll || req.name !== undefined) if (!req.name || !req.name.trim()) throw new ValidationError('Bundle name is required');
    if (requireAll || req.kind !== undefined) if (!isBundleKind(req.kind)) throw new ValidationError("kind must be 'bundle', 'package', 'membership', or 'promo'");
    if (req.status !== undefined && !isBundleStatus(req.status)) throw new ValidationError("status must be 'active', 'inactive', or 'archived'");
    if (req.priceCents !== undefined && (!Number.isFinite(req.priceCents) || req.priceCents < 0)) throw new ValidationError('Price must be 0 or greater');
    if (req.usageLimit != null && (!Number.isInteger(req.usageLimit) || req.usageLimit < 0)) throw new ValidationError('Usage limit must be a non-negative whole number');
    if (!isValidWindow(req.startsAt ?? null, req.endsAt ?? null)) throw new ValidationError('End date must be after start date');
    if (requireAll || req.items !== undefined) {
      const items = req.items || [];
      if (requireAll && items.length === 0) throw new ValidationError('A bundle needs at least one item');
      for (const it of items) {
        if (!isBundleItemType(it.itemType)) throw new ValidationError("Each item type must be 'service' or 'product'");
        if (!it.label || !it.label.trim()) throw new ValidationError('Each item needs a label');
        if (!Number.isFinite(it.quantity) || it.quantity < 1) throw new ValidationError('Each item quantity must be 1 or greater');
        if (!Number.isFinite(it.unitPriceCents) || it.unitPriceCents < 0) throw new ValidationError('Each item price must be 0 or greater');
      }
    }
  }

  // ---- create / edit / status ----
  async create(ctx: BundlesContext, req: CreateBundleRequest): Promise<BundleDetail> {
    this.need(ctx, 'pos.bundles.create');
    this.validate(req, true);
    const row = await this.repo.create(ctx, req);
    this.log(ctx, 'pos_bundle_created', row.bundleId, undefined, row as any);
    return row;
  }
  async update(ctx: BundlesContext, bundleId: string, req: UpdateBundleRequest): Promise<BundleDetail> {
    this.need(ctx, 'pos.bundles.edit');
    this.validate(req, false);
    const before = await this.repo.detail(ctx, bundleId);
    if (!before) throw new ValidationError('Bundle not found');
    const row = await this.repo.update(ctx, bundleId, req);
    if (!row) throw new ValidationError('Bundle not found');
    this.log(ctx, 'pos_bundle_updated', bundleId, before as any, row as any);
    return row;
  }
  async archive(ctx: BundlesContext, bundleId: string): Promise<ArchiveBundleResult> {
    this.need(ctx, 'pos.bundles.archive');
    const before = await this.repo.detail(ctx, bundleId);
    if (!before) throw new ValidationError('Bundle not found');
    const row = await this.repo.setStatus(ctx, bundleId, 'archived');
    if (!row) throw new ValidationError('Bundle not found');
    this.log(ctx, 'pos_bundle_archived', bundleId, before as any, row as any);
    return { ok: true, bundleId, status: row.status };
  }
  async reactivate(ctx: BundlesContext, bundleId: string): Promise<ArchiveBundleResult> {
    this.need(ctx, 'pos.bundles.archive');
    const before = await this.repo.detail(ctx, bundleId);
    if (!before) throw new ValidationError('Bundle not found');
    const row = await this.repo.setStatus(ctx, bundleId, 'active');
    if (!row) throw new ValidationError('Bundle not found');
    this.log(ctx, 'pos_bundle_reactivated', bundleId, before as any, row as any);
    return { ok: true, bundleId, status: row.status };
  }
}
