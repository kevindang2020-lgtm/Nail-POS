// membership-programs.controller.ts — canonical Super Admin → Business Management → Membership Programs. Read-only
// platform overview + Platform Membership Controls (gating, limits, rules, reusable templates). SuperAdminGuard; mutation
// routes additionally require the memberships.manage permission and validate via the pure controls core; all audited.
import { Body, Controller, Get, HttpException, HttpStatus, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { MembershipProgramsRepository, type MPAuditActor } from './membership-programs.repository';
import { validateLimits, validateRules, normalizeGating, validateTemplate } from './membership-controls-core';
import { validateCorrection, validateDisable, validateSupportSession } from './membership-actions-core';
import { isPlatformPrincipal } from '@aipowersalon/permissions';
import { ListQueries } from '@aipowersalon/database';
import { MembershipProgramsControllerListQueries } from './membership-programs.list-queries';
import { MP_CORRECTION_BODY, MP_DISABLE_BODY, MP_ENABLED_BODY, MP_EXPORT_BODY, MP_GATING_BODY, MP_LIMITS_BODY, MP_RULES_BODY, MP_SUPPORT_SESSION_BODY, MP_TEMPLATE_BODY } from '../request-schemas-programs';   // BUILD_PLAN Phase 12 (#17)

const MANAGE = 'super_admin.memberships.manage';
const CORRECT = 'super_admin.memberships.correct';
const DISABLE = 'super_admin.memberships.disable';
const SUPPORT = 'super_admin.memberships.support_mode';
const EXPORT = 'super_admin.memberships.export';

@UseGuards(SuperAdminGuard)
@ListQueries(MembershipProgramsControllerListQueries)
@Controller('super-admin/membership-programs')
export class MembershipProgramsController {
  constructor(private readonly repo: MembershipProgramsRepository) {}

  private actor(r: any): MPAuditActor { return { userId: r?.ctx?.userId, role: r?.ctx?.role }; }
  private requireManage(r: any) { this.requirePerm(r, MANAGE); }
  private requirePerm(r: any, perm: string) {
    const ctx = r?.ctx ?? {};
    if (!isPlatformPrincipal(ctx) && !(ctx.permissions ?? []).includes(perm)) throw new HttpException(`missing permission: ${perm}`, HttpStatus.FORBIDDEN);
  }
  private unprocessable(errors: string[]): never { throw new HttpException(errors.join('; '), HttpStatus.UNPROCESSABLE_ENTITY); }

  @Get('duplicate-charges')
  async duplicateCharges() { return { ok: true, cases: await this.repo.listDuplicateCharges() }; }

  @Post('exports')
  async exportCsv(@Body(ValidatedBody(MP_EXPORT_BODY)) body: any, @Query() q: any, @Req() r: any, @Res() res: any) {
    this.requirePerm(r, EXPORT);
    const f = { ...(q ?? {}), ...(body ?? {}) };
    const columns = Array.isArray(f.columns) ? f.columns : typeof f.columns === 'string' ? f.columns.split(',') : undefined;
    const report = typeof f.report === 'string' ? f.report : 'programs';
    const out = report === 'programs'
      ? await this.repo.exportProgramsCsv(this.actor(r), { tenantId: f.tenantId, status: f.status, productType: f.productType, columns })
      : await this.repo.exportReportCsv(this.actor(r), report, { tenantId: f.tenantId, status: f.status, productType: f.productType });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.setHeader('X-Row-Count', String(out.rowCount));
    res.status(HttpStatus.OK).send(out.csv);
  }

  @Get('members')
  async members(@Query() q: any) { return { ok: true, members: await this.repo.listMembers({ status: q?.status, tenantId: q?.tenantId }) }; }

  @Get('credits-summary')
  async creditsSummary() { return { ok: true, rows: await this.repo.creditsSummary() }; }

  @Get('suspicious')
  async suspicious() { return { ok: true, cases: await this.repo.listSuspicious() }; }

  @Get('support-sessions/active')
  async activeSupport(@Req() r: any) { return { ok: true, session: await this.repo.activeSupportSession(this.actor(r)) }; }

  // Constitution 7 §8/§74: entering Support Mode from here needs step-up, like every other entry
  @RequireStepUp()
  @Post('support-sessions')
  async openSupport(@Body(ValidatedBody(MP_SUPPORT_SESSION_BODY)) body: any, @Req() r: any) {
    this.requirePerm(r, SUPPORT);
    const v = validateSupportSession(body);
    if (!v.ok) this.unprocessable(v.errors);
    const session = await this.repo.openSupportSession(this.actor(r), v.value);
    return { ok: true, session };
  }

  @Post('support-sessions/:id/exit')
  async exitSupport(@Param('id') id: string, @Req() r: any) {
    this.requirePerm(r, SUPPORT);
    const ok = await this.repo.closeSupportSession(this.actor(r), id);
    if (!ok) throw new HttpException('no active session', HttpStatus.NOT_FOUND);
    return { ok: true };
  }

  @Get('programs/:id/impact')
  async programImpact(@Param('id') id: string) {
    const impact = await this.repo.programImpact(id);
    if (!impact) throw new HttpException('program not found', HttpStatus.NOT_FOUND);
    return { ok: true, impact };
  }

  @Post('programs/:id/disable')
  async disableProgram(@Param('id') id: string, @Body(ValidatedBody(MP_DISABLE_BODY)) body: any, @Req() r: any) {
    this.requirePerm(r, DISABLE);
    const v = validateDisable(body);
    if (!v.ok) this.unprocessable(v.errors);
    const ok = await this.repo.disableProgram(this.actor(r), id, v.value.reason);
    if (!ok) throw new HttpException('program not found', HttpStatus.NOT_FOUND);
    return { ok: true };
  }

  @Post('corrections')
  async correction(@Body(ValidatedBody(MP_CORRECTION_BODY)) body: any, @Req() r: any) {
    this.requirePerm(r, CORRECT);
    const v = validateCorrection(body);
    if (!v.ok) this.unprocessable(v.errors);
    const res = await this.repo.createCorrection(this.actor(r), v.value);
    if (res.notFound) throw new HttpException('membership not found', HttpStatus.NOT_FOUND);
    if (!res.ok) throw new HttpException('correction failed', HttpStatus.INTERNAL_SERVER_ERROR);
    return { ok: true, entryId: res.entryId };
  }

  @Get('overview')
  async overview() { return { ok: true, ...(await this.repo.overview()) }; }

  @Get('controls')
  async controls() { return { ok: true, ...(await this.repo.getControls()) }; }

  @Get('programs')
  async programs(@Query() q: any) { return { ok: true, programs: await this.repo.listPrograms({ tenantId: q?.tenantId, status: q?.status, productType: q?.productType }) }; }

  @Get('billing-failures')
  async billingFailures() { return { ok: true, failures: await this.repo.listBillingFailures() }; }

  @Get('revenue')
  async revenue() { return { ok: true, ...(await this.repo.revenueBreakdown()) }; }

  @Get('cancellations')
  async cancellations() { return { ok: true, items: await this.repo.listCancellationsPauses() }; }

  @Post('enabled')
  async setEnabled(@Body(ValidatedBody(MP_ENABLED_BODY)) body: any, @Req() r: any) {
    this.requireManage(r);
    await this.repo.patchConfig(this.actor(r), { enabledGlobally: !!body?.enabled }, 'membership.enabled.set');
    return { ok: true, enabledGlobally: !!body?.enabled };
  }

  @Post('plan-gating')
  async setGating(@Body(ValidatedBody(MP_GATING_BODY)) body: any, @Req() r: any) {
    this.requireManage(r);
    const controls = await this.repo.getControls();
    const gating = normalizeGating(body?.planGating ?? {}, controls.plans.map((p) => p.code));
    await this.repo.patchConfig(this.actor(r), { planGating: gating }, 'membership.plan_gating.set');
    return { ok: true, planGating: gating };
  }

  @Post('limits')
  async setLimits(@Body(ValidatedBody(MP_LIMITS_BODY)) body: any, @Req() r: any) {
    this.requireManage(r);
    const v = validateLimits(body?.limits ?? body);
    if (!v.ok) this.unprocessable(v.errors);
    await this.repo.patchConfig(this.actor(r), { limits: v.value }, 'membership.limits.set');
    return { ok: true, limits: v.value };
  }

  @Post('rules')
  async setRules(@Body(ValidatedBody(MP_RULES_BODY)) body: any, @Req() r: any) {
    this.requireManage(r);
    const v = validateRules(body?.rules ?? body);
    if (!v.ok) this.unprocessable(v.errors);
    await this.repo.patchConfig(this.actor(r), { rules: v.value }, 'membership.rules.set');
    return { ok: true, rules: v.value };
  }

  @Post('templates')
  async createTemplate(@Body(ValidatedBody(MP_TEMPLATE_BODY)) body: any, @Req() r: any) {
    this.requireManage(r);
    const controls = await this.repo.getControls();
    const v = validateTemplate(body, Number(controls.limits?.maxTrialDays ?? 365), Number(controls.limits?.maxBenefitsPerProgram ?? 100), Number(controls.rules?.maxDiscountPercent ?? 100));
    if (!v.ok) this.unprocessable(v.errors);
    const status = body?.status === 'published' ? 'published' : 'draft';
    const res = await this.repo.createTemplate(this.actor(r), { ...v.value, status });
    return { ok: true, id: res.id };
  }

  @Patch('templates/:id')
  async updateTemplate(@Param('id') id: string, @Body(ValidatedBody(MP_TEMPLATE_BODY)) body: any, @Req() r: any) {
    this.requireManage(r);
    const controls = await this.repo.getControls();
    const v = validateTemplate(body, Number(controls.limits?.maxTrialDays ?? 365), Number(controls.limits?.maxBenefitsPerProgram ?? 100), Number(controls.rules?.maxDiscountPercent ?? 100));
    if (!v.ok) this.unprocessable(v.errors);
    const status = ['draft', 'published', 'archived'].includes(body?.status) ? body.status : undefined;
    const ok = await this.repo.updateTemplate(this.actor(r), id, v.value, status);
    if (!ok) throw new HttpException('template not found', HttpStatus.NOT_FOUND);
    return { ok: true };
  }
}
