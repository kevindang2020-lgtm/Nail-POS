// super-admin-voice.controller.ts — the admin management API for the AI voice receptionist. Behind SuperAdminGuard
// (normal admin auth — NOT the integration-key guard, which is for the voice provider). Every endpoint delegates to a
// real backend store built earlier (keys / call outcomes / learning), so the UI only ever shows real data. The admin
// selects the tenant/branch they're managing (they operate across tenants); those flow to the tenant-scoped services.
import { VoiceKeyService, VoiceCallOutcomeService, VoiceLearningService, LearningError, VoiceGatewayMetricsService, VoiceFleetService, ProvisioningMetricsService } from '@aipowersalon/ai';
import { Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { ListQueries } from '@aipowersalon/database';
import { SuperAdminVoiceControllerListQueries } from './super-admin-voice.list-queries';
import { VOICE_APPROVE_BODY, VOICE_KEY_BODY, VOICE_SCOPE_BODY } from '../request-schemas-leads';   // BUILD_PLAN Phase 12 (#17)

async function run<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (e instanceof HttpException) throw e;
    if (e instanceof LearningError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw new HttpException(e?.message || 'Error', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
const actorOf = (r: any) => (r?.ctx?.userId || null);
function need(v: string | undefined, name: string): string { if (!v) throw new HttpException(`${name} is required`, HttpStatus.BAD_REQUEST); return v; }

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminVoiceControllerListQueries)
@Controller('super-admin/voice')
export class SuperAdminVoiceController {
  constructor(
    private readonly keys: VoiceKeyService,
    private readonly outcomes: VoiceCallOutcomeService,
    private readonly learning: VoiceLearningService,
    private readonly metrics: VoiceGatewayMetricsService,
    private readonly fleet: VoiceFleetService,
    private readonly provMetrics: ProvisioningMetricsService,
  ) {}

  /** Platform-wide AI Receptionist rollup (cross-tenant aggregates only — no per-tenant row data). */
  @Get('fleet') fleetSummary() { return this.fleet.summary(); }

  /** Provisioning observability — since-process-start success/failure counters (resets on restart). */
  @Get('provisioning-metrics') provisioningMetrics() { return this.provMetrics.snapshot(); }

  // ---- Integration keys ----
  @Get('keys') listKeys(@Query('tenantId') tenantId: string) {
    return run(async () => (await this.keys.list(need(tenantId, 'tenantId'))).map(redactKey));
  }
  @Post('keys') issueKey(@Req() r: any, @Body(ValidatedBody(VOICE_KEY_BODY)) b: any) {
    return run(async () => {
      const { raw, row } = await this.keys.issue({
        tenantId: need(b?.tenantId, 'tenantId'), branchId: need(b?.branchId, 'branchId'),
        label: need(b?.label, 'label'), provider: b?.provider, environment: b?.environment === 'test' ? 'test' : 'live',
        createdByUserId: actorOf(r),
      });
      // The raw key is returned exactly once — the UI must tell the admin to copy it now.
      return { raw, key: redactKey(row) };
    });
  }
  @Patch('keys/:id/revoke') revokeKey(@Query('tenantId') tenantId: string, @Param('id') id: string) {
    return run(async () => ({ revoked: await this.keys.revoke(need(tenantId, 'tenantId'), id) }));
  }

  // ---- Call history (real outcome store) ----
  @Get('calls') listCalls(@Query('tenantId') tenantId: string, @Query('branchId') branchId?: string, @Query('limit') limit?: string) {
    return run(() => this.outcomes.list(need(tenantId, 'tenantId'), { branchId: branchId || undefined, limit: limit ? Number(limit) : undefined }));
  }
  @Get('calls/:callId') getCall(@Query('tenantId') tenantId: string, @Param('callId') callId: string) {
    return run(() => this.outcomes.get(need(tenantId, 'tenantId'), callId));
  }
  @Get('analytics') analytics(@Query('tenantId') tenantId: string, @Query('branchId') branchId?: string) {
    return run(() => this.outcomes.summary(need(tenantId, 'tenantId'), { branchId: branchId || undefined }));
  }

  // ---- Gateway operational health (in-process, since process start; not tenant-scoped) ----
  @Get('gateway-metrics') gatewayMetrics() {
    return this.metrics.snapshot();
  }

  // ---- Learning: review suggestions + manage prompt versions (human approval gate) ----
  @Get('suggestions') listSuggestions(@Query('tenantId') tenantId: string, @Query('status') status?: string) {
    return run(() => this.learning.listSuggestions({ tenantId: need(tenantId, 'tenantId'), branchId: '' }, status));
  }
  @Post('suggestions/:id/approve') approve(@Req() r: any, @Query('tenantId') tenantId: string, @Param('id') id: string, @Body(ValidatedBody(VOICE_APPROVE_BODY)) b: any) {
    return run(() => this.learning.approveSuggestion({ tenantId: need(tenantId, 'tenantId'), branchId: '' }, id, actorOf(r) || 'admin', b?.newPromptBody, b?.scope));
  }
  @Post('suggestions/:id/reject') reject(@Req() r: any, @Query('tenantId') tenantId: string, @Param('id') id: string) {
    return run(() => this.learning.rejectSuggestion({ tenantId: need(tenantId, 'tenantId'), branchId: '' }, id, actorOf(r) || 'admin'));
  }
  @Post('prompts/:id/submit') submit(@Query('tenantId') tenantId: string, @Param('id') id: string) {
    return run(() => this.learning.submitForReview({ tenantId: need(tenantId, 'tenantId'), branchId: '' }, id));
  }
  @Post('prompts/:id/activate') activate(@Req() r: any, @Query('tenantId') tenantId: string, @Param('id') id: string, @Body(ValidatedBody(VOICE_SCOPE_BODY)) b: any) {
    return run(() => this.learning.activatePromptVersion({ tenantId: need(tenantId, 'tenantId'), branchId: '' }, id, actorOf(r) || 'admin', b?.scope));
  }
  @Post('prompts/rollback') rollback(@Query('tenantId') tenantId: string, @Body(ValidatedBody(VOICE_SCOPE_BODY)) b: any) {
    return run(() => this.learning.rollback({ tenantId: need(tenantId, 'tenantId'), branchId: '' }, b?.scope));
  }
  @Get('prompts/active') activePrompt(@Query('tenantId') tenantId: string, @Query('scope') scope?: string) {
    return run(() => this.learning.activePrompt({ tenantId: need(tenantId, 'tenantId'), branchId: '' }, scope));
  }
}

/** Never expose the secret hash to the UI — only the display prefix + status fields. */
function redactKey(k: any) {
  return { id: k.id, tenantId: k.tenantId, branchId: k.branchId, label: k.label, provider: k.provider, prefix: k.prefix, lastUsedMs: k.lastUsedMs, expiresMs: k.expiresMs, revokedMs: k.revokedMs, createdMs: k.createdMs };
}
