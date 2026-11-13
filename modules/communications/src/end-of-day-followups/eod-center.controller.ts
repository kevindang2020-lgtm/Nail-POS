// eod-center.controller.ts — End-of-Day Follow-Ups management center (guide §4–§12): pos/eod-follow-ups/*. Same
// permission as the existing manager surface (customers.edit), tenant + branch from the session only. Reads are
// read-only — Preview Tonight creates no task, sends nothing, notifies nobody (guide §7). The writes go through the
// existing DailyFollowUpService (one send path, one lifecycle).
import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpException, HttpStatus, Inject, NotFoundException, Optional, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { withCode } from '@aipowersalon/api-contracts';
import { DATABASE, ListQuery, type AppDatabase } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { EOD_SEND_BODY, EOD_REJECT_BODY } from '../request-schemas';
import { DailyFollowUpService } from './end-of-day-followups.service';
import { FollowUpError, localDateInTz, type FollowUpContext } from './end-of-day-followups.dto';
import { EodCenter, loadEodCandidates, summarizeCandidates, DATE_BASES } from './eod-center';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
function ctxFrom(req: any): FollowUpContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof FollowUpError) {
      // keep the registry code withCode() put on the domain error (apiCode) so the POS shows the right reason
      const Ex = e.code === 'forbidden' || e.code === 'not_technician' ? ForbiddenException : e.code === 'not_found' ? NotFoundException : BadRequestException;
      const apiCode = (e as { apiCode?: string }).apiCode;
      const err = new Ex(apiCode ? { code: apiCode, message: e.message } : e.message);
      throw apiCode ? withCode(err, apiCode as Parameters<typeof withCode>[1]) : err;
    }
    throw e;
  }
}
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const TASKS_SPEC = {
  filters: {
    status: { type: 'enum', values: ['all', 'unsent', 'sent', 'closed', 'pending', 'pending_manager_approval', 'rejected', 'customer_not_available', 'skipped', 'dismissed', 'expired', 'customer_replied', 'rebooked', 'failed'] },
    approval: { type: 'enum', values: ['awaiting', 'rejected', 'approved'] },
    technicianId: { type: 'uuid' },
    basis: { type: 'enum', values: ['generated', 'due', 'sent', 'expired'] },
  },
  sort: { allowed: ['newest', 'due'], default: 'newest' }, search: { maxLength: 120 }, maxLimit: 50, defaultLimit: 20, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;
const PREVIEW_SPEC = { filters: { date: { type: 'date' } }, sort: { allowed: ['completed'], default: 'completed' }, maxLimit: 200, defaultLimit: 200 } as const;   // bounded: at most 200 rows
const RUNS_SPEC = { filters: {}, sort: { allowed: ['newest'], default: 'newest' }, maxLimit: 50, defaultLimit: 10, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/eod-follow-ups')
export class EodFollowUpCenterController {
  private readonly center: EodCenter | null;
  constructor(private readonly svc: DailyFollowUpService, @Optional() @Inject(DATABASE) private readonly db: AppDatabase | null) {
    this.center = db ? new EodCenter(db as unknown as Kysely<any>) : null;
  }
  private c(): EodCenter {
    if (!this.center) throw withCode(new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Follow-ups are not available here.' }, HttpStatus.SERVICE_UNAVAILABLE), 'SERVICE_UNAVAILABLE');
    return this.center;
  }

  /** header + KPIs + next / last run (guide §4, §17) */
  @Get('summary') @RequirePermission('customers.edit')
  async summary(@Req() r: any) { const ctx = ctxFrom(r); const st = await this.svc.getSettings(ctx); return { settings: st, ...(await this.c().summary(ctx.tenantId, ctx.branchId, st, new Date())) }; }

  /** Automation & Messaging Health (guide §7): evidence per row, never green because the page loaded */
  @Get('health') @RequirePermission('customers.edit')
  async health(@Req() r: any) { const ctx = ctxFrom(r); const st = await this.svc.getSettings(ctx); return this.c().health(ctx.tenantId, ctx.branchId, st, new Date()); }

  /** Preview Tonight's Follow-Ups (guide §7) — READ-ONLY: the same eligibility rule the 8 PM job runs, no writes */
  @Get('preview') @RequirePermission('customers.edit') @ListQuery(PREVIEW_SPEC)
  async preview(@Req() r: any, @Query('date') date?: string) {
    const ctx = ctxFrom(r); const st = await this.svc.getSettings(ctx); const now = new Date();
    const next = await this.c().nextRun(ctx.tenantId, ctx.branchId, st, now);
    const businessDate = date && YMD.test(date) ? date : next?.businessDate ?? localDateInTz(now, st.timezone);
    const cands = await loadEodCandidates(this.db as unknown as Kysely<any>, { tenantId: ctx.tenantId, branchId: ctx.branchId, tz: st.timezone, businessDate, cooldownHours: st.contactCooldownHours ?? 24, now });
    const byTech = new Map<string, { technicianId: string; technicianName: string; wouldCreate: number; excluded: number; noApp: number }>();
    for (const c of cands) {
      const t = byTech.get(c.technicianId) ?? { technicianId: c.technicianId, technicianName: c.technicianName, wouldCreate: 0, excluded: 0, noApp: 0 };
      if (c.excluded) t.excluded += 1; else { t.wouldCreate += 1; if (c.noApp) t.noApp += 1; }
      byTech.set(c.technicianId, t);
    }
    return {
      businessDate, timezone: st.timezone, enabled: st.enabled, nextRun: next, generatedAt: now.toISOString(),
      note: 'Preview only — nothing was created, sent or notified. Counts can change before the real run (new checkouts, bookings, replies).',
      totals: summarizeCandidates(cands), technicians: [...byTech.values()].sort((a, b) => a.technicianName.localeCompare(b.technicianName)),
      correctness: await this.c().generationCheck(ctx.tenantId, ctx.branchId, businessDate, cands),   // round 10 (EOD 03)
      rows: cands.slice(0, 200).map((c) => ({ technicianId: c.technicianId, technicianName: c.technicianName, customerName: c.customerName, serviceName: c.serviceName,
        ticketNumber: c.ticketNumber, completedAt: c.completedAt, excluded: c.excluded, noApp: c.noApp, nextBookingDate: c.nextBookingDate })),
    };
  }

  /** generation run log (guide §6 diagnostic trace) */
  @Get('runs') @RequirePermission('customers.edit') @ListQuery(RUNS_SPEC)
  runs(@Req() r: any, @Query() q: any) { const ctx = ctxFrom(r); return this.c().runs(ctx.tenantId, ctx.branchId, Number(q?.page) || 1, Number(q?.pageSize ?? q?.limit) || 10); }

  /** activity / history (guide §11): server search, date basis, From–To, pages 10/20/50, newest first */
  @Get('tasks') @RequirePermission('customers.edit') @ListQuery(TASKS_SPEC)
  async tasks(@Req() r: any, @Query() q: any) {
    const ctx = ctxFrom(r); const st = await this.svc.getSettings(ctx);
    const basis = s(q?.basis); if (basis && !(DATE_BASES as readonly string[]).includes(basis)) throw withCode(new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Unknown date basis.' }), 'VALIDATION_FAILED');
    const from = s(q?.from), to = s(q?.to);
    if ((from && !YMD.test(from)) || (to && !YMD.test(to)) || (from && to && from > to)) throw withCode(new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The From date must be on or before the To date.' }), 'VALIDATION_FAILED');
    return this.c().tasks(ctx.tenantId, ctx.branchId, st.timezone, { q: s(q?.q), status: s(q?.status), technicianId: s(q?.technicianId), approval: s(q?.approval), basis, from, to, sort: s(q?.sort), page: q?.page, pageSize: q?.pageSize ?? q?.limit });
  }

  /** task details overlay (guide §12) */
  @Get('tasks/:id') @RequirePermission('customers.edit')
  async detail(@Req() r: any, @Param('id') id: string) {
    const ctx = ctxFrom(r); const d = await this.c().detail(ctx.tenantId, ctx.branchId, id);
    if (!d) throw withCode(new NotFoundException({ code: 'FOLLOWUP_NOT_FOUND', message: 'Follow-up not found.' }), 'FOLLOWUP_NOT_FOUND');
    return d;
  }

  /** manager send — with an optional audited exception for "already booked" / "recently contacted" (never opt-outs) */
  @Post('tasks/:id/send') @RequirePermission('customers.edit')
  send(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(EOD_SEND_BODY, { strict: true })) b: any) { return run(() => this.svc.managerSend(ctxFrom(r), id, b?.message ?? undefined, b?.override ?? null)); }

  @Post('tasks/:id/approve') @RequirePermission('customers.edit')
  approve(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(EOD_SEND_BODY, { strict: true })) b: any) { return run(() => this.svc.managerApprove(ctxFrom(r), id, b?.message ?? undefined, b?.override ?? null)); }

  @Post('tasks/:id/reject') @RequirePermission('customers.edit')
  reject(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(EOD_REJECT_BODY, { strict: true })) b: any) { return run(() => this.svc.managerReject(ctxFrom(r), id, b?.note ?? '')); }
}
