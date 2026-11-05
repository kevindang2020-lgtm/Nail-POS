// reminder-overrides.service.ts — Allow Tenant Customization (§42). A tenant override is stored separately from the
// platform default and is BOUNDED by it: a timing override must sit inside the platform's allowed [min,max] band, and a
// channel override must be a subset of the supported channels. Overrides can never widen the band or bypass platform
// limits. getEffective merges platform default + override (override wins where set) and labels the source of each field.
// revert deletes the override so the effective config falls back to the platform default. All writes are audited.
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { REMINDER_TYPES, CHANNELS, withinRange, type TimingDirection, signedOffsetMinutes } from './smart-reminders-core';
import { ReminderOverridesRepository, type OverrideRow } from './reminder-overrides.kysely.repository';
import { ReminderTimingRepository, type TimingRow } from './reminder-timing.kysely.repository';

export interface AdminCtx { userId?: string; email?: string; ip?: string }
const TYPE_KEYS = new Set<string>(REMINDER_TYPES.map((t) => t.key));
const SUPPORTED_CHANNELS = new Set<string>(CHANNELS as readonly string[]);
const validUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

function shapeOverride(row: OverrideRow | null) {
  if (!row) return null;
  return { reminderType: row.reminder_type, enabled: row.enabled, direction: row.direction, offsetMinutes: row.offset_minutes, channels: row.channels, quietHoursPolicy: row.quiet_hours_policy, approvalState: row.approval_state, updatedAt: row.updated_at };
}

export class ReminderOverridesService {
  constructor(private readonly overrides: ReminderOverridesRepository, private readonly timing: ReminderTimingRepository) {}

  async list(tenantId: string) {
    if (!validUuid(tenantId)) throw new BadRequestException('invalid tenantId');
    return { tenantId, overrides: (await this.overrides.list(tenantId)).map(shapeOverride) };
  }

  /** Effective merged config = platform default with the tenant override layered on top (override wins where set). */
  async getEffective(tenantId: string, reminderType: string) {
    if (!validUuid(tenantId)) throw new BadRequestException('invalid tenantId');
    if (!TYPE_KEYS.has(reminderType)) throw new BadRequestException('invalid reminderType');
    const platform = await this.timing.get(null, reminderType);
    const ovr = await this.overrides.get(tenantId, reminderType);
    const effective = {
      enabled: ovr ? ovr.enabled : true,
      direction: ovr?.direction ?? platform?.direction ?? 'before',
      directionSource: ovr?.direction ? 'override' : (platform ? 'platform' : 'default'),
      offsetMinutes: ovr?.offset_minutes ?? platform?.offset_minutes ?? 0,
      offsetSource: ovr?.offset_minutes != null ? 'override' : (platform ? 'platform' : 'default'),
      channels: ovr?.channels ?? null,
      channelsSource: ovr?.channels ? 'override' : 'inherit',
      quietHoursPolicy: ovr?.quiet_hours_policy ?? platform?.quiet_hours_policy ?? 'defer',
      allowedBand: platform ? { min: platform.min_offset_minutes, max: platform.max_offset_minutes } : null,
    };
    return { tenantId, reminderType, platform: platform ? { direction: platform.direction, offsetMinutes: platform.offset_minutes, min: platform.min_offset_minutes, max: platform.max_offset_minutes } : null, override: shapeOverride(ovr), effective };
  }

