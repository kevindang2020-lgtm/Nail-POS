// reminder-channel.service.ts — Set Channels + Configure Fallback (§35, §36). The backend owns the channel decision:
// primary must be a supported channel, fallbacks a subset (never including the primary), and the resolved sequence is
// derived deterministically. previewFallback runs the pure resolver over a simulated attempt log to demonstrate
// stop-on-success / no-duplicate / exhaust behavior without dispatching anything.
import { BadRequestException } from '@nestjs/common';
import { REMINDER_TYPES, CHANNELS, resolveChannelSequence, planFallback, classifyFailure, type AttemptEvent } from './smart-reminders-core';
import { ReminderChannelRepository, type ChannelConfigRow } from './reminder-channel.kysely.repository';

export interface AdminCtx { userId?: string; email?: string; ip?: string }
const TYPE_KEYS = new Set<string>(REMINDER_TYPES.map((t) => t.key));
const SUPPORTED = new Set<string>(CHANNELS as readonly string[]);
const FALLBACK_ON = ['temporary_failure', 'timeout', 'any_failure'];
const validUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

function shape(row: ChannelConfigRow | null) {
  if (!row) return null;
  return {
    reminderType: row.reminder_type, primaryChannel: row.primary_channel, fallbackChannels: row.fallback_channels,
    sequence: resolveChannelSequence(row.primary_channel, row.fallback_channels), fallbackOn: row.fallback_on,
    maxFallbackAttempts: row.max_fallback_attempts, stopOnSuccess: row.stop_on_success,
    recheckSuppression: row.recheck_suppression, recheckQuietHours: row.recheck_quiet_hours, updatedAt: row.updated_at,
  };
}

export class ReminderChannelService {
  constructor(private readonly repo: ReminderChannelRepository) {}

  async list(tenantId: string | null) { return { tenantId, channels: (await this.repo.list(tenantId)).map(shape) }; }
  async get(tenantId: string | null, reminderType: string) {
    if (!TYPE_KEYS.has(reminderType)) throw new BadRequestException('invalid reminderType');
    return { reminderType, config: shape(await this.repo.get(tenantId, reminderType)) };
  }

  async setConfig(ctx: AdminCtx, body: any) {
    const reminderType = String(body?.reminderType ?? '');
    if (!TYPE_KEYS.has(reminderType)) throw new BadRequestException('invalid reminderType');
    const primary = String(body?.primaryChannel ?? '');
    if (!SUPPORTED.has(primary)) throw new BadRequestException('invalid primaryChannel');
    const fallbacksRaw = Array.isArray(body?.fallbackChannels) ? body.fallbackChannels.map((c: unknown) => String(c).toLowerCase()) : [];
    const bad = fallbacksRaw.filter((c: string) => !SUPPORTED.has(c));
    if (bad.length) throw new BadRequestException(`unsupported fallback channel(s): ${bad.join(', ')}`);
    if (fallbacksRaw.includes(primary)) throw new BadRequestException('primary channel must not appear in the fallback list');
    const fallbacks = [...new Set<string>(fallbacksRaw)];
    const fallbackOn = String(body?.fallbackOn ?? 'temporary_failure');
    if (!FALLBACK_ON.includes(fallbackOn)) throw new BadRequestException('invalid fallbackOn');
    const maxFallback = Number.isInteger(Number(body?.maxFallbackAttempts)) ? Math.max(0, Math.min(10, Number(body.maxFallbackAttempts))) : 1;
    const stopOnSuccess = body?.stopOnSuccess !== false;
    const recheckSuppression = body?.recheckSuppression !== false;
    const recheckQuietHours = body?.recheckQuietHours !== false;
    const tenantId = typeof body?.tenantId === 'string' && validUuid(body.tenantId) ? body.tenantId : null;

    const before = shape(await this.repo.get(tenantId, reminderType));
    await this.repo.upsert(tenantId, { reminderType, primary, fallbacks, fallbackOn, maxFallback, stopOnSuccess, recheckSuppression, recheckQuietHours, updatedBy: ctx.userId && validUuid(ctx.userId) ? ctx.userId : null });
    const after = shape(await this.repo.get(tenantId, reminderType));
    await this.repo.writeAudit(tenantId, ctx, 'reminder_channels_set', `Channels set for ${reminderType}: ${after?.sequence.join(' → ')}`, { before, after });
    return { ok: true, reminderType, before, after };
  }

  /** Demonstrate the fallback resolver over a simulated attempt log (no dispatch). Classifies each failure and steps
   *  through the sequence, proving stop-on-success and no-duplicate behavior. */
  previewFallback(body: any) {
    const primary = String(body?.primaryChannel ?? '');
    if (!SUPPORTED.has(primary)) throw new BadRequestException('invalid primaryChannel');
    const fallbacks = Array.isArray(body?.fallbackChannels) ? body.fallbackChannels.map((c: unknown) => String(c).toLowerCase()).filter((c: string) => SUPPORTED.has(c)) : [];
    const sequence = resolveChannelSequence(primary, fallbacks);
    const attempts: { channel: string; reason: string | null }[] = Array.isArray(body?.attempts) ? body.attempts : [];
    const events: AttemptEvent[] = attempts.map((a) => ({ channel: String(a.channel), outcome: a.reason === null || a.reason === undefined ? 'success' : classifyFailure(a.reason) }));
    const decision = planFallback(sequence, events);
    return { sequence, events, decision };
  }
}
