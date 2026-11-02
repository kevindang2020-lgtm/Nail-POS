// pos-project-status.service.ts — assembles the honest POS delivery status; logs views; supports recheck.
import { POSProjectStatusState, POSProjectModuleStatus, POSModuleKey, buildPosProjectStatus, POS_MODULE_DEFS } from './pos-project-status.dto';
import { hasPermission, isStaffPrincipal } from '@aipowersalon/permissions';

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }

export interface PSContext { tenantId: string; branchId?: string; userId: string; role: string; permissions: string[]; }
export interface PSAuditLog { tenantId: string; userId: string; role: string; actionType: string; entityType: 'pos_project_status'; entityId?: string; createdAt: string; }


export class PosProjectStatusService {
  private audit: PSAuditLog[] = [];
  private checkedAt: Record<string, string> = {};

  private assert(ctx: PSContext) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!isStaffPrincipal(ctx, { allowPlatform: true })) throw new ForbiddenError('Project status is not available for this role');
    if (!hasPermission(ctx as any, 'pos.reports.view')) throw new ForbiddenError('Missing pos.reports.view');
  }
  private log(ctx: PSContext, actionType: string, entityId?: string) {
    this.audit.push({ tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role, actionType, entityType: 'pos_project_status', entityId, createdAt: new Date().toISOString() });
  }
  auditLog(): PSAuditLog[] { return this.audit.slice(); }

  getState(ctx: PSContext): POSProjectStatusState {
    this.assert(ctx);
    this.log(ctx, 'pos_project_status_viewed');
    return buildPosProjectStatus(this.checkedAt);
  }
  getModules(ctx: PSContext): POSProjectModuleStatus[] { return this.getState(ctx).modules; }
  getModule(ctx: PSContext, moduleKey: POSModuleKey): POSProjectModuleStatus {
    this.assert(ctx);
    const m = buildPosProjectStatus(this.checkedAt).modules.find((x) => x.moduleKey === moduleKey);
    if (!m) throw new ForbiddenError('Unknown module');
    this.log(ctx, 'pos_project_status_viewed', moduleKey);
    return m;
  }
  recheck(ctx: PSContext, moduleKey: POSModuleKey): POSProjectModuleStatus {
    this.assert(ctx);
    if (!POS_MODULE_DEFS.some((d) => d.moduleKey === moduleKey)) throw new ForbiddenError('Unknown module');
    this.checkedAt[moduleKey] = new Date().toISOString();
    this.log(ctx, 'pos_project_status_rechecked', moduleKey);
    return this.getModule(ctx, moduleKey);
  }
}
