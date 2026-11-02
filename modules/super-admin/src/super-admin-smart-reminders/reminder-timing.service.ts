// reminder-timing.service.ts — Configure Default Timing (§34). Validates and upserts the timing configuration for a
// reminder type: direction + offset must sit inside the allowed [min,max] band, min<=max, quiet hours are a valid
// minute-of-day pair (both or neither), and the quiet-hour policy / timezone source are enum-constrained. Records a
// before/after audit. The stored band is what tenant customizations and job scheduling must later respect.
import { BadRequestException } from '@nestjs/common';
import { REMINDER_TYPES, signedOffsetMinutes, withinRange, minuteOfDayLabel, type TimingDirection } from './smart-reminders-core';
import { ReminderTimingRepository, type TimingRow } from './reminder-timing.kysely.repository';

export interface AdminCtx { userId?: string; email?: string; ip?: string }
const TYPE_KEYS = new Set<string>(REMINDER_TYPES.map((t) => t.key));
const DIRECTIONS = ['before', 'after', 'immediate'];
const QH_POLICIES = ['defer', 'skip', 'send'];
const TZ_SOURCES = ['tenant', 'branch', 'customer'];
const validUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const intIn = (v: unknown, name: string, lo: number, hi: number): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new BadRequestException(`${name} must be an integer in [${lo}, ${hi}]`);
  return n;
};
const qhOrNull = (v: unknown, name: string): number | null => (v == null || v === '' ? null : intIn(v, name, 0, 1439));

function shape(row: TimingRow | null) {
  if (!row) return null;
  return {
    reminderType: row.reminder_type, direction: row.direction, offsetMinutes: row.offset_minutes,
    minOffsetMinutes: row.min_offset_minutes, maxOffsetMinutes: row.max_offset_minutes,
    signedOffset: signedOffsetMinutes(row.direction as TimingDirection, row.offset_minutes),
    quietHoursStart: row.quiet_hours_start, quietHoursEnd: row.quiet_hours_end,
    quietHoursLabel: row.quiet_hours_start != null && row.quiet_hours_end != null ? `${minuteOfDayLabel(row.quiet_hours_start)}–${minuteOfDayLabel(row.quiet_hours_end)}` : null,
    quietHoursPolicy: row.quiet_hours_policy, timezoneSource: row.timezone_source, enabled: row.enabled, updatedAt: row.updated_at,
  };
}

export class ReminderTimingService {
  constructor(private readonly repo: ReminderTimingRepository) {}

  async list(tenantId: string | null) { return { timing: (await this.repo.list(tenantId)).map(shape) }; }

  async get(tenantId: string | null, reminderType: string) {
    if (!TYPE_KEYS.has(reminderType)) throw new BadRequestException('invalid reminderType');
    return { reminderType, timing: shape(await this.repo.get(tenantId, reminderType)) };
  }

  async setTiming(ctx: AdminCtx, body: any) {
    const reminderType = String(body?.reminderType ?? '');
    if (!TYPE_KEYS.has(reminderType)) throw new BadRequestException('invalid reminderType');
    const direction = String(body?.direction ?? 'before');
    if (!DIRECTIONS.includes(direction)) throw new BadRequestException('invalid direction');
    const min = intIn(body?.minOffsetMinutes ?? 0, 'minOffsetMinutes', 0, 525600);
    const max = intIn(body?.maxOffsetMinutes ?? 10080, 'maxOffsetMinutes', 0, 525600);
    if (min > max) throw new BadRequestException('minOffsetMinutes must be <= maxOffsetMinutes');
    const offset = direction === 'immediate' ? 0 : intIn(body?.offsetMinutes ?? 0, 'offsetMinutes', 0, 525600);
    if (direction !== 'immediate' && !withinRange(offset, min, max)) throw new BadRequestException(`offsetMinutes ${offset} is outside the allowed range [${min}, ${max}]`);
    const qhStart = qhOrNull(body?.quietHoursStart, 'quietHoursStart');
    const qhEnd = qhOrNull(body?.quietHoursEnd, 'quietHoursEnd');
    if ((qhStart == null) !== (qhEnd == null)) throw new BadRequestException('quiet hours require both start and end (or neither)');
    const qhPolicy = String(body?.quietHoursPolicy ?? 'defer');
    if (!QH_POLICIES.includes(qhPolicy)) throw new BadRequestException('invalid quietHoursPolicy');
    const tzSource = String(body?.timezoneSource ?? 'tenant');
    if (!TZ_SOURCES.includes(tzSource)) throw new BadRequestException('invalid timezoneSource');
    const enabled = body?.enabled !== false;
    const tenantId = typeof body?.tenantId === 'string' && validUuid(body.tenantId) ? body.tenantId : null;

    const before = shape(await this.repo.get(tenantId, reminderType));
    await this.repo.upsert(tenantId, { reminderType, direction, offset, min, max, qhStart, qhEnd, qhPolicy, tzSource, enabled, updatedBy: ctx.userId && validUuid(ctx.userId) ? ctx.userId : null });
    const after = shape(await this.repo.get(tenantId, reminderType));
    await this.repo.writeAudit(tenantId, ctx, 'reminder_timing_set', `Default timing set for ${reminderType}`, { before, after });
    return { ok: true, reminderType, before, after };
  }
}
