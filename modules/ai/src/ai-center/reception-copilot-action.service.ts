// reception-copilot-action.service.ts — the MUTATION SPINE (spec §25–29). The Copilot is advisory: it may PROPOSE an
// action, but nothing changes business data until a human explicitly confirms, and every mutation is routed through an
// existing authorized domain service (never direct DB writes) with server-derived scope + an audit event. This service
// enforces that contract: without confirm===true it returns HUMAN_CONFIRMATION_REQUIRED and performs NO write; with
// confirmation it delegates to the domain service (which re-checks permission + ownership + rules inside its own
// transaction) and records a RECEPTION_COPILOT audit event. First wired action: cancel_appointment via BookingService.
import { BookingService, type BookingContext } from '@aipowersalon/booking';
import { isSlotConflict } from '../voice-booking/voice-booking-write.service';
import { Injectable, Inject, Optional } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { AuditService } from '@aipowersalon/audit';
import { NotificationsService } from '@aipowersalon/communications';
import { CopilotSettingsService } from './copilot-settings.service';
import { openCopilotHoldToken } from './reception-copilot-context.service';
import { BookingConversionEmitter } from '@aipowersalon/reports';

export interface ActionCtx { tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[] }
export type CopilotAction =
  | { type: 'cancel_appointment'; appointmentId: string; reason: string; confirm?: boolean; idempotencyKey?: string }
  | { type: 'reschedule_appointment'; appointmentId: string; startTime: string; date?: string; technicianId?: string; confirm?: boolean; idempotencyKey?: string; /** Round 3 H2: the desk hold this move is made into (used up). */ holdToken?: string }
  | { type: 'create_appointment'; customerName: string; customerId?: string; customerPhone?: string; serviceIds: string[]; date: string; startTime: string; technicianId?: string; confirm?: boolean; idempotencyKey?: string; /** Round 2 H: the desk hold this booking is made from (converted). */ holdToken?: string }
  | { type: 'send_message'; to: string; body: string; customerId?: string; confirm?: boolean; idempotencyKey?: string };

export interface ActionResult {
  ok: boolean;
  requiresConfirmation?: boolean;
  errorCode?: string;          // stable taxonomy (spec §49): HUMAN_CONFIRMATION_REQUIRED, INSUFFICIENT_PERMISSION, ...
  message?: string;
  result?: unknown;
}

export interface LedgerEntry { ok: boolean; resourceId: string | null }
export interface ActionLedgerRepo {
  find(tenantId: string, key: string): Promise<LedgerEntry | null>;
  record(tenantId: string, branchId: string | null, key: string, actionType: string, ok: boolean, resourceId: string | null): Promise<void>;
}

@Injectable()
export class ReceptionCopilotActionService {
  constructor(
    private readonly booking: BookingService,
    private readonly audit: AuditService,
    @Optional() @Inject('CopilotActionLedger') private readonly ledger?: ActionLedgerRepo,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly settings?: CopilotSettingsService,
    @Optional() private readonly conversion?: BookingConversionEmitter,
  ) {}

  async execute(ctx: ActionCtx, action: CopilotAction): Promise<ActionResult> {
    // Spine rule 1: no mutation without explicit human confirmation.
    if (action?.confirm !== true) {
      return { ok: false, requiresConfirmation: true, errorCode: 'HUMAN_CONFIRMATION_REQUIRED', message: 'This action changes business records and must be confirmed by a person.' };
    }
    // Spine rule 0.5 (§45): the receptionist must hold the Copilot permission for this action. The domain permission
    // (pos.booking.*) is still enforced separately inside the domain service — high-risk actions require BOTH.
    const COPILOT_PERM: Record<string, string> = {
      create_appointment: 'reception_copilot.create_appointment',
      reschedule_appointment: 'reception_copilot.reschedule_appointment',
      cancel_appointment: 'reception_copilot.cancel_appointment',
      send_message: 'reception_copilot.send_message',
    };
    const needed = COPILOT_PERM[action.type];
    if (needed && !(ctx.permissions || []).includes(needed)) {
      return { ok: false, errorCode: 'PERMISSION_DENIED', message: 'You do not have Copilot permission for this action.' };
    }
    // Spine rule 0 (§47): tenant toggles gate what the Copilot may do. A disabled switch refuses cleanly.
    if (this.settings) {
      const gate = await this.settings.get({ tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions, branchId: ctx.branchId }).catch(() => null);
      if (gate) {
        if (!gate.enabled) return { ok: false, errorCode: 'ACTION_DISABLED', message: 'The Reception Copilot is turned off for this salon.' };
        if (!gate.actionsEnabled) return { ok: false, errorCode: 'ACTION_DISABLED', message: 'Copilot actions are turned off for this salon.' };
        const perAction: Record<string, boolean> = {
          create_appointment: gate.allowCreate, reschedule_appointment: gate.allowReschedule,
          cancel_appointment: gate.allowCancel, send_message: gate.allowSendMessage,
        };
        if (perAction[action.type] === false) return { ok: false, errorCode: 'ACTION_DISABLED', message: 'That action is turned off for this salon.' };
      }
    }
    // Spine rule 2 (§28): idempotency. If this (tenant, key) already ran, replay the outcome — never execute twice.
    const key = (action as any).idempotencyKey ? String((action as any).idempotencyKey) : null;
    if (key && this.ledger) {
      const prior = await this.ledger.find(ctx.tenantId, key).catch(() => null);
      if (prior) return { ok: prior.ok, errorCode: prior.ok ? undefined : 'IDEMPOTENCY_CONFLICT', message: 'This action was already processed.', result: { duplicate: true, resourceId: prior.resourceId } };
    }
    const res = await this.run(ctx, action);
    if (key && this.ledger) {
      const resourceId = (res.result as any)?.appointmentId ?? (res.ok ? (action as any).appointmentId ?? null : null);
      await this.ledger.record(ctx.tenantId, ctx.branchId, key, action.type, res.ok, resourceId ?? null).catch(() => undefined);
    }
    // Feed the shared cross-channel conversion funnel (front-desk source). Best-effort; never affects the action result.
    this.emitConversion(ctx, action, res);
    return res;
  }

