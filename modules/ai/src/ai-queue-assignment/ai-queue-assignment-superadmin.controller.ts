// ai-queue-assignment-superadmin.controller.ts — BUILD_PLAN Phase 6: platform oversight of AI queue assignment, behind
// SuperAdminGuard (same pattern as the Super Admin kill-switch centre). Reads need super_admin.operations.view; the
// per-salon auto kill switch needs super_admin.ai.manage + a RECENT step-up + a reason of at least 12 characters, and
// is audited (the settings version log + audit_logs, the salon's QUEUE_AUTO_ASSIGNMENT_DISABLED event, realtime to
// the salon). Separate controller so tenant routes and platform routes never share a guard.
import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { SuperAdminGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { AQ_SUPER_ADMIN_AUTO_KILL_BODY } from '../request-schemas';
import type { QueueSuperAdminReadPort } from './ai-queue-assignment-superadmin.repository';
import type { QueueAssignmentSettingsPort } from './ai-queue-assignment-settings';
import type { OpsEmitterPort } from './ai-queue-assignment-ops.notifications';
import { ListQueries } from '@aipowersalon/database';
import { QueueSuperAdminControllerListQueries } from './ai-queue-assignment-superadmin.list-queries';

export const MIN_KILL_REASON = 12;
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export class QueueSuperAdminError extends Error { constructor(readonly status: 400 | 404, m: string) { super(m); this.name = 'QueueSuperAdminError'; } }

export class QueueSuperAdminService {
  constructor(private readonly read: QueueSuperAdminReadPort, private readonly settings?: QueueAssignmentSettingsPort | null, private readonly emitter?: OpsEmitterPort | null,
    private readonly db?: Kysely<any> | null) {}
  platformOverview() { return this.read.aggregate(); }
  salons(q: { search?: string; limit?: number } = {}) { return this.read.salons(q); }

  async salonDetail(tenantId: string) {
    if (!isUuid(tenantId)) throw new QueueSuperAdminError(404, 'Salon not found.');
    const d = await this.read.salonDetail(tenantId);
    if (!d.tenant) throw new QueueSuperAdminError(404, 'Salon not found.');
    const salon = this.settings ? await this.settings.tenantSettings(tenantId) : null;
    const branches = await Promise.all(d.branches.map(async (b) => ({ ...b, effective: this.settings ? await this.settings.effective({ tenantId, branchId: b.branchId }) : null })));
    const versions = this.settings ? await this.settings.versions({ tenantId, branchId: null }, 20) : [];
    const anyEff = branches[0]?.effective ?? (this.settings ? await this.settings.effective({ tenantId, branchId: null }) : null);
    return { ...d, branches, salonSettings: salon, versions,
      auto: { salonKilled: salon?.autoKilled ?? false, salonKilledReason: salon?.autoKilledReason ?? null, platformAutoActionsDisabled: anyEff?.platformAutoActionsDisabled ?? false,
        branchesAllowed: branches.filter((b) => b.effective?.autoAllowed).length } };
  }

  async setAutoKill(actor: { userId: string | null }, tenantId: string, killed: unknown, reason: string) {
    if (!isUuid(tenantId)) throw new QueueSuperAdminError(404, 'Salon not found.');
    if (typeof killed !== 'boolean') throw new QueueSuperAdminError(400, 'Say whether to switch automatic assignment off (killed: true) or back on (killed: false).');
    const why = String(reason ?? '').trim();
    if (why.length < MIN_KILL_REASON) throw new QueueSuperAdminError(400, `A reason of at least ${MIN_KILL_REASON} characters is required.`);
    if (!this.settings) throw new QueueSuperAdminError(400, 'The kill switch needs the database.');
    const d = await this.read.salonDetail(tenantId);
    if (!d.tenant) throw new QueueSuperAdminError(404, 'Salon not found.');
    const effective = await this.settings.setSalonKill(tenantId, killed, { userId: actor.userId, role: 'SUPER_ADMIN' }, why, { change: killed ? 'platform_kill' : 'platform_unkill' });
    // the platform's own audit trail of a Super Admin acting on one salon (the settings log above is the salon's)
    if (this.db) await sql`insert into audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                           values (${tenantId}, ${actor.userId}, 'SUPER_ADMIN', ${killed ? 'super_admin_ai_queue_auto_killed' : 'super_admin_ai_queue_auto_released'}, 'queue_assignment_settings', ${tenantId},
                                   ${JSON.stringify({ killed, reason: why })}::jsonb)`.execute(this.db);
    this.emitter?.emit({ tenantId, branchId: null }, 'auto_killed', { scope: 'salon', killed, by: 'platform' });
    return { tenantId, killed: effective.salonAutoKilled, reason: effective.salonAutoKilledReason, version: effective.tenantVersion };
  }
}

function fail(e: unknown): never {
  if (e instanceof QueueSuperAdminError) throw e.status === 404 ? new NotFoundException(e.message) : new BadRequestException(e.message);
  throw e;
}

@ListQueries(QueueSuperAdminControllerListQueries)
@Controller('super-admin/ai-queue-assignment')
@UseGuards(SuperAdminGuard)
export class QueueSuperAdminController {
  constructor(private readonly svc: QueueSuperAdminService) {}

  @Get('overview') @RequirePermission('super_admin.operations.view')
  async overview() { return { ok: true, ...(await this.svc.platformOverview()) }; }

  @Get('tenants') @RequirePermission('super_admin.operations.view')
  async tenants(@Query('search') search?: string, @Query('limit') limit?: string) { return { rows: await this.svc.salons({ search, limit: limit ? Number(limit) : undefined }) }; }

  @Get('tenants/:tenantId') @RequirePermission('super_admin.operations.view')
  async tenant(@Param('tenantId') tenantId: string) { try { return await this.svc.salonDetail(String(tenantId)); } catch (e) { fail(e); } }

  @RequireStepUp()   // Constitution 7 §8: switching a salon's automatic assignment off (or back on) for them
  @Post('tenants/:tenantId/auto-kill') @RequirePermission('super_admin.ai.manage')
  async autoKill(@Param('tenantId') tenantId: string, @Body(ValidatedBody(AQ_SUPER_ADMIN_AUTO_KILL_BODY)) b: { killed?: boolean; reason?: string }, @Req() req: any) {
    try { return await this.svc.setAutoKill({ userId: req?.ctx?.userId ?? null }, String(tenantId), b?.killed, String(b?.reason ?? '')); } catch (e) { fail(e); }
  }
}
