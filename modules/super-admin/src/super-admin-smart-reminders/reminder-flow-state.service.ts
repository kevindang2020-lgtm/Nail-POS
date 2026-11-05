// reminder-flow-state.service.ts — Disable Problematic Reminders + re-enable (§43). Disabling is sensitive: it REQUIRES
// a non-empty reason, records who/when, and moves the flow to a non-active status so the scheduler stops creating new
// jobs — while all historical delivery records are preserved (nothing is deleted). Re-enabling clears the reason and
// returns the flow to active. isActive() is the authoritative gate the scheduler consults (tenant state overrides
// platform state; default active when unset). Every transition is audited with before/after.
import { BadRequestException } from '@nestjs/common';
import { REMINDER_TYPES } from './smart-reminders-core';
import { ReminderFlowStateRepository, type FlowStateRow } from './reminder-flow-state.kysely.repository';

export interface AdminCtx { userId?: string; email?: string; ip?: string }
const TYPE_KEYS = new Set<string>(REMINDER_TYPES.map((t) => t.key));
const DISABLE_STATES = ['disabled', 'paused', 'under_review'];
const validUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const shape = (r: FlowStateRow | null) => (r ? { reminderType: r.reminder_type, status: r.status, reason: r.reason, disabledAt: r.disabled_at, updatedAt: r.updated_at } : null);

export class ReminderFlowStateService {
  constructor(private readonly repo: ReminderFlowStateRepository) {}

  async list(tenantId: string | null) { return { tenantId, flows: (await this.repo.list(tenantId)).map(shape) }; }
  async get(tenantId: string | null, reminderType: string) {
    if (!TYPE_KEYS.has(reminderType)) throw new BadRequestException('invalid reminderType');
    return { reminderType, state: shape(await this.repo.get(tenantId, reminderType)) };
  }

  /** Authoritative gate: tenant state overrides platform state; default active when neither is set. */
  async isActive(tenantId: string | null, reminderType: string): Promise<boolean> {
    const tenant = tenantId ? await this.repo.get(tenantId, reminderType) : null;
    const platform = await this.repo.get(null, reminderType);
    const status = tenant?.status ?? platform?.status ?? 'active';
    return status === 'active';
  }

  async disable(ctx: AdminCtx, body: any) {
    const reminderType = String(body?.reminderType ?? '');
    if (!TYPE_KEYS.has(reminderType)) throw new BadRequestException('invalid reminderType');
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 3) throw new BadRequestException('a reason is required to disable a reminder flow');
    const status = DISABLE_STATES.includes(String(body?.status)) ? String(body.status) : 'disabled';
    const tenantId = typeof body?.tenantId === 'string' && validUuid(body.tenantId) ? body.tenantId : null;
    const before = shape(await this.repo.get(tenantId, reminderType));
    await this.repo.upsert(tenantId, { reminderType, status, reason, disabling: true, actorId: ctx.userId && validUuid(ctx.userId) ? ctx.userId : null });
    const after = shape(await this.repo.get(tenantId, reminderType));
    await this.repo.writeAudit(tenantId, ctx, 'reminder_flow_disabled', `Reminder flow ${reminderType} → ${status}: ${reason}`, 'warning', { before, after, reason });
    return { ok: true, reminderType, status, before, after };
  }

  async enable(ctx: AdminCtx, body: any) {
    const reminderType = String(body?.reminderType ?? '');
    if (!TYPE_KEYS.has(reminderType)) throw new BadRequestException('invalid reminderType');
    const tenantId = typeof body?.tenantId === 'string' && validUuid(body.tenantId) ? body.tenantId : null;
    const before = shape(await this.repo.get(tenantId, reminderType));
    await this.repo.upsert(tenantId, { reminderType, status: 'active', reason: null, disabling: false, actorId: ctx.userId && validUuid(ctx.userId) ? ctx.userId : null });
    const after = shape(await this.repo.get(tenantId, reminderType));
    await this.repo.writeAudit(tenantId, ctx, 'reminder_flow_enabled', `Reminder flow ${reminderType} re-enabled`, 'info', { before, after });
    return { ok: true, reminderType, status: 'active', before, after };
  }
}