  // Map a completed Copilot booking action to a shared funnel event so front-desk (POS) bookings show in ai_booking
  // analytics alongside online/partner. Non-booking actions (e.g. send_message) are not funnel events.
  private emitConversion(ctx: ActionCtx, action: CopilotAction, res: ActionResult): void {
    if (!this.conversion) return;
    const stageMap: Record<string, [string, string]> = {
      create_appointment: ['BOOKING_SUCCEEDED', 'BOOKING_FAILED'],
      reschedule_appointment: ['RESCHEDULE_SUCCEEDED', 'RESCHEDULE_FAILED'],
      cancel_appointment: ['CANCEL_SUCCEEDED', 'CANCEL_FAILED'],
    };
    const pair = stageMap[action.type];
    if (!pair) return;
    const appointmentId = (res.result as any)?.appointmentId ?? (res.ok ? (action as any).appointmentId ?? null : null);
    void this.conversion.emit({
      tenantId: ctx.tenantId, branchId: ctx.branchId, source: 'FRONT_DESK_POS',
      stage: res.ok ? pair[0] : pair[1], outcome: res.ok ? 'succeeded' : 'failed',
      failureReason: res.ok ? null : (res.errorCode ?? null), appointmentId, actorUserId: ctx.userId,
    });
  }

  private async run(ctx: ActionCtx, action: CopilotAction): Promise<ActionResult> {
    switch (action.type) {
      case 'cancel_appointment':
        return this.cancelAppointment(ctx, action);
      case 'reschedule_appointment':
        return this.rescheduleAppointment(ctx, action);
      case 'create_appointment':
        return this.createAppointment(ctx, action);
      case 'send_message':
        return this.sendMessage(ctx, action);
      default:
        return { ok: false, errorCode: 'INTERNAL_ERROR', message: 'Unknown action.' };
    }
  }

  private async sendMessage(ctx: ActionCtx, action: Extract<CopilotAction, { type: 'send_message' }>): Promise<ActionResult> {
    if (!this.notifications) return { ok: false, errorCode: 'INTERNAL_ERROR', message: 'Messaging is not available.' };
    if (!action.to?.trim()) return { ok: false, errorCode: 'INTERNAL_ERROR', message: 'A recipient phone number is required.' };
    if (!action.body?.trim()) return { ok: false, errorCode: 'INTERNAL_ERROR', message: 'A message body is required.' };
    try {
      // Delegate to the tenant messaging service — it meters SMS credits, enforces opt-out, sends via the configured
      // Twilio sender (mock when no Twilio creds), and logs the attempt. The Copilot never talks to Twilio directly.
      const res: any = await this.notifications.send({ tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role, branchId: ctx.branchId ?? undefined } as any, { channel: 'sms', to: action.to, body: action.body, customerId: action.customerId } as any);
      if (!res?.sent) {
        const code = res?.reason === 'opted_out' ? 'MESSAGE_OPTED_OUT' : res?.reason === 'over_limit' ? 'NO_MESSAGE_CREDITS' : 'MESSAGE_SEND_FAILED';
        return { ok: false, errorCode: code, message: res?.reason === 'opted_out' ? 'That number has opted out of messages.' : res?.reason === 'over_limit' ? 'No SMS credits remaining.' : 'The message could not be sent.' };
      }
      const degraded = typeof res.providerId === 'string' && res.providerId.startsWith('SM-MOCK-'); // no real Twilio configured
      await this.audit.record({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId } as any, {
        module: 'reception_copilot', action: 'message.sent', resourceType: 'notification', resourceId: res.id ?? null,
        summary: 'SMS sent from Reception Copilot', metadata: { source: 'RECEPTION_COPILOT', to: action.to, customerId: action.customerId ?? null, degraded, idempotencyKey: action.idempotencyKey ?? null },
      });
      return { ok: true, result: { providerId: res.providerId, degraded } };
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (e?.name === 'ForbiddenError' || /permission|forbidden/i.test(msg)) return { ok: false, errorCode: 'INSUFFICIENT_PERMISSION', message: 'You don\u2019t have permission to send messages.' };
      return { ok: false, errorCode: 'MESSAGE_SEND_FAILED', message: 'The message could not be sent.' };
    }
  }

