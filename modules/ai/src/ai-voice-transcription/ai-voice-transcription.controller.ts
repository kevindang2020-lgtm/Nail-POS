// ai-voice-transcription.controller.ts — two entry points:
//  • VoiceTranscriptionController: tenant-authenticated read/consent/ingest (TenantAuthGuard + RolePermissionGuard);
//    tenant/branch come from req.ctx, never the client.
//  • VoiceTranscriptionWebhookController: provider webhook behind VoiceAuthGuard — the integration key resolves
//    tenant/branch server-side (req.voiceCtx); the body's tenant is never trusted. Ingestion is idempotent on
//    (tenant, provider, providerCallId) so a redelivered event never duplicates a transcript.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { VT_CONSENT_BODY, VT_DELETE_BODY, VT_INGEST_BODY, VT_LEGAL_HOLD_BODY, VT_RETENTION_SWEEP_BODY, VT_SETTINGS_BODY, VT_WEBHOOK_BODY } from '../request-schemas';
import { systemContext } from '@aipowersalon/tenant-context';
import { Controller, Get, Post, Put, Delete, Param, Query, Body, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { VoiceAuthGuard } from '../voice-booking/voice-auth.guard';
import { VoiceKeyRateLimitGuard } from '@aipowersalon/security/nest';
import { VoiceTranscriptionService } from './ai-voice-transcription.service';
import {
  VoiceTranscriptionForbiddenError, VoiceTranscriptionValidationError, VoiceTranscriptionDisabledError,
  ConsentRequiredError, VoiceSettingsConflictError, VoiceSettingsConfirmRequiredError, VoiceSettingsUnavailableError, type VoiceTranscriptionContext,
} from './ai-voice-transcription.dto';
import { ListQueries } from '@aipowersalon/database';
import { VoiceTranscriptionControllerListQueries } from './ai-voice-transcription.list-queries';

function ctxFrom(req: any): VoiceTranscriptionContext {
  const c = req?.ctx ?? {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions ?? [] };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof VoiceTranscriptionForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof VoiceTranscriptionDisabledError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof ConsentRequiredError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof VoiceTranscriptionValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    // Voice Transcription Settings guide (Nov 2026)
    if (e instanceof VoiceSettingsConflictError) throw new HttpException({ code: 'VT_SETTINGS_VERSION_CONFLICT', message: 'These settings were changed by someone else. Reload and try again.', currentVersion: e.currentVersion }, HttpStatus.CONFLICT);
    if (e instanceof VoiceSettingsConfirmRequiredError) throw new HttpException({ code: 'VT_CONFIRM_REQUIRED', message: 'This change needs confirmation.', impact: e.impact }, HttpStatus.CONFLICT);
    if (e instanceof VoiceSettingsUnavailableError) throw new HttpException({ code: 'VT_SETTINGS_UNAVAILABLE', message: 'The transcription settings could not be read.' }, HttpStatus.SERVICE_UNAVAILABLE);
    throw e;
  }
}

@ListQueries(VoiceTranscriptionControllerListQueries)
@Controller('pos/ai-voice-transcription')
@UseGuards(TenantAuthGuard, RolePermissionGuard)
export class VoiceTranscriptionController {
  constructor(private readonly svc: VoiceTranscriptionService) {}

  @Get('overview')
  @RequirePermission('ai_voice_transcription.view')
  overview(@Req() r: any) {
    return run(() => this.svc.getOverview(ctxFrom(r)));
  }

  @Get('unresolved')
  @RequirePermission('ai_voice_transcription.view_transcripts')
  unresolved(@Req() r: any, @Query() q: any) {
    return run(() => this.svc.listUnresolved(ctxFrom(r), q?.limit ? +q.limit : undefined));
  }

  @Get('settings')
  @RequirePermission('ai_voice_transcription.view')
  getSettings(@Req() r: any) {
    return run(() => this.svc.getSettings(ctxFrom(r)));
  }

  @Put('settings')
  @RequirePermission('ai_voice_transcription.manage_settings')
  putSettings(@Req() r: any, @Body(ValidatedBody(VT_SETTINGS_BODY, { strict: true })) b: any) {
    return run(() => this.svc.updateSettings(ctxFrom(r), {
      transcriptionEnabled: typeof b?.transcriptionEnabled === 'boolean' ? b.transcriptionEnabled : undefined,
      retentionDays: b?.retentionDays != null ? +b.retentionDays : undefined,
      retainRaw: typeof b?.retainRaw === 'boolean' ? b.retainRaw : undefined,
      consentAnnouncementVersion: b?.consentAnnouncementVersion !== undefined ? b.consentAnnouncementVersion : undefined,
    }, { expectedVersion: b?.expectedVersion != null ? +b.expectedVersion : null, confirm: b?.confirm === true }));
  }

  @Get('transcripts')
  @RequirePermission('ai_voice_transcription.view_transcripts')
  list(@Req() r: any, @Query() q: any) {
    return run(() => this.svc.listTranscripts(ctxFrom(r), {
      status: q?.status || undefined, branchId: q?.branchId || undefined, customerId: q?.customerId || undefined,
      direction: q?.direction || undefined, limit: q?.limit ? +q.limit : undefined, cursor: q?.cursor || undefined,
    }));
  }

  @Get('transcripts/search')
  @RequirePermission('ai_voice_transcription.view_transcripts')
  search(@Req() r: any, @Query() q: any) {
    return run(() => this.svc.search(ctxFrom(r), {
      q: q?.q || undefined, intent: q?.intent || undefined, customerId: q?.customerId || undefined,
      branchId: q?.branchId || undefined, direction: q?.direction || undefined, language: q?.language || undefined,
      status: q?.status || undefined, dateFrom: q?.dateFrom || undefined, dateTo: q?.dateTo || undefined,
      limit: q?.limit ? +q.limit : undefined,
    }));
  }

