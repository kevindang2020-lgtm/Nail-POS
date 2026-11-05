// tenant-receptionist.controller.ts — tenant-facing AI Receptionist read API (`/tenant/ai/receptionist/*`). Behind
// TenantAuthGuard (POS roles only); scope is taken from req.ctx (session), never the client, so a salon only ever
// sees its own receptionist. Powers the pos-web AI Receptionist Command Center.
import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { RequiresAiPackage } from '../ai-entitlement/ai-entitlement.guard';
import { TenantAuthGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { RECEPTIONIST_AGENT_BODY, RECEPTIONIST_AGENT_STATUS_BODY, RECEPTIONIST_FAQ_BODY, RECEPTIONIST_FOLLOW_UP_ASSIGN_BODY, RECEPTIONIST_FOLLOW_UP_BODY, RECEPTIONIST_FOLLOW_UP_NOTE_BODY, RECEPTIONIST_FOLLOW_UP_STATUS_BODY, RECEPTIONIST_SETTINGS_BODY } from '../request-schemas';
import { TenantReceptionistService, type ReceptionistCtx } from './tenant-receptionist.service';
import { AiAgentService, AgentForbiddenError, AgentNotFoundError, type AgentCtx } from './ai-agent.service';
import { AgentValidationError, type AgentStatus } from './ai-agent-core';
import { AiFollowUpService, FollowUpForbiddenError, FollowUpNotFoundError, FollowUpValidationError, type FollowUpCtx, type FollowUpStatus } from './ai-follow-up.service';
import { AiFaqService, FaqForbiddenError, FaqNotFoundError, FaqValidationError, type FaqCtx } from './ai-faq.service';
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
  constructor(private readonly svc: TenantReceptionistService, private readonly agents: AiAgentService, private readonly followUps: AiFollowUpService, private readonly faqs: AiFaqService, private readonly settings: AiSettingsService, private readonly provisioning: AiProvisioningService, private readonly audit: AuditService) {}

  /** Emit a resilient audit event for a high-risk AI Receptionist action (never throws). */
  private aud(r: any, action: string, resourceId: string | null, summary: string, metadata?: Record<string, unknown>) {
    const c = r?.ctx || {};
    return this.audit.record({ tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId } as any, { module: 'ai_receptionist', action, resourceType: 'ai_receptionist', resourceId, summary, metadata });
  }

  @RequirePermission('ai.use') @Get('overview') overview(@Req() r: any) { return this.svc.overview(ctxFrom(r)); }
  @RequirePermission('ai.use') @Get('calls') calls(@Req() r: any, @Query('limit') limit?: string) { return this.svc.recentCalls(ctxFrom(r), Number(limit) || 20); }
  @RequirePermission('ai.use') @Get('calls/:providerCallId') callDetail(@Req() r: any, @Param('providerCallId') id: string) { return this.svc.callDetail(ctxFrom(r), id); }

  // ---- Front Desk agents (config/draft lifecycle) ----
  @RequirePermission('ai.use') @Get('agents') listAgents(@Req() r: any, @Query('status') status?: string) { return runAgent(() => this.agents.list(ctxFrom(r) as AgentCtx, { status })); }
  @RequirePermission('ai.use') @Get('agents/:id') getAgent(@Req() r: any, @Param('id') id: string) { return runAgent(() => this.agents.get(ctxFrom(r) as AgentCtx, id)); }
  @RequirePermission('ai.manage') @Post('agents') async createAgent(@Req() r: any, @Body(ValidatedBody(RECEPTIONIST_AGENT_BODY)) b: any) { const a = await runAgent(() => this.agents.createDraft(ctxFrom(r) as AgentCtx, b || {})); await this.aud(r, 'agent.created', a.id, `Created agent "${a.name}"`); return a; }
  @RequirePermission('ai.manage') @Patch('agents/:id') async updateAgent(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RECEPTIONIST_AGENT_BODY)) b: any) { const a = await runAgent(() => this.agents.update(ctxFrom(r) as AgentCtx, id, b || {})); await this.aud(r, 'agent.updated', id, `Updated agent "${a.name}"`); return a; }
  @RequirePermission('ai.manage') @Post('agents/:id/status') async setStatus(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RECEPTIONIST_AGENT_STATUS_BODY)) b: any) { const a = await runAgent(() => this.agents.setStatus(ctxFrom(r) as AgentCtx, id, String(b?.status) as AgentStatus)); await this.aud(r, 'agent.status_changed', id, `Agent status \u2192 ${a.status}`, { status: a.status }); return a; }
  @RequirePermission('ai.manage') @Post('agents/:id/provision') async provision(@Req() r: any, @Param('id') id: string) { const j = await runAgent(() => this.provisioning.start(ctxFrom(r) as ProvCtx, id)); await this.aud(r, 'agent.provision_started', id, 'Started agent provisioning', { jobId: j.id }); return j; }
  @RequirePermission('ai.use') @Get('provisioning/:jobId') provisioningJob(@Req() r: any, @Param('jobId') jobId: string) { return runAgent(() => this.provisioning.get(ctxFrom(r) as ProvCtx, jobId)); }

  // ---- Follow-ups ----
  @RequirePermission('ai.use') @Get('follow-ups') listFollowUps(@Req() r: any, @Query('status') status?: string, @Query('mine') mine?: string) { return runAgent(() => this.followUps.list(ctxFrom(r) as FollowUpCtx, { status, mine: mine === '1' || mine === 'true' })); }
  @RequirePermission('ai.manage') @Post('follow-ups') async createFollowUp(@Req() r: any, @Body(ValidatedBody(RECEPTIONIST_FOLLOW_UP_BODY)) b: any) { const fu = await runAgent(() => this.followUps.createManual(ctxFrom(r) as FollowUpCtx, b || {})); await this.aud(r, 'follow_up.created', fu.id, `Follow-up: ${fu.reason}`, { reason: fu.reason }); return fu; }
  @RequirePermission('ai.manage') @Post('follow-ups/:id/assign') assignFollowUp(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RECEPTIONIST_FOLLOW_UP_ASSIGN_BODY)) b: any) { return runAgent(() => this.followUps.assign(ctxFrom(r) as FollowUpCtx, id, b?.assignedUserId ?? null)); }
  @RequirePermission('ai.manage') @Post('follow-ups/:id/note') noteFollowUp(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RECEPTIONIST_FOLLOW_UP_NOTE_BODY)) b: any) { return runAgent(() => this.followUps.addNote(ctxFrom(r) as FollowUpCtx, id, String(b?.note ?? ''))); }
  @RequirePermission('ai.manage') @Post('follow-ups/:id/status') async statusFollowUp(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RECEPTIONIST_FOLLOW_UP_STATUS_BODY)) b: any) { const fu = await runAgent(() => this.followUps.setStatus(ctxFrom(r) as FollowUpCtx, id, String(b?.status) as FollowUpStatus, b?.resolution)); await this.aud(r, 'follow_up.status_changed', id, `Follow-up \u2192 ${fu.status}`, { status: fu.status }); return fu; }

  // ---- FAQs (customer-facing knowledge the AI may answer) ----
  @RequirePermission('ai.use') @Get('faqs') listFaqs(@Req() r: any) { return runAgent(() => this.faqs.list(ctxFrom(r) as FaqCtx)); }
  @RequirePermission('ai.manage') @Post('faqs') async createFaq(@Req() r: any, @Body(ValidatedBody(RECEPTIONIST_FAQ_BODY)) b: any) { const f = await runAgent(() => this.faqs.create(ctxFrom(r) as FaqCtx, b || {})); await this.aud(r, 'faq.created', f.id, 'Created FAQ'); return f; }
  @RequirePermission('ai.manage') @Patch('faqs/:id') async updateFaq(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RECEPTIONIST_FAQ_BODY)) b: any) { const f = await runAgent(() => this.faqs.update(ctxFrom(r) as FaqCtx, id, b || {})); await this.aud(r, 'faq.updated', id, 'Updated FAQ', { isActive: f.isActive }); return f; }
  @RequirePermission('ai.manage') @Delete('faqs/:id') async deleteFaq(@Req() r: any, @Param('id') id: string) { const res = await runAgent(() => this.faqs.remove(ctxFrom(r) as FaqCtx, id)); await this.aud(r, 'faq.deleted', id, 'Deleted FAQ'); return res; }

  // ---- Settings (receptionist-level only; booking/notification prefs link out to their existing screens) ----
  @RequirePermission('ai.use') @Get('settings') getSettings(@Req() r: any) { return runAgent(() => this.settings.get(ctxFrom(r) as SettingsCtx)); }
  @RequirePermission('ai.manage') @Patch('settings') async updateSettings(@Req() r: any, @Body(ValidatedBody(RECEPTIONIST_SETTINGS_BODY)) b: any) { const s = await runAgent(() => this.settings.update(ctxFrom(r) as SettingsCtx, b || {})); await this.aud(r, 'settings.updated', null, 'Updated receptionist settings', { changed: Object.keys(b || {}) }); return s; }
}