  private async createAppointment(ctx: ActionCtx, action: Extract<CopilotAction, { type: 'create_appointment' }>): Promise<ActionResult> {
    if (!ctx.branchId) return { ok: false, errorCode: 'INTERNAL_ERROR', message: 'A branch is required to book an appointment.' };
    if (!action.customerName?.trim()) return { ok: false, errorCode: 'INTERNAL_ERROR', message: 'A customer name is required.' };
    if (!action.serviceIds?.length) return { ok: false, errorCode: 'SERVICE_NOT_FOUND', message: 'At least one service is required.' };
    if (!action.date || !action.startTime) return { ok: false, errorCode: 'INTERNAL_ERROR', message: 'A date and start time are required.' };
    const bctx: BookingContext = { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions };
    try {
      // Delegate to the domain service — it enforces pos.booking.create and re-checks availability + conflicts inside
      // its transaction (with an advisory lock against concurrent double-booking). The Copilot never inserts the row.
      const result = await this.booking.create(bctx, {
        customerName: action.customerName, customerId: action.customerId, customerPhone: action.customerPhone,
        serviceIds: action.serviceIds, date: action.date, startTime: action.startTime, technicianId: action.technicianId,
        // Round 2 H: booked from "Hold this time" — the desk session's hold does not block it and is converted into it.
        // Only the receptionist who held it can present it (the token is sealed for this salon and this staff member).
        holdSessionId: openCopilotHoldToken(ctx, action.holdToken),
      });
      await this.audit.record({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId } as any, {
        module: 'reception_copilot', action: 'appointment.created', resourceType: 'pos_booking_appointment', resourceId: (result as any)?.appointmentId ?? null,
        summary: 'Appointment created from Reception Copilot', metadata: { source: 'RECEPTION_COPILOT', date: action.date, startTime: action.startTime, serviceIds: action.serviceIds, idempotencyKey: action.idempotencyKey ?? null },
      });
      return { ok: true, result };
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (e?.name === 'ForbiddenError' || /permission|forbidden/i.test(msg)) return { ok: false, errorCode: 'INSUFFICIENT_PERMISSION', message: 'You don\u2019t have permission to book appointments.' };
      if (isSlotConflict(e)) return { ok: false, errorCode: 'APPOINTMENT_CONFLICT', message: 'That time is no longer available — pick another slot.' };   // by type/code, not wording (§12 sentence changed)
      if (/store hours|working hours|outside/i.test(msg)) return { ok: false, errorCode: 'SLOT_UNAVAILABLE', message: msg };
      return { ok: false, errorCode: 'INTERNAL_ERROR', message: 'The booking could not be completed.' };
    }
  }