  @Get('transcripts/:id')
  @RequirePermission('ai_voice_transcription.view')
  detail(@Req() r: any, @Param('id') id: string) {
    return run(() => this.svc.getTranscript(ctxFrom(r), id));
  }

  // Most sensitive read: raw pre-redaction text, gated by a dedicated permission.
  @Get('transcripts/:id/raw')
  @RequirePermission('ai_voice_transcription.view_raw')
  raw(@Req() r: any, @Param('id') id: string) {
    return run(() => this.svc.getRawTranscript(ctxFrom(r), id));
  }

  @Get('transcripts/:id/intelligence')
  @RequirePermission('ai_voice_transcription.view')
  intelligence(@Req() r: any, @Param('id') id: string) {
    return run(() => this.svc.getIntelligence(ctxFrom(r), id));
  }

  @Post('transcripts/:id/summary')
  @RequirePermission('ai_voice_transcription.view')
  summary(@Req() r: any, @Param('id') id: string) {
    return run(() => this.svc.generateDetailedSummary(ctxFrom(r), id));
  }

  @Post('consent')
  @RequirePermission('ai_voice_transcription.manage_settings')
  consent(@Req() r: any, @Body(ValidatedBody(VT_CONSENT_BODY, { strict: true })) b: any) {
    return run(() => this.svc.recordConsent(ctxFrom(r), b));
  }

  @Post('ingest')
  @RequirePermission('ai_voice_transcription.manage_rules')
  ingest(@Req() r: any, @Body(ValidatedBody(VT_INGEST_BODY, { strict: true })) b: any) {
    return run(() => this.svc.ingest(ctxFrom(r), b));
  }

  @Delete('transcripts/:id')
  @RequirePermission('ai_voice_transcription.delete')
  remove(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(VT_DELETE_BODY, { strict: true })) b: any) {
    return run(() => this.svc.deleteTranscript(ctxFrom(r), id, b?.reason || 'manual'));
  }

  @Post('transcripts/:id/legal-hold')
  @RequirePermission('ai_voice_transcription.manage_settings')
  legalHold(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(VT_LEGAL_HOLD_BODY, { strict: true })) b: any) {
    return run(() => this.svc.setLegalHold(ctxFrom(r), id, !!b?.hold));
  }
}

@Controller('super-admin/voice-transcription')
@UseGuards(SuperAdminGuard)
export class VoiceTranscriptionSuperAdminController {
  constructor(private readonly svc: VoiceTranscriptionService) {}

  // Cross-tenant transcription oversight — aggregate COUNTS only (no tenant transcript content).
  @Get('overview')
  overview() {
    return this.svc.getPlatformOverview();
  }

  // Manual retention sweep (ops). The daily scheduler runs the same job; this lets an operator trigger it on demand.
  @Post('retention-sweep')
  retentionSweep(@Body(ValidatedBody(VT_RETENTION_SWEEP_BODY, { strict: true })) b: any) {
    return run(() => this.svc.runRetentionSweep(b?.limit ? +b.limit : undefined));
  }
}

@Controller('voice-transcription')
@UseGuards(VoiceAuthGuard, VoiceKeyRateLimitGuard)  // Constitution 12 §58: a leaked key has a budget
export class VoiceTranscriptionWebhookController {
  constructor(private readonly svc: VoiceTranscriptionService) {}

  // Provider posts a completed call. tenant/branch resolved from the integration key (req.voiceCtx), never the body.
  @Post('webhook')
  async webhook(@Req() r: any, @Body(ValidatedBody(VT_WEBHOOK_BODY)) b: any) {
    const vc = r?.voiceCtx;
    if (!vc?.tenantId) throw new HttpException('unauthorized', HttpStatus.UNAUTHORIZED);
    // System context: the validated integration key authorizes ingestion for this tenant/branch.
    const ctx = systemContext({ tenantId: vc.tenantId, branchId: vc.branchId, actor: 'voice-transcription-ingest', permissions: ['ai_voice_transcription.manage_settings', 'ai_voice_transcription.manage_rules'] }) as unknown as VoiceTranscriptionContext;
    const provider = r?.voiceProvider || b?.provider || 'retell';
    const providerCallId = b?.providerCallId || b?.call_id;
    if (!providerCallId) throw new HttpException('providerCallId required', HttpStatus.BAD_REQUEST);
    return run(async () => {
      // Consent evidence comes from the validated provider payload (not the client). Record it, then ingest.
      if (b?.consent) {
        await this.svc.recordConsent(ctx, {
          branchId: ctx.branchId, provider, providerCallId,
          consentStatus: b.consent.status ?? 'unknown', consentMethod: b.consent.method ?? null,
          recordingEnabled: !!b.consent.recordingEnabled, transcriptionEnabled: !!b.consent.transcriptionEnabled,
          announcementVersion: b.consent.announcementVersion ?? null, jurisdiction: b.consent.jurisdiction ?? null,
          initiatedBy: 'provider', consentAt: b.consent.at ?? null,
        });
      }
      const header = await this.svc.ingest(ctx, { provider, providerCallId, customerId: b?.customerId ?? null, recordingRef: b?.recordingRef ?? null, languageHint: b?.languageHint ?? null });
      return { ok: true, transcriptId: header.id, status: header.status };
    });
  }
}
