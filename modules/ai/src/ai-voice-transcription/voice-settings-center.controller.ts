// voice-settings-center.controller.ts — Voice Transcription Settings guide (Nov 2 2026): `/pos/ai-voice-transcription/center/*`,
// the settings page's read side. Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role from req.ctx.
//   ai_voice_transcription.view   summary · records · check
// Not behind the entitlement check on purpose: when the subscription lapses the page must SAY so and keep its retention,
// deletion and access records readable. The policy is saved on PUT settings; nothing here writes.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { VoiceSettingsCenter, VoiceCenterError, VC_KINDS, VC_PRESETS, type VcCtx } from './voice-settings-center';

export const VOICE_SETTINGS_CENTER = 'VoiceSettingsCenter';
export const VC_EMPTY_BODY: BodySchema = S.object({});
function ctxFrom(req: any): VcCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
function need(ctx: VcCtx) {
  if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  if (!(ctx.permissions ?? []).includes('ai_voice_transcription.view')) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot do this.' }, HttpStatus.FORBIDDEN);
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e instanceof VoiceCenterError) throw new HttpException({ code: e.code, message: e.message }, e.status); throw e; }
}
const RECORDS = { filters: { preset: { type: 'enum', values: VC_PRESETS }, kind: { type: 'enum', values: VC_KINDS } }, search: { maxLength: 80 }, dateRange: { maxDays: 3660 },
  maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/ai-voice-transcription/center')
export class VoiceSettingsCenterController {
  constructor(@Inject(VOICE_SETTINGS_CENTER) private readonly vc: VoiceSettingsCenter | null) {}
  private c(): VoiceSettingsCenter { if (!this.vc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Voice transcription needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.vc; }

  /** the status row: saved policy + version, subscription, transcription / redaction / raw / retention / consent from real rows */
  @Get('summary') @RequirePermission('ai_voice_transcription.view')
  summary(@Req() q: any) { const c = ctxFrom(q); need(c); return run(() => this.c().summary(c)); }

  /** Records: settings changes · deletions · processing failures · raw-text views (newest first, paged) */
  @Get('records') @RequirePermission('ai_voice_transcription.view') @ListQuery(RECORDS)
  records(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c); return run(() => this.c().records(c, f ?? {})); }

  /** Check Voice Transcription Settings — read-only */
  @Post('check') @RequirePermission('ai_voice_transcription.view')
  check(@Req() q: any, @Body(ValidatedBody(VC_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); need(c); return run(() => this.c().check(c)); }
}
