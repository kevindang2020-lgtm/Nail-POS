// voice-calls-center.controller.ts — Voice Transcription Search + Call History guides (Nov 3 2026): `/pos/ai-voice-transcription/calls/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role from req.ctx (never from the query). The center re-checks:
//   ai_voice_transcription.view_transcripts   summary · calls · call · check      (customer name / phone only with customers.view)
// Read-only: nothing here calls, texts, books or changes a call. Opening a call's transcript is audited.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { VoiceCallsCenter, VoiceCallsError, VC_STATUS, VC_DIRECTIONS, VC_INTENTS, VC_FOLLOWUP, VC_DATE_FIELDS, VC_PRESETS, type VcCtx } from './voice-calls-center';

export const VOICE_CALLS_CENTER = 'VoiceCallsCenter';
export const VC_EMPTY_BODY: BodySchema = S.object({});
function ctxFrom(req: any): VcCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
function authed(ctx: VcCtx) { if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED'); }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e instanceof VoiceCallsError) throw new HttpException({ code: e.code, message: e.message }, e.status); throw e; }
}
const LIST = { filters: { status: { type: 'enum', values: VC_STATUS }, direction: { type: 'enum', values: VC_DIRECTIONS }, intent: { type: 'enum', values: VC_INTENTS },
  followUp: { type: 'enum', values: VC_FOLLOWUP }, dateField: { type: 'enum', values: VC_DATE_FIELDS }, preset: { type: 'enum', values: VC_PRESETS }, language: { type: 'text' } },
  search: { maxLength: 100 }, sorts: { newest: null, oldest: null, best: null }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/ai-voice-transcription/calls')
export class VoiceCallsCenterController {
  constructor(@Inject(VOICE_CALLS_CENTER) private readonly vc: VoiceCallsCenter | null) {}
  private c(): VoiceCallsCenter { if (!this.vc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Call search needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.vc; }

  /** counters and, when a page is empty, why */
  @Get('summary') @RequirePermission('ai_voice_transcription.view_transcripts')
  summary(@Req() q: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().summary(c)); }

  /** Search + Call History: search · status · direction · language · intent · follow-up · which date · presets / range · sort · numbered pages */
  @Get() @RequirePermission('ai_voice_transcription.view_transcripts') @ListQuery(LIST)
  calls(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().list(c, f ?? {})); }

  /** the details overlay: redacted transcript, summary, what was asked, follow-up items, customer link (audited) */
  @Get('detail') @RequirePermission('ai_voice_transcription.view_transcripts') @ListQuery({ maxLimit: 1, defaultLimit: 1, params: ['id'] } as const)
  detail(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().call(c, String(f?.id ?? ''))); }

  /** Check Voice Transcription System — read-only */
  @Post('check') @RequirePermission('ai_voice_transcription.view_transcripts')
  check(@Req() q: any, @Body(ValidatedBody(VC_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); authed(c); return run(() => this.c().check(c)); }
}
