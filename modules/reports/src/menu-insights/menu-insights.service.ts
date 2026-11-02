// menu-insights.service.ts — computes AI Pricing & Menu Insights for the tenant. Reuses the services view permission
// (insights are read-only analysis of the service menu). Gathers real metrics via the repo, runs the pure rules engine,
// and returns the result with an honest hasEnoughData flag + coverage. Reads are audited; nothing is fabricated.
import { hasPermission, isStaffPrincipal } from '@aipowersalon/permissions';
import { computeMenuInsights, type MenuInsightsResult } from './menu-insights.dto';
import { InsightsContext, MenuInsightsRepositoryPort } from './menu-insights.repository';

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }


export interface InsightsAuditLog { tenantId: string; branchId?: string; userId: string; role: string; actionType: string; metadata?: Record<string, unknown>; createdAt: string; }

export class MenuInsightsService {
  private audit: InsightsAuditLog[] = [];
  constructor(private readonly repo: MenuInsightsRepositoryPort) {}

  private need(ctx: InsightsContext, perm: string) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!isStaffPrincipal(ctx)) throw new ForbiddenError('Insights are not available for this role');
    if (!hasPermission(ctx as any, perm)) throw new ForbiddenError('Missing ' + perm);
  }
  auditLog(): InsightsAuditLog[] { return this.audit.slice(); }

  async getInsights(ctx: InsightsContext, windowDays = 30): Promise<MenuInsightsResult> {
    this.need(ctx, 'pos.services.view');
    const window = Math.min(365, Math.max(1, Math.floor(windowDays) || 30));
    const gathered = await this.repo.gather(ctx, window);
    const result = computeMenuInsights({ windowDays: window, services: gathered.services, products: gathered.products, combos: gathered.combos, nowIso: new Date().toISOString() });
    this.audit.push({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType: 'pos_menu_insights_viewed', metadata: { windowDays: window, insightCount: result.insights.length, hasEnoughData: result.hasEnoughData }, createdAt: new Date().toISOString() });
    return result;
  }
}
