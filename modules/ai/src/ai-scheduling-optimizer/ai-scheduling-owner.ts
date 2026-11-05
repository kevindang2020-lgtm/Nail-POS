// ai-scheduling-owner.ts — BUILD_PLAN Phase 7 (agent B): the Owner app's AI Scheduling branch comparison.
//   GET owner/ai-scheduling/summary?days= (owner.dashboard.view) → SchedOwnerSummary
// Every active location of the salon (the owner session needs no location). Per location: the latest COMPLETED run in the
// window (its utilization / idle minutes — the canonical day measures the engine stored), open recommendations, applied
// in the window split by automated, live customer proposals, open conflicts. Counts only — no customer data.
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import type { SchedOwnerBranchRow, SchedOwnerSummary } from '@aipowersalon/api-contracts/tenant';
import type { SchedCtx } from './ai-scheduling.ports';
import { iso, needPerm, rowsOf, schedCtxFrom, schedOpsRun } from './ai-scheduling-ops.common';
import { ListQueries } from '@aipowersalon/database';
import { OwnerAiSchedulingControllerListQueries } from './ai-scheduling-owner.list-queries';

export const OPEN_REC_STATUSES = ['generated', 'review_required', 'review_in_progress', 'accepted', 'partially_accepted', 'needs_revision', 'customer_approval_required', 'customer_approved', 'application_pending', 'application_failed'];
export const clampDays = (d: unknown): number => { const n = Math.floor(Number(d)); return Number.isFinite(n) && n > 0 ? Math.min(90, n) : 7; };

export interface OwnerSummaryRead { branches(tenantId: string, sinceIso: string): Promise<SchedOwnerBranchRow[]> }

export class KyselyOwnerSummaryRead implements OwnerSummaryRead {
  constructor(private readonly db: Kysely<any>) {}
  async branches(tenantId: string, sinceIso: string): Promise<SchedOwnerBranchRow[]> {
    const rows = rowsOf(await sql`
      select b.id, b.name,
             lr.metrics as last_metrics, lr.completed_at as last_run_at,
             (select count(*)::int from schedule_optimization_recommendations r where r.tenant_id = b.tenant_id and r.branch_id = b.id and r.status in (${sql.join(OPEN_REC_STATUSES)})) as open_recs,
             (select count(*)::int from schedule_optimization_recommendations r where r.tenant_id = b.tenant_id and r.branch_id = b.id and r.status = 'applied' and r.applied_at >= ${sinceIso}) as applied,
             (select count(*)::int from schedule_optimization_recommendations r where r.tenant_id = b.tenant_id and r.branch_id = b.id and r.status = 'applied' and r.automated and r.applied_at >= ${sinceIso}) as automated,
             (select count(*)::int from schedule_change_proposals p where p.tenant_id = b.tenant_id and p.branch_id = b.id and p.status in ('proposed','customer_notified')) as pending_proposals,
             (select count(*)::int from schedule_conflicts c where c.tenant_id = b.tenant_id and c.branch_id = b.id and not c.resolved) as open_conflicts
        from branches b
        left join lateral (select ru.metrics, ru.completed_at from schedule_optimization_runs ru
                            where ru.tenant_id = b.tenant_id and ru.branch_id = b.id and ru.status = 'completed' and ru.completed_at >= ${sinceIso}
                            order by ru.completed_at desc limit 1) lr on true
       where b.tenant_id = ${tenantId} and b.status = 'active'
       order by b.name`.execute(this.db));
    return rows.map((r) => {
      const m = r.last_metrics && typeof r.last_metrics === 'object' ? r.last_metrics : null;
      return {
        branchId: String(r.id), name: String(r.name ?? ''),
        utilizationPct: m && Number.isFinite(Number(m.utilizationPct)) ? Number(m.utilizationPct) : null,
        idleMin: m && Number.isFinite(Number(m.idleMin)) ? Number(m.idleMin) : null,
        openRecommendations: Number(r.open_recs ?? 0), applied: Number(r.applied ?? 0), automated: Number(r.automated ?? 0),
        pendingProposals: Number(r.pending_proposals ?? 0), openConflicts: Number(r.open_conflicts ?? 0), lastRunAt: iso(r.last_run_at),
      };
    });
  }
}

export class SchedOwnerService {
  constructor(private readonly read: OwnerSummaryRead, private readonly now: () => number = Date.now) {}
  async summary(ctx: SchedCtx, daysRaw: unknown): Promise<SchedOwnerSummary> {
    needPerm(ctx, 'owner.dashboard.view');
    const days = clampDays(daysRaw);
    const since = new Date(this.now() - days * 86_400_000).toISOString();
    return { days, branches: await this.read.branches(ctx.tenantId, since), generatedAt: new Date(this.now()).toISOString() };
  }
}

/** owner/ai-scheduling — the owner app's branch comparison (every location of the salon; no branch needed). */
@ListQueries(OwnerAiSchedulingControllerListQueries)
@Controller('owner/ai-scheduling')
@UseGuards(TenantAuthGuard, RolePermissionGuard)
export class OwnerAiSchedulingController {
  constructor(private readonly svc: SchedOwnerService) {}
  @Get('summary') @RequirePermission('owner.dashboard.view')
  summary(@Req() r: any, @Query('days') days?: string): Promise<SchedOwnerSummary> { return schedOpsRun(() => this.svc.summary(schedCtxFrom(r), days)); }
}
