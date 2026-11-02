// tenant-receptionist.controller.ts — tenant-facing AI Receptionist read API (`/tenant/ai/receptionist/*`). Behind
// TenantAuthGuard (POS roles only); scope is taken from req.ctx (session), never the client, so a salon only ever
// sees its own receptionist. Powers the pos-web AI Receptionist Command Center.
import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { RequiresAiPackage } from '../ai-entitlement/ai-entitlement.guard';
import { TenantAuthGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { RECEPTIONIST_SETTINGS_BODY } from '../request-schemas';
import { TenantReceptionistService, type ReceptionistCtx } from './tenant-receptionist.service';
import { AiAgentService, AgentForbiddenError, AgentNotFoundError } from './ai-agent.service';
import { AgentValidationError } from './ai-agent-core';
import { AiFollowUpService, FollowUpForbiddenError, FollowUpNotFoundError, FollowUpValidationError } from './ai-follow-up.service';
import { AiFaqService, FaqForbiddenError, FaqNotFoundError, FaqValidationError } from './ai-faq.service';
import { AiSettingsService, SettingsForbiddenError, SettingsValidationError, type SettingsCtx } from './ai-settings.service';
import { AiProvisioningService, ProvForbiddenError, ProvNotFoundError, type ProvCtx } from './ai-provisioning.service';
import { AuditService } from '@aipowersalon/audit';
import { ListQueries } from '@aipowersalon/database';
import { TenantReceptionistControllerListQueries } from './tenant-receptionist.list-queries';

function ctxFrom(req: any): ReceptionistCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}

async function runAgent<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof AgentForbiddenError || e instanceof FollowUpForbiddenError || e instanceof FaqForbiddenError || e instanceof SettingsForbiddenError || e instanceof ProvForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof AgentNotFoundError || e instanceof FollowUpNotFoundError || e instanceof FaqNotFoundError || e instanceof ProvNotFoundError) throw new HttpException(e.message, HttpStatus.NOT_FOUND);
    if (e instanceof AgentValidationError || e instanceof FollowUpValidationError || e instanceof FaqValidationError || e instanceof SettingsValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw new HttpException(e?.message || 'Error', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

@UseGuards(TenantAuthGuard)
// Gated on the tenant's AI subscription. Ships in OBSERVE mode: the call still runs, but a tenant who is
// unsubscribed / expired / over-limit is RECORDED as a would-be denial in ai_usage_logs. Nobody's access
// changes until AI_ENTITLEMENT_ENFORCEMENT=enforce is set deliberately - see ai-entitlement.guard.ts.
@RequiresAiPackage('ai_phone_call_assistant')
@ListQueries(TenantReceptionistControllerListQueries)
@Controller('tenant/ai/receptionist')
export class TenantReceptionistController {
  constructor(private readonly svc: TenantReceptionistService, private readonly _agents: AiAgentService,   // kept for DI position; the agent routes moved to pos/ai/front-desk (Oct 31 2026)
    _followUps: AiFollowUpService, _faqs: AiFaqService,   // kept for DI position; follow-ups → pos/ai/follow-ups-center, FAQs → pos/ai/business-setup (Oct 31 2026)
    private readonly settings: AiSettingsService, private readonly provisioning: AiProvisioningService, private readonly audit: AuditService) {}

  /** Emit a resilient audit event for a high-risk AI Receptionist action (never throws). */
  private aud(r: any, action: string, resourceId: string | null, summary: string, metadata?: Record<string, unknown>) {
    const c = r?.ctx || {};
    return this.audit.record({ tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId } as any, { module: 'ai_receptionist', action, resourceType: 'ai_receptionist', resourceId, summary, metadata });
  }

  // AI Follow-Ups guide (Oct 31 2026): the five `follow-ups` routes are RETIRED. They wrote status / assignment / notes with no row
  // version, no assignee validation and no activity history; the task center is /pos/ai/follow-ups-center/* (ai-follow-up-center.ts).
  // The gateway's handoff still creates tasks through AiFollowUpService.createFromHandoff → the durable ai-handoff.ts path.
  @RequirePermission('ai.use') @Get('overview') overview(@Req() r: any) { return this.svc.overview(ctxFrom(r)); }
  @RequirePermission('ai.use') @Get('calls') calls(@Req() r: any, @Query('limit') limit?: string) { return this.svc.recentCalls(ctxFrom(r), Number(limit) || 20); }
  @RequirePermission('ai.use') @Get('calls/:providerCallId') callDetail(@Req() r: any, @Param('providerCallId') id: string) { return this.svc.callDetail(ctxFrom(r), id); }

  // ---- Front Desk agents: list / get / create / update / status RETIRED Oct 31 2026 (AI Front Desk guide) — the only caller was
  // the rebuilt Front Desk screen, which now uses /pos/ai/front-desk/* (versioned drafts, owner-approved activation). The old
  // status route could move an agent to LIVE with no routing evidence. Provisioning (an explicit provider action) stays here.
  @RequirePermission('ai.manage') @Post('agents/:id/provision') async provision(@Req() r: any, @Param('id') id: string) { const j = await runAgent(() => this.provisioning.start(ctxFrom(r) as ProvCtx, id)); await this.aud(r, 'agent.provision_started', id, 'Started agent provisioning', { jobId: j.id }); return j; }
  @RequirePermission('ai.use') @Get('provisioning/:jobId') provisioningJob(@Req() r: any, @Param('jobId') jobId: string) { return runAgent(() => this.provisioning.get(ctxFrom(r) as ProvCtx, jobId)); }

  // ---- Follow-ups ----

  // ---- FAQs (customer-facing knowledge the AI may answer) ----

  // ---- Settings (receptionist-level only; booking/notification prefs link out to their existing screens) ----
  @RequirePermission('ai.use') @Get('settings') getSettings(@Req() r: any) { return runAgent(() => this.settings.get(ctxFrom(r) as SettingsCtx)); }
  @RequirePermission('ai.manage') @Patch('settings') async updateSettings(@Req() r: any, @Body(ValidatedBody(RECEPTIONIST_SETTINGS_BODY)) b: any) { const s = await runAgent(() => this.settings.update(ctxFrom(r) as SettingsCtx, b || {})); await this.aud(r, 'settings.updated', null, 'Updated receptionist settings', { changed: Object.keys(b || {}) }); return s; }
}