  async setOverride(ctx: AdminCtx, tenantId: string, body: any) {
    if (!validUuid(tenantId)) throw new BadRequestException('invalid tenantId');
    const reminderType = String(body?.reminderType ?? '');
    if (!TYPE_KEYS.has(reminderType)) throw new BadRequestException('invalid reminderType');

    const platform: TimingRow | null = await this.timing.get(null, reminderType);
    const enabled = body?.enabled !== false;

    // Timing override — must sit inside the platform allowed band (tenants cannot widen platform limits).
    let direction: string | null = null;
    let offset: number | null = null;
    if (body?.offsetMinutes !== undefined && body?.offsetMinutes !== null && body?.offsetMinutes !== '') {
      const dir = String(body?.direction ?? platform?.direction ?? 'before');
      if (!['before', 'after', 'immediate'].includes(dir)) throw new BadRequestException('invalid direction');
      const o = Number(body.offsetMinutes);
      if (!Number.isInteger(o) || o < 0) throw new BadRequestException('offsetMinutes must be a non-negative integer');
      if (dir !== 'immediate' && platform && !withinRange(o, platform.min_offset_minutes, platform.max_offset_minutes)) {
        throw new BadRequestException(`offsetMinutes ${o} is outside the platform-allowed range [${platform.min_offset_minutes}, ${platform.max_offset_minutes}] and cannot be set by a tenant`);
      }
      direction = dir; offset = dir === 'immediate' ? 0 : o;
    } else if (body?.direction !== undefined && body?.direction !== null && body?.direction !== '') {
      const dir = String(body.direction);
      if (!['before', 'after', 'immediate'].includes(dir)) throw new BadRequestException('invalid direction');
      direction = dir;
    }

    // Channel override — must be a non-empty subset of the supported channels (no disallowed channels).
    let channels: string[] | null = null;
    if (Array.isArray(body?.channels)) {
      const cs = body.channels.map((c: unknown) => String(c).toLowerCase());
      const bad = cs.filter((c: string) => !SUPPORTED_CHANNELS.has(c));
      if (bad.length) throw new BadRequestException(`unsupported channel(s): ${bad.join(', ')}`);
      if (!cs.length) throw new BadRequestException('channels override must include at least one channel');
      channels = [...new Set<string>(cs)];
    }

    let quietPolicy: string | null = null;
    if (body?.quietHoursPolicy !== undefined && body?.quietHoursPolicy !== null && body?.quietHoursPolicy !== '') {
      quietPolicy = String(body.quietHoursPolicy);
      if (!['defer', 'skip', 'send'].includes(quietPolicy)) throw new BadRequestException('invalid quietHoursPolicy');
    }
    const approvalState = ['pending', 'approved', 'rejected'].includes(String(body?.approvalState)) ? String(body.approvalState) : 'approved';

    const before = shapeOverride(await this.overrides.get(tenantId, reminderType));
    await this.overrides.upsert(tenantId, { reminderType, enabled, direction, offset, channels, quietPolicy, approvalState, updatedBy: ctx.userId && validUuid(ctx.userId) ? ctx.userId : null });
    await this.overrides.writeAudit(tenantId, ctx, 'tenant_customization_set', `Tenant customization set for ${reminderType}`, { before, after: shapeOverride(await this.overrides.get(tenantId, reminderType)) });
    return { ok: true, tenantId, reminderType, effective: (await this.getEffective(tenantId, reminderType)).effective };
  }

  async revert(ctx: AdminCtx, tenantId: string, reminderType: string) {
    if (!validUuid(tenantId)) throw new BadRequestException('invalid tenantId');
    if (!TYPE_KEYS.has(reminderType)) throw new BadRequestException('invalid reminderType');
    const before = shapeOverride(await this.overrides.get(tenantId, reminderType));
    if (!before) throw new NotFoundException('no tenant customization to revert');
    await this.overrides.remove(tenantId, reminderType);
    await this.overrides.writeAudit(tenantId, ctx, 'tenant_customization_reverted', `Tenant customization reverted for ${reminderType}`, { before });
    return { ok: true, tenantId, reminderType, reverted: true, effective: (await this.getEffective(tenantId, reminderType)).effective };
  }

  // exposed for callers that need the signed offset of the effective config
  signedEffectiveOffset(direction: string, offset: number): number { return signedOffsetMinutes(direction as TimingDirection, offset); }
}
