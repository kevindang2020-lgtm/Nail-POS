// deployments.service.ts — tenant deployment/update use-cases. Reads need settings.view; mutations need settings.edit
// (mapped from pos.deployments.*). Transitions are validated by the pure core state machine — there is no path that
// silently marks an update "completed". Every mutation is audited. Duplicate "start" is prevented because the state
// machine rejects starting an already in-progress deployment.
import { hasPermission, isStaffPrincipal } from '@aipowersalon/permissions';
import { updateAvailable, summarize, nextStatus, type DeployRecord, type DeployStatus } from './deployments-core';
import type { DeploymentsContext, DeploymentsState, DeploymentView, CreateDeploymentRequest } from './deployments.dto';
import type { DeploymentsRepositoryPort, StoredDeployment } from './deployments.repository';
import type { LogSink } from '../logs/logs.dto';
import type { WebhookEventSink } from '../api-webhooks/api-webhooks.dto';

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError'; } }
export class NotFoundError extends Error { constructor(msg = 'Not found') { super(msg); this.name = 'NotFoundError'; } }

const STATUSES = new Set(['available', 'scheduled', 'in_progress', 'completed', 'failed', 'rolled_back', 'up_to_date', 'deferred', 'blocked']);
const iso = (ms: number | null): string | null => (ms == null ? null : new Date(ms).toISOString());

export interface DeploymentsAuditLog { tenantId: string; userId: string; role: string; actionType: string; entityType: string; entityId?: string; metadata?: Record<string, unknown>; createdAt: string }

export class DeploymentsService {
  private audit: DeploymentsAuditLog[] = [];
  constructor(private readonly repo: DeploymentsRepositoryPort, private readonly now: () => number = () => Date.now(), private readonly logs?: LogSink, private readonly events?: WebhookEventSink) {}

  private async emit(ctx: DeploymentsContext, severity: 'info' | 'warning' | 'error', message: string, relatedId?: string, status?: string) {
    await this.logs?.write({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId }, { category: 'device', severity, source: 'deployment', message, relatedId, status });
  }

  private assertUser(ctx: DeploymentsContext) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!isStaffPrincipal(ctx)) throw new ForbiddenError('Deployments are not available for this role');
  }
  private need(ctx: DeploymentsContext, perm: string) { this.assertUser(ctx); if (!hasPermission(ctx as any, perm)) throw new ForbiddenError('Missing ' + perm); }
  private log(ctx: DeploymentsContext, actionType: string, entityId?: string, metadata?: Record<string, unknown>) {
    this.audit.push({ tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role, actionType, entityType: 'tenant_deployment', entityId, metadata, createdAt: new Date(this.now()).toISOString() });
  }
  auditLog(): DeploymentsAuditLog[] { return this.audit.slice(); }

  private toRecord = (d: StoredDeployment): DeployRecord => ({ id: d.id, component: d.component, componentKind: d.componentKind, installedVersion: d.installedVersion, latestVersion: d.latestVersion, targetCount: d.targetCount, status: d.status, scheduledIso: iso(d.scheduledMs), branchId: d.branchId });
  private toView = (d: StoredDeployment): DeploymentView => { const r = this.toRecord(d); return { ...r, updateAvailable: updateAvailable(r) }; };

  async getState(ctx: DeploymentsContext): Promise<DeploymentsState> {
    this.need(ctx, 'pos.deployments.view');
    const rows = await this.repo.list(ctx);
    const records = rows.map(this.toRecord);
    return { deployments: rows.map(this.toView), summary: summarize(records) };
  }

  async create(ctx: DeploymentsContext, req: CreateDeploymentRequest): Promise<DeploymentView> {
    this.need(ctx, 'pos.deployments.manage');
    const component = (req.component || '').trim();
    if (!component) throw new ValidationError('Component is required');
    const componentKind = req.componentKind === 'firmware' ? 'firmware' : 'app';
    const status = (req.status && STATUSES.has(req.status) ? req.status : 'available') as DeployStatus;
    const targetCount = Number.isFinite(Number(req.targetCount)) ? Math.max(0, Math.trunc(Number(req.targetCount))) : 0;
    const stored = await this.repo.insert(ctx, { component, componentKind, installedVersion: req.installedVersion ?? null, latestVersion: req.latestVersion ?? null, targetCount, status, branchId: ctx.branchId || null, createdByUserId: ctx.userId });
    this.log(ctx, 'deployment_created', stored.id, { component, status });
    await this.emit(ctx, 'info', `Deployment created: ${component}`, stored.id, status);
    return this.toView(stored);
  }

  async advance(ctx: DeploymentsContext, id: string, action: string): Promise<DeploymentView> {
    this.need(ctx, 'pos.deployments.manage');
    const current = await this.repo.get(ctx, id);
    if (!current) throw new NotFoundError('Deployment not found');
    const next = nextStatus(current.status, action);
    if (!next) throw new ValidationError(`Cannot ${action} a deployment in status ${current.status}`);
    const scheduledMs = next === 'scheduled' ? this.now() : null;
    const updated = await this.repo.updateStatus(ctx, id, next, scheduledMs);
    if (!updated) throw new NotFoundError('Deployment not found');
    this.log(ctx, 'deployment_' + action, id, { from: current.status, to: next });
    await this.emit(ctx, next === 'failed' ? 'error' : next === 'rolled_back' ? 'warning' : 'info', `Deployment ${action}: ${current.component} (${current.status} → ${next})`, id, next);
    if (next === 'completed' || next === 'failed' || next === 'rolled_back') {
      try { await this.events?.dispatch({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId }, `deployment.${next}`, { id, component: current.component, status: next }); }
      catch { /* event dispatch must not break the deployment transition */ }
    }
    return this.toView(updated);
  }
}
