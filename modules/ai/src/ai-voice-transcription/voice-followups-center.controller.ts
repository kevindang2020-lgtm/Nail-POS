// voice-followups-center.controller.ts — Voice Transcription Follow-Ups guide (Nov 2 2026): `/pos/ai-voice-transcription/follow-ups/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role from req.ctx. The center re-checks:
//   ai_voice_transcription.view_transcripts                  summary · items · items/history · check
//   + communications.manage or ai.manage                      items/task · items/dismiss · items/reopen
// A task is created in the ONE task system (ai_receptionist_follow_ups) — assignment, contact attempts, escalation and
// resolution continue on /pos/ai/follow-ups-center. Nothing here calls, texts, books or refunds.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { VoiceFollowUpsCenter, VoiceFollowUpError, VF_TABS, VF_TYPES, VF_DATE_FIELDS, VF_PRESETS, type VfCtx } from './voice-followups-center';

export const VOICE_FOLLOWUPS_CENTER = 'VoiceFollowUpsCenter';
const str = (max: number): BodySchema => S.nullable(S.string({ maxLength: max }));
export const VF_EMPTY_BODY: BodySchema = S.object({});
export const VF_TASK_BODY: BodySchema = S.object({ transcriptId: str(64), type: str(40), priority: str(16), dueLocal: str(25), assignedUserId: str(64), note: str(1000) });
export const VF_DECISION_BODY: BodySchema = S.object({ transcriptId: str(64), type: str(40), reason: str(500) });
function ctxFrom(req: any): VfCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
function authed(ctx: VfCtx) { if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED'); }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e instanceof VoiceFollowUpError) throw new HttpException({ code: e.code, message: e.message, ...e.extra }, e.status); throw e; }
}
const LIST = { filters: { tab: { type: 'enum', values: VF_TABS }, type: { type: 'enum', values: VF_TYPES }, dateField: { type: 'enum', values: VF_DATE_FIELDS }, preset: { type: 'enum', values: VF_PRESETS } },
  search: { maxLength: 80 }, sorts: { newest: null, priority: null, oldest: null }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/ai-voice-transcription/follow-ups')
export class VoiceFollowUpsCenterController {
  constructor(@Inject(VOICE_FOLLOWUPS_CENTER) private readonly vf: VoiceFollowUpsCenter | null) {}
  private c(): VoiceFollowUpsCenter { if (!this.vf) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Call follow-ups need the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.vf; }

  /** counters (one definition each), why the list is empty, the urgent lane */
  @Get('summary') @RequirePermission('ai_voice_transcription.view_transcripts')
  summary(@Req() q: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().summary(c)); }

  /** the items: tab · type · search · which date · presets / range · sort · numbered pages */
  @Get('items') @RequirePermission('ai_voice_transcription.view_transcripts') @ListQuery(LIST)
  items(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().list(c, f ?? {})); }

  /** one item's review history (append-only) */
  @Get('items/history') @RequirePermission('ai_voice_transcription.view_transcripts') @ListQuery({ maxLimit: 50, defaultLimit: 50, params: ['transcriptId', 'type'] } as const)
  history(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().history(c, String(f?.transcriptId ?? ''), String(f?.type ?? ''))); }

  /** turn an item into a follow-up task in the task system (idempotent; links an open task for the same call and reason) */
  @Post('items/task') @RequirePermission('ai_voice_transcription.view_transcripts')
  task(@Req() q: any, @Body(ValidatedBody(VF_TASK_BODY, { strict: true })) b: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().createTask(c, b ?? {})); }

  /** no action needed — reason required */
  @Post('items/dismiss') @RequirePermission('ai_voice_transcription.view_transcripts')
  dismiss(@Req() q: any, @Body(ValidatedBody(VF_DECISION_BODY, { strict: true })) b: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().dismiss(c, b ?? {})); }

  /** back to the queue — reason required */
  @Post('items/reopen') @RequirePermission('ai_voice_transcription.view_transcripts')
  reopen(@Req() q: any, @Body(ValidatedBody(VF_DECISION_BODY, { strict: true })) b: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().reopen(c, b ?? {})); }

  /** Check Voice Follow-Up System — read-only */
  @Post('check') @RequirePermission('ai_voice_transcription.view_transcripts')
  check(@Req() q: any, @Body(ValidatedBody(VF_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); authed(c); return run(() => this.c().check(c)); }
}
