// birthday-center.controller.ts — Birthday Campaigns guide (Oct 31 2026): `/pos/birthdays/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role come from the session (req.ctx), never the body.
//   pos.marketing.view                     summary · customers · missing · history · settings
//   pos.marketing.view + pos.customers.view   customers/:id (the authorized overlay — a sensitive read, audited fail-closed)
//   pos.customers.edit                     PUT customers/:id/birthday (record / correct / clear — audited)
//   pos.marketing.manage                   PUT settings (Feb 29 policy) · assistant/plan · assistant/save (an UNSENT draft)
// Nothing here sends a message, issues an offer or approves a campaign: that stays in Campaign Center.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission, S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Put, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { recordAuditStrict } from '@aipowersalon/audit';
import { isUuid, type RetentionContext, SegmentsError } from '@aipowersalon/customers';
import { BirthdayCenter, BirthdayError, BD_SCOPES, BD_SORTS, BD_BASES, BD_PRESETS, BD_ELIGIBILITY, BD_OBJECTIVES } from './birthday-center';

export const BIRTHDAY_CENTER = 'BirthdayCenter';

const txt = (max: number): BodySchema => S.nullable(S.text(max));
export const BIRTHDAY_EDIT_BODY: BodySchema = S.object({ birthday: txt(10), expectedVersion: S.integer() }, ['expectedVersion']);
export const BIRTHDAY_SETTINGS_BODY: BodySchema = S.object({ feb29Policy: S.enumOf(['feb28', 'mar1']), expectedVersion: S.integer() }, ['feb29Policy', 'expectedVersion']);
const ASSIST = { objective: S.enumOf([...BD_OBJECTIVES]), channel: S.nullable(S.enumOf(['sms', 'email'])), preset: S.nullable(S.enumOf([...BD_PRESETS])),
  month: S.nullable(S.integer()), from: txt(10), to: txt(10), dealId: S.nullable(S.uuid()), templateId: S.nullable(S.uuid()) };
export const BIRTHDAY_PLAN_BODY: BodySchema = S.object(ASSIST, ['objective']);
export const BIRTHDAY_SAVE_BODY: BodySchema = S.object({ ...ASSIST, name: txt(120), message: txt(1600), emailSubject: txt(200), idempotencyKey: S.text(120) }, ['objective', 'idempotencyKey']);

function ctxFrom(req: any): RetentionContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [], salonName: c.salonName,
    authz: c.authz ? { scope: c.authz.scope ?? null, branchIds: Array.isArray(c.authz.branchIds) ? c.authz.branchIds : null } : null };
}
function need(ctx: RetentionContext, ...perms: string[]) {
  if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  for (const perm of perms) if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], perm)) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot do this.' }, HttpStatus.FORBIDDEN);
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof BirthdayError || e instanceof SegmentsError) throw new HttpException({ code: e.code, message: e.message, details: (e as BirthdayError).details }, e.status);
    // Campaign Center refusals carry their own code + status (campaign-center err())
    if (e && typeof e.code === 'string' && typeof e.status === 'number' && e.status >= 400 && e.status < 500) throw new HttpException({ code: e.code, message: e.message }, e.status);
    throw e;
  }
}
const actor = (c: RetentionContext) => ({ tenantId: c.tenantId, branchId: isUuid(c.branchId) ? c.branchId : null, userId: c.userId, role: c.role });
const RANGE = { preset: { type: 'enum', values: BD_PRESETS }, month: { type: 'number', min: 1, max: 12 } } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/birthdays')
export class BirthdayCenterController {
  constructor(@Inject(BIRTHDAY_CENTER) private readonly center: BirthdayCenter | null) {}
  private r(): BirthdayCenter { if (!this.center) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Birthday Campaigns needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.center; }

