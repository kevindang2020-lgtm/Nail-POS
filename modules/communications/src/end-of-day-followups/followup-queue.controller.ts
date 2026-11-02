// followup-queue.controller.ts — Follow-Up Queue (guide §05–§15): pos/follow-up-queue/*. Same permission and session
// scoping as the existing queue (customers.edit; tenant + branch from the session only). Reads only, except Generate
// Now, which calls the EXISTING idempotent generation and then reports that day's run row. Send / Skip / Approve / Reject
// stay on the existing routes (pos/follow-ups/:id/*, pos/eod-follow-ups/tasks/:id/*) — one send path.
import { Controller, Get, HttpException, HttpStatus, Inject, NotFoundException, Optional, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { withCode } from '@aipowersalon/api-contracts';
import { DATABASE, ListQuery, type AppDatabase } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { DailyFollowUpService } from './end-of-day-followups.service';
import { localDateInTz, type FollowUpContext } from './end-of-day-followups.dto';
import { FollowUpQueue } from './followup-queue';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
function ctxFrom(req: any): FollowUpContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const badFilter = () => withCode(new HttpException({ code: 'FOLLOWUP_QUEUE_INVALID_FILTER', message: 'Check the dates and filters.' }, HttpStatus.BAD_REQUEST), 'FOLLOWUP_QUEUE_INVALID_FILTER');

const LIST_SPEC = {
  filters: {
    view: { type: 'enum', values: ['queue', 'history'] },
    status: { type: 'enum', values: ['all', 'unsent', 'pending', 'pending_manager_approval', 'rejected', 'sent', 'skipped', 'closed', 'expired', 'customer_not_available', 'rebooked'] },
    technicianId: { type: 'uuid' },
    priority: { type: 'enum', values: ['high', 'normal', 'low'] },
    due: { type: 'enum', values: ['overdue', 'due_today', 'upcoming'] },
    basis: { type: 'enum', values: ['created', 'due', 'sent', 'last_visit', 'rebooked'] },
  },
  sort: { allowed: ['due', 'newest'], default: 'due' }, search: { maxLength: 120 }, maxLimit: 50, defaultLimit: 20, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;
const MISSED_SPEC = {
  filters: { state: { type: 'enum', values: ['recovered', 'replied', 'awaiting_callback'] } },
  sort: { allowed: ['newest'], default: 'newest' }, search: { maxLength: 120 }, maxLimit: 50, defaultLimit: 20, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;
const KPIS_SPEC = { filters: { date: { type: 'date' } }, sort: { allowed: ['due'], default: 'due' }, maxLimit: 5, defaultLimit: 5 } as const;   // five counters for one due date
const RESULTS_SPEC = { filters: { technicianId: { type: 'uuid' } }, sort: { allowed: ['funnel'], default: 'funnel' }, maxLimit: 50, defaultLimit: 50, dateRange: { maxDays: 3700 } } as const;   // bounded: ≤ 50 technicians
const HISTORY_SPEC = { filters: {}, sort: { allowed: ['newest'], default: 'newest' }, maxLimit: 50, defaultLimit: 10, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/follow-up-queue')
export class FollowUpQueueController {
  private readonly queue: FollowUpQueue | null;
  constructor(private readonly svc: DailyFollowUpService, @Optional() @Inject(DATABASE) private readonly db: AppDatabase | null) {
    this.queue = db ? new FollowUpQueue(db as unknown as Kysely<any>) : null;
  }
  private q(): FollowUpQueue {
    if (!this.queue) throw withCode(new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Follow-ups are not available here.' }, HttpStatus.SERVICE_UNAVAILABLE), 'SERVICE_UNAVAILABLE');
    return this.queue;
  }
  private async scope(r: any) {
    const ctx = ctxFrom(r); const st = await this.svc.getSettings(ctx); const now = new Date();
    return { ctx, st, now, today: localDateInTz(now, st.timezone) };
  }

  /** the five counters on the due-date basis + missed calls + that day's generation run (guide §05) */
  @Get('kpis') @RequirePermission('customers.edit') @ListQuery(KPIS_SPEC)
  async kpis(@Req() r: any, @Query('date') date?: string) {
    const { ctx, st, now, today } = await this.scope(r);
    const d = s(date) ?? today;
    if (!YMD.test(d)) throw badFilter();
    return this.q().kpis(ctx.tenantId, ctx.branchId, st.timezone, d, now);
  }

  /** queue (due → priority → completed) or history (newest first) — server search / filters / basis / pages (guide §06) */
  @Get('tasks') @RequirePermission('customers.edit') @ListQuery(LIST_SPEC)
  async tasks(@Req() r: any, @Query() q: any) {
    const { ctx, st, today } = await this.scope(r);
    const from = s(q?.from), to = s(q?.to);
    if ((from && !YMD.test(from)) || (to && !YMD.test(to)) || (from && to && from > to)) throw badFilter();
    return this.q().list(ctx.tenantId, ctx.branchId, st.timezone, today, st.contactCooldownHours ?? 24, {
      view: s(q?.view), q: s(q?.q), status: s(q?.status), technicianId: s(q?.technicianId), priority: s(q?.priority), due: s(q?.due), basis: s(q?.basis),
      from, to, page: Number(q?.page) || 1, pageSize: Number(q?.pageSize ?? q?.limit) || 20,
    });
  }

  /** Duplicate Message Protection + Smart Priority for one task (guide §10, §11) */
  @Get('tasks/:id/contact-check') @RequirePermission('customers.edit')
  async contactCheck(@Req() r: any, @Param('id') id: string) {
    const { ctx, st, today } = await this.scope(r);
    const out = await this.q().contactCheck(ctx.tenantId, ctx.branchId, today, id, st.contactCooldownHours ?? 24, !!st.requireManagerApproval);
    if (!out) throw withCode(new NotFoundException({ code: 'FOLLOWUP_NOT_FOUND', message: 'Follow-up not found.' }), 'FOLLOWUP_NOT_FOUND');
    return out;
  }

  /** the Missed Call type — its own source and states (guide §07, §13) */
  @Get('missed-calls') @RequirePermission('customers.edit') @ListQuery(MISSED_SPEC)
  async missedCalls(@Req() r: any, @Query() q: any) {
    const { ctx, st } = await this.scope(r);
    const from = s(q?.from), to = s(q?.to);
    if ((from && !YMD.test(from)) || (to && !YMD.test(to)) || (from && to && from > to)) throw badFilter();
    return this.q().missedCalls(ctx.tenantId, ctx.branchId, st.timezone, { q: s(q?.q), from, to, state: s(q?.state), page: Number(q?.page) || 1, pageSize: Number(q?.pageSize ?? q?.limit) || 20 });
  }

  /** Follow-Up Results (guide §14) — association, not causation */
  @Get('results') @RequirePermission('customers.edit') @ListQuery(RESULTS_SPEC)
  async results(@Req() r: any, @Query('from') from?: string, @Query('to') to?: string, @Query('technicianId') technicianId?: string) {
    const { ctx, st, today } = await this.scope(r);
    const f = s(from) ?? today, t = s(to) ?? today;
    if (!YMD.test(f) || !YMD.test(t) || f > t) throw badFilter();
    return this.q().results(ctx.tenantId, ctx.branchId, st.timezone, f, t, s(technicianId));
  }

  /** a customer's follow-up history, newest first (guide §13) */
  @Get('customers/:customerId/history') @RequirePermission('customers.edit') @ListQuery(HISTORY_SPEC)
  async history(@Req() r: any, @Param('customerId') customerId: string, @Query() q: any) {
    const ctx = ctxFrom(r);
    const out = await this.q().customerHistory(ctx.tenantId, ctx.branchId, customerId, Number(q?.page) || 1, Number(q?.pageSize ?? q?.limit) || 10);
    if (!out) throw badFilter();
    return out;
  }

  /** Generate Now (guide §08): the EXISTING idempotent generation, then that day's counts — eligible / created /
   *  already existed / skipped by reason / failed. Generating never sends. */
  @Post('generate') @RequirePermission('customers.edit')
  async generate(@Req() r: any) {
    const ctx = ctxFrom(r);
    const res = await this.svc.managerGenerateNow(ctx);
    const summary = await this.q().generationSummary(ctx.tenantId, ctx.branchId, res.businessDate, res.created);
    return { result: res, summary };
  }
}
