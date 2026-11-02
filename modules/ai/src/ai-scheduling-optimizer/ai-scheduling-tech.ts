// ai-scheduling-tech.ts — BUILD_PLAN Phase 7 (agent B): the Technician app's view of optimizer changes that touch ME.
//   GET tech/ai-schedule/changes?date= (ai_scheduling.view_own) → SchedTechChangeList
// The technician is resolved exactly as GET /tech/schedule does it (technicians row linked to the session's user in the
// salon, active) — never from the request. Only recommendations where this technician is affected (affected technicians,
// or the current / proposed technician), on the requested date (from or to), in a state worth showing (proposed, waiting
// for the customer, applied, rolled back). The customer is shown by FIRST NAME only.
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { businessDate } from '@aipowersalon/date-time';
import type { SchedRecStatus, SchedRecType, SchedTechChange, SchedTechChangeList } from '@aipowersalon/api-contracts/tenant';
import type { SchedCtx } from './ai-scheduling.ports';
import { SchedOpsError, iso, isUuid, isYmd, needPerm, rowsOf, schedCtxFrom, schedOpsRun } from './ai-scheduling-ops.common';
import { ListQueries } from '@aipowersalon/database';
import { TechAiScheduleControllerListQueries } from './ai-scheduling-tech.list-queries';

export const TECH_VISIBLE: SchedRecStatus[] = ['review_required', 'review_in_progress', 'accepted', 'partially_accepted', 'customer_approval_required', 'customer_approved', 'application_pending', 'applied', 'rolled_back'];

export interface TechChangeRow { id: string; status: SchedRecStatus; type: SchedRecType; current: any; proposed: any; updatedAt: string; customerFirstName: string | null }
export interface TechChangeRead {
  technicianFor(tenantId: string, userId: string): Promise<string | null>;
  branchTz(tenantId: string, branchId: string | null): Promise<string>;
  changes(tenantId: string, technicianId: string, date: string): Promise<TechChangeRow[]>;
}

/** Pure: one row → the wire shape, from THIS technician's point of view. */
export function toTechChange(r: TechChangeRow, technicianId: string): SchedTechChange {
  const cur = r.current && typeof r.current === 'object' ? r.current : null, prop = r.proposed && typeof r.proposed === 'object' ? r.proposed : null;
  const curTech = cur?.technicianId ?? null, propTech = prop ? (prop.technicianId ?? null) : curTech;
  return {
    recommendationId: r.id, status: r.status, type: r.type,
    appointmentId: (prop?.appointmentId ?? cur?.appointmentId ?? null) as string | null, customerFirstName: r.customerFirstName,
    from: cur?.date && cur?.startTime ? { date: String(cur.date), startTime: String(cur.startTime) } : null,
    to: prop?.date && prop?.startTime ? { date: String(prop.date), startTime: String(prop.startTime) } : null,
    movesToMe: !!prop && propTech === technicianId && curTech !== technicianId,
    movesAwayFromMe: !!prop && curTech === technicianId && propTech !== technicianId,
    updatedAt: r.updatedAt,
  };
}

export class KyselyTechChangeRead implements TechChangeRead {
  constructor(private readonly db: Kysely<any>) {}
  async technicianFor(tenantId: string, userId: string) {
    const r = rowsOf(await sql`select id from technicians where tenant_id = ${tenantId} and user_id = ${userId} and is_active = true limit 1`.execute(this.db))[0];
    return r ? String(r.id) : null;
  }
  async branchTz(tenantId: string, branchId: string | null) {
    if (!branchId) return 'America/New_York';
    const r = rowsOf(await sql`select timezone from branches where id = ${branchId} and tenant_id = ${tenantId}`.execute(this.db))[0];
    return String(r?.timezone || 'America/New_York');
  }
  async changes(tenantId: string, technicianId: string, date: string): Promise<TechChangeRow[]> {
    const rows = rowsOf(await sql`
      select r.id, r.status, r.type, r.current_state, r.proposed_state, r.updated_at,
             coalesce(c.first_name, nullif(split_part(a.customer_name, ' ', 1), '')) as first_name
        from schedule_optimization_recommendations r
        left join pos_tech_appointments a on a.tenant_id = r.tenant_id and a.id::text = coalesce(r.proposed_state->>'appointmentId', r.current_state->>'appointmentId')
        left join customers c on c.tenant_id = r.tenant_id and c.id = a.customer_id
       where r.tenant_id = ${tenantId} and r.status in (${sql.join(TECH_VISIBLE)})
         and (r.affected_technician_ids @> ${JSON.stringify([technicianId])}::jsonb
              or r.current_state->>'technicianId' = ${technicianId} or r.proposed_state->>'technicianId' = ${technicianId})
         and (r.current_state->>'date' = ${date} or r.proposed_state->>'date' = ${date})
       order by r.updated_at desc limit 100`.execute(this.db));
    return rows.map((r) => ({ id: String(r.id), status: r.status, type: r.type, current: r.current_state, proposed: r.proposed_state, updatedAt: iso(r.updated_at) ?? '', customerFirstName: r.first_name ?? null }));
  }
}

export class SchedTechService {
  constructor(private readonly read: TechChangeRead, private readonly now: () => number = Date.now) {}
  async changes(ctx: SchedCtx, dateRaw?: string): Promise<SchedTechChangeList> {
    needPerm(ctx, 'ai_scheduling.view_own');
    const technicianId = isUuid(ctx.userId) && ctx.tenantId ? await this.read.technicianFor(ctx.tenantId, ctx.userId) : null;
    if (!technicianId) throw new SchedOpsError('FORBIDDEN', 'No technician profile is linked to this account.');
    if (dateRaw && !isYmd(dateRaw)) throw new SchedOpsError('VALIDATION', 'date must be YYYY-MM-DD.');
    const date = dateRaw || businessDate(await this.read.branchTz(ctx.tenantId, ctx.branchId ?? null), new Date(this.now()));
    return { items: (await this.read.changes(ctx.tenantId, technicianId, date)).map((r) => toTechChange(r, technicianId)) };
  }
}

@ListQueries(TechAiScheduleControllerListQueries)
@Controller('tech/ai-schedule')
@UseGuards(TenantAuthGuard, RolePermissionGuard)
export class TechAiScheduleController {
  constructor(private readonly svc: SchedTechService) {}
  @Get('changes') @RequirePermission('ai_scheduling.view_own')
  changes(@Req() r: any, @Query('date') date?: string): Promise<SchedTechChangeList> { return schedOpsRun(() => this.svc.changes(schedCtxFrom(r), date)); }
}