  /** the KPI strip + data completeness for the selected month / preset / From → To */
  @Get('summary') @RequirePermission('pos.marketing.view')
  @ListQuery({ filters: RANGE, search: false, dateRange: { maxDays: 366 } })
  summary(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.r().summary(c, { month: f?.month, preset: f?.preset, from: f?.from, to: f?.to })); }

  /** the customer table: scope · occurrence / created basis · search · eligibility · tier · sort · pages of 10 / 20 / 50 */
  @Get('customers') @RequirePermission('pos.marketing.view')
  @ListQuery({ filters: { ...RANGE, scope: { type: 'enum', values: BD_SCOPES }, basis: { type: 'enum', values: BD_BASES }, eligibility: { type: 'enum', values: BD_ELIGIBILITY }, tier: { type: 'text', maxLength: 40 } }, sorts: { upcoming: null, newest: null, name_asc: null, name_desc: null }, search: { maxLength: 100 }, dateRange: { maxDays: 366 }, maxLimit: 50, defaultLimit: 20, params: ['page'] })
  customers(@Req() q: any, @Query() f: any) {
    const c = ctxFrom(q); need(c, 'pos.marketing.view');
    return run(() => this.r().customers(c, { scope: f?.scope, preset: f?.preset, month: f?.month, from: f?.from, to: f?.to, basis: f?.basis, q: f?.q, eligibility: f?.eligibility, tier: f?.tier, sort: f?.sort, page: f?.page, pageSize: f?.pageSize }));
  }

  /** Missing Birthdays Center — read-only (it never changes a customer) */
  @Get('missing') @RequirePermission('pos.marketing.view')
  missing(@Req() q: any) { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.r().missing(c)); }

  /** birthday message history, newest first */
  @Get('history') @RequirePermission('pos.marketing.view')
  @ListQuery({ filters: { year: { type: 'number', min: 2000, max: 2200 } }, sorts: { newest: null }, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 20, params: ['page'] })
  history(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.r().history(c, { q: f?.q, page: f?.page, pageSize: f?.pageSize, year: f?.year })); }

  @Get('settings') @RequirePermission('pos.marketing.view')
  settings(@Req() q: any) { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.r().settings(c)); }

  @Put('settings') @RequirePermission('pos.marketing.manage')
  saveSettings(@Req() q: any, @Body(ValidatedBody(BIRTHDAY_SETTINGS_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, 'pos.marketing.manage');
    return run(() => this.r().saveSettings(c, b, (trx, meta) => recordAuditStrict(trx, actor(c), { module: 'marketing', action: 'birthdays.settings.updated', resourceType: 'tenant_birthday_settings', resourceId: null,
      summary: `Feb 29 birthdays in non-leap years: ${meta.after === 'mar1' ? 'Mar 1' : 'Feb 28'}`, before: { feb29Policy: meta.before }, after: { feb29Policy: meta.after } })));
  }

  /** the authorized overlay: profile, visits, spending, messages, offers — a sensitive read, audited before it is returned */
  @Get('customers/:id') @RequirePermission('pos.customers.view')
  customer(@Req() q: any, @Param('id') id: string) {
    const c = ctxFrom(q); need(c, 'pos.marketing.view', 'pos.customers.view');
    return run(async () => {
      const out = await this.r().overlay(c, id);
      await recordAuditStrict(this.r().db, actor(c), { module: 'marketing', action: 'birthdays.customer.viewed', resourceType: 'customer', resourceId: id, summary: 'Birthday customer details opened' });
      return out;
    });
  }

  /** record / correct / clear a birthday (YYYY-MM-DD, or MM-DD when the year is not known) — role-gated, versioned, audited */
  @Put('customers/:id/birthday') @RequirePermission('pos.customers.edit')
  updateBirthday(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(BIRTHDAY_EDIT_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, 'pos.customers.edit');
    return run(() => this.r().updateBirthday(c, id, b, (trx, meta) => recordAuditStrict(trx, actor(c), { module: 'customers', action: 'customer.birthday.updated', resourceType: 'customer', resourceId: id,
      summary: meta.hasBirthday ? (meta.hadBirthday ? 'Birthday corrected' : 'Birthday recorded') : 'Birthday cleared', after: { yearKnown: meta.yearKnown } })));
  }

  /** Smart Birthday Campaign Assistant: audience counts with reasons, offer + template checks, labelled suggestions. Sends nothing. */
  @Post('assistant/plan') @RequirePermission('pos.marketing.manage')
  plan(@Req() q: any, @Body(ValidatedBody(BIRTHDAY_PLAN_BODY, { strict: true })) b: any) { const c = ctxFrom(q); need(c, 'pos.marketing.manage'); return run(() => this.r().plan(c, b)); }

  /** saves an UNSENT audience + a DRAFT campaign in Campaign Center (approval and sending happen there) */
  @Post('assistant/save') @RequirePermission('pos.marketing.manage')
  save(@Req() q: any, @Body(ValidatedBody(BIRTHDAY_SAVE_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, 'pos.marketing.manage');
    return run(() => this.r().save(c, b, (trx, meta) => recordAuditStrict(trx, actor(c), { module: 'marketing', action: 'birthdays.assistant.draft_saved', resourceType: 'segment_audience_draft', resourceId: String(meta.draftId ?? ''),
      summary: `Birthday audience saved (not sent): ${meta.selected} selected, ${meta.eligible} eligible`, after: { objective: meta.objective, range: meta.range, channel: meta.channel } })));
  }
}