  private async rescheduleAppointment(ctx: ActionCtx, action: Extract<CopilotAction, { type: 'reschedule_appointment' }>): Promise<ActionResult> {
    if (!ctx.branchId) return { ok: false, errorCode: 'INTERNAL_ERROR', message: 'A branch is required to reschedule an appointment.' };
    if (!action.appointmentId) return { ok: false, errorCode: 'APPOINTMENT_NOT_FOUND', message: 'No appointment specified.' };
    if (!action.startTime?.trim()) return { ok: false, errorCode: 'INTERNAL_ERROR', message: 'A new start time is required.' };
    const bctx: BookingContext = { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions };
    try {
      // Delegate to the domain service — it enforces pos.booking.reschedule and re-validates store hours, technician
      // windows, and conflicts inside its own transaction. The Copilot never moves the appointment row itself.
      // Round 3 H2: another desk's / call's hold on the new time refuses the move (409); this desk's own hold (its sealed
      // token, opened for this salon and this staff member only) does not, and is used up by the move.
      const result = await this.booking.reschedule(bctx, action.appointmentId, { startTime: action.startTime, date: action.date, technicianId: action.technicianId, holdSessionId: openCopilotHoldToken(ctx, action.holdToken) });
      await this.audit.record({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId } as any, {
        module: 'reception_copilot', action: 'appointment.rescheduled', resourceType: 'pos_booking_appointment', resourceId: action.appointmentId,
        summary: 'Appointment rescheduled from Reception Copilot', metadata: { source: 'RECEPTION_COPILOT', startTime: action.startTime, date: action.date ?? null, technicianId: action.technicianId ?? null, idempotencyKey: action.idempotencyKey ?? null },
      });
      return { ok: true, result };
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (e?.name === 'ForbiddenError' || /permission|forbidden/i.test(msg)) return { ok: false, errorCode: 'INSUFFICIENT_PERMISSION', message: 'You don\u2019t have permission to reschedule appointments.' };
      if (/not found/i.test(msg)) return { ok: false, errorCode: 'APPOINTMENT_NOT_FOUND', message: 'That appointment could not be found.' };
      if (isSlotConflict(e)) return { ok: false, errorCode: 'APPOINTMENT_CONFLICT', message: msg };   // by type/code, not wording (§12 sentence changed)
      if (/store hours|working hours|outside/i.test(msg)) return { ok: false, errorCode: 'APPOINTMENT_NOT_MODIFIABLE', message: msg };
      return { ok: false, errorCode: 'INTERNAL_ERROR', message: 'The reschedule could not be completed.' };
    }
  }

  private async cancelAppointment(ctx: ActionCtx, action: Extract<CopilotAction, { type: 'cancel_appointment' }>): Promise<ActionResult> {
    if (!ctx.branchId) return { ok: false, errorCode: 'INTERNAL_ERROR', message: 'A branch is required to cancel an appointment.' };
    if (!action.appointmentId) return { ok: false, errorCode: 'APPOINTMENT_NOT_FOUND', message: 'No appointment specified.' };
    if (!action.reason?.trim()) return { ok: false, errorCode: 'INTERNAL_ERROR', message: 'A cancellation reason is required.' };
    const bctx: BookingContext = { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions };
    try {
      // Delegate to the authorized domain service — it enforces pos.booking.cancel, verifies ownership, and revalidates
      // inside its own transaction. The Copilot never writes the appointment row itself.
      const result = await this.booking.cancel(bctx, action.appointmentId, { reason: action.reason });
      await this.audit.record({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId } as any, {
        module: 'reception_copilot', action: 'appointment.cancelled', resourceType: 'pos_booking_appointment', resourceId: action.appointmentId,
        summary: 'Appointment cancelled from Reception Copilot', metadata: { source: 'RECEPTION_COPILOT', reason: action.reason, idempotencyKey: action.idempotencyKey ?? null },
      });
      return { ok: true, result };
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (e?.name === 'ForbiddenError' || /permission|forbidden/i.test(msg)) return { ok: false, errorCode: 'INSUFFICIENT_PERMISSION', message: 'You don\u2019t have permission to cancel appointments.' };
      if (/not found/i.test(msg)) return { ok: false, errorCode: 'APPOINTMENT_NOT_FOUND', message: 'That appointment could not be found.' };
      return { ok: false, errorCode: 'INTERNAL_ERROR', message: 'The cancellation could not be completed.' };
    }
  }
}

// ---- idempotency ledger repos ----
export class InMemoryActionLedgerRepo implements ActionLedgerRepo {
  private rows = new Map<string, LedgerEntry>();
  async find(tenantId: string, key: string) { return this.rows.get(`${tenantId}:${key}`) ?? null; }
  async record(tenantId: string, _branchId: string | null, key: string, _t: string, ok: boolean, resourceId: string | null) {
    const k = `${tenantId}:${key}`; if (!this.rows.has(k)) this.rows.set(k, { ok, resourceId });
  }
}

export class KyselyActionLedgerRepo implements ActionLedgerRepo {
  constructor(private readonly db: Kysely<any>) {}
  async find(tenantId: string, key: string): Promise<LedgerEntry | null> {
    const r: any = (await sql`SELECT ok, resource_id FROM reception_copilot_action_ledger WHERE tenant_id = ${tenantId} AND idempotency_key = ${key} LIMIT 1`.execute(this.db)).rows[0];
    return r ? { ok: !!r.ok, resourceId: r.resource_id ?? null } : null;
  }
  async record(tenantId: string, branchId: string | null, key: string, actionType: string, ok: boolean, resourceId: string | null): Promise<void> {
    await sql`INSERT INTO reception_copilot_action_ledger (tenant_id, branch_id, idempotency_key, action_type, ok, resource_id)
      VALUES (${tenantId}, ${branchId}, ${key}, ${actionType}, ${ok}, ${resourceId})
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`.execute(this.db);
  }
}
