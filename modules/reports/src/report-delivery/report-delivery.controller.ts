// report-delivery.controller.ts — /pos/reports/delivery: the Daily Summary "Email Report" and "Schedule Report" buttons.
// Every route acts on the signed-in staff member only (their own address, their own schedule) — see migration 845.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { S, type BodySchema } from '@aipowersalon/permissions';
import { Body, Controller, Delete, Get, HttpException, Inject, Optional, Post, Put, Req, UseGuards } from '@nestjs/common';
import { recordAuditStrict } from '@aipowersalon/audit';
import type { ReportsContext } from '../reports/reports.repository';
import type { ReportEmailState, ReportEmailSendResult } from '@aipowersalon/api-contracts/tenant';
import { ReportDeliveryService, ReportDeliveryError } from './report-delivery.service';

export const REPORT_DELIVERY = Symbol('REPORT_DELIVERY');
export const REPORT_SEND_NOW_BODY: BodySchema = S.object({ from: S.text(10), to: S.text(10) }, ['from', 'to']);
export const REPORT_SUBSCRIBE_BODY: BodySchema = S.object({ frequency: S.enumOf(['daily', 'weekly']), sendAt: S.text(5) }, ['frequency']);

const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);
function ctxFrom(req: any): ReportsContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
const actor = (c: ReportsContext) => ({ tenantId: c.tenantId, branchId: isUuid(c.branchId) ? c.branchId : null, userId: c.userId, role: c.role });
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof ReportDeliveryError) throw new HttpException({ code: (e as Error & { apiCode?: string }).apiCode ?? 'VALIDATION_FAILED', message: e.message }, e.status);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/reports/delivery')
export class ReportDeliveryController {
  constructor(@Optional() @Inject(REPORT_DELIVERY) private readonly svc: ReportDeliveryService | null) {}
  private s(): ReportDeliveryService {
    if (!this.svc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Report e-mail needs the database.' }, 503);
    return this.svc;
  }

  @Get('state') @RequirePermission('pos.reports.view')
  state(@Req() r: any): Promise<ReportEmailState> { return run(() => this.s().state(ctxFrom(r))); }

  @Post('send-now') @RequirePermission('pos.reports.export')
  sendNow(@Req() r: any, @Body(ValidatedBody(REPORT_SEND_NOW_BODY, { strict: true })) b: any): Promise<ReportEmailSendResult> {
    const c = ctxFrom(r);
    return run(async () => {
      const out = await this.s().sendNow(c, b);
      await recordAuditStrict(this.s().db, actor(c), { module: 'reports', action: 'reports.daily_summary.emailed', resourceType: 'report_email_delivery', resourceId: out.id ?? null,
        summary: `Daily Summary e-mailed to the requester (${b.from} – ${b.to}): ${out.status}` });
      return out;
    });
  }

  @Put('subscription') @RequirePermission('pos.reports.export')
  subscribe(@Req() r: any, @Body(ValidatedBody(REPORT_SUBSCRIBE_BODY, { strict: true })) b: any): Promise<ReportEmailState> {
    const c = ctxFrom(r);
    return run(async () => {
      const out = await this.s().subscribe(c, b);
      await recordAuditStrict(this.s().db, actor(c), { module: 'reports', action: 'reports.daily_summary.scheduled', resourceType: 'report_email_subscription', resourceId: out.subscription?.id ?? null,
        summary: `Daily Summary e-mail turned on for the requester (${b.frequency}, ${b.sendAt ?? '07:00'})` });
      return out;
    });
  }

  @Delete('subscription') @RequirePermission('pos.reports.view')
  unsubscribe(@Req() r: any): Promise<ReportEmailState> {
    const c = ctxFrom(r);
    return run(async () => {
      const out = await this.s().unsubscribe(c);
      await recordAuditStrict(this.s().db, actor(c), { module: 'reports', action: 'reports.daily_summary.unscheduled', resourceType: 'report_email_subscription', resourceId: out.subscription?.id ?? null,
        summary: 'Daily Summary e-mail turned off by the requester' });
      return out;
    });
  }
}
