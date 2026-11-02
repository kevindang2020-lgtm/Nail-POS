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
import { createHash } from 'node:crypto';
import { canMoveToSql } from '@aipowersalon/database';
import { RECEPTION_COPILOT_ACTION } from '../ai-lifecycles';

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

export interface LedgerEntry { ok: boolean; resourceId: string | null; state?: LedgerState; payloadHash?: string | null }
export type LedgerState = 'pending' | 'succeeded' | 'failed' | 'unknown';
export interface LedgerClaim { tenantId: string; branchId: string | null; key: string; actionType: string; actorUserId: string; payloadHash: string; summary: string }
export interface ActionLedgerRepo {
  find(tenantId: string, key: string): Promise<LedgerEntry | null>;
  record(tenantId: string, branchId: string | null, key: string, actionType: string, ok: boolean, resourceId: string | null): Promise<void>;
  /** Reception Copilot guide (migration 757): claim the key BEFORE running. true = this caller owns the run. */
  claim?(c: LedgerClaim): Promise<boolean>;
  /** record the true outcome of a claimed run (pending → succeeded | failed | unknown) */
  finish?(tenantId: string, key: string, state: Exclude<LedgerState, 'pending'>, resourceId: string | null, errorCode: string | null): Promise<void>;
}

/** A ledger write that fails after the domain call is REPORTED (process warning), never silently dropped: the row then
 *  stays 'pending' and Check Copilot System lists it as stuck. */
function ledgerWriteFailed(e: unknown): void { process.emitWarning(`reception-copilot ledger write failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`, 'CopilotLedgerWarning'); }
const SETTINGS_UNREADABLE = Symbol('settings-unreadable');
const field = (x: unknown, k: string): string | null => { const v = x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined; return typeof v === 'string' ? v : null; };

/** Stable hash of what the action would change — ignores the confirmation flag, the key and the hold token's encoding. */
export function copilotPayloadHash(action: CopilotAction): string {
  const { confirm: _c, idempotencyKey: _k, ...rest } = action as Record<string, unknown>;
  const norm = (v: unknown): unknown => Array.isArray(v) ? v.map(norm) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])]))
    : typeof v === 'string' ? v.trim() : v;
  return createHash('sha256').update(JSON.stringify(norm(rest))).digest('hex');
}

/** A short, PII-free line for the activity history (no phone numbers or message text). */
export function copilotActionSummary(action: CopilotAction): string {
  const id8 = (v?: string) => (v ? String(v).slice(0, 8) : '—');
  switch (action.type) {
    case 'create_appointment': return `Book ${action.date} ${action.startTime} · ${action.serviceIds.length} service(s)`;
    case 'reschedule_appointment': return `Reschedule appointment ${id8(action.appointmentId)} to ${action.date ?? 'same day'} ${action.startTime}`;
    case 'cancel_appointment': return `Cancel appointment ${id8(action.appointmentId)}`;
    case 'send_message': return `Text message (${String(action.body ?? '').length} characters)`;
    default: return 'Copilot action';
  }
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
    // Reception Copilot guide §08: settings that cannot be read FAIL CLOSED — an unreadable switch never allows an action.
    if (this.settings) {
      const read = await this.settings.get({ tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions, branchId: ctx.branchId }).catch(() => SETTINGS_UNREADABLE);
      if (read === SETTINGS_UNREADABLE) return { ok: false, errorCode: 'ACTION_DISABLED', message: 'The Copilot settings could not be read, so no action was taken. Try again in a moment.' };
      const gate = read;
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
    // Spine rule 2 (§28): idempotency. Reception Copilot guide §06: with a ledger wired (always, in production) a confirmed
    // action MUST carry a key, and the key is CLAIMED before the domain service runs — two simultaneous confirms of the
    // same key can never both execute (the old ledger was find → run → record). The same key with a DIFFERENT payload is
    // refused rather than replayed.
    const key = action.idempotencyKey ? String(action.idempotencyKey) : null;
    if (this.ledger && !key) return { ok: false, errorCode: 'IDEMPOTENCY_KEY_REQUIRED', message: 'This action needs a request key. Prepare it again.' };
    const hash = copilotPayloadHash(action);
    if (key && this.ledger) {
      const claimed = this.ledger.claim
        ? await this.ledger.claim({ tenantId: ctx.tenantId, branchId: ctx.branchId, key, actionType: action.type, actorUserId: ctx.userId, payloadHash: hash, summary: copilotActionSummary(action) })
        : !(await this.ledger.find(ctx.tenantId, key).catch(() => null));
      if (!claimed) {
        const prior = await this.ledger.find(ctx.tenantId, key).catch(() => null);
        if (prior?.payloadHash && prior.payloadHash !== hash) return { ok: false, errorCode: 'IDEMPOTENCY_CONFLICT', message: 'That request key was already used for a different action.' };
        if (prior?.state === 'pending') return { ok: false, errorCode: 'ACTION_IN_PROGRESS', message: 'This action is already running. Check its status in Copilot activity.', result: { duplicate: true, state: 'pending' } };
        if (prior?.state === 'unknown') return { ok: false, errorCode: 'ACTION_OUTCOME_UNKNOWN', message: 'This action may or may not have completed. Check the appointment or message before trying again.', result: { duplicate: true, state: 'unknown', resourceId: prior.resourceId } };
        return { ok: !!prior?.ok, errorCode: prior?.ok ? undefined : 'IDEMPOTENCY_CONFLICT', message: 'This action was already processed.', result: { duplicate: true, resourceId: prior?.resourceId ?? null, state: prior?.state ?? (prior?.ok ? 'succeeded' : 'failed') } };
      }
    }
    let res: ActionResult;
    try { res = await this.run(ctx, action); }
    catch (e) {
      // the domain call threw after it may have taken effect: record UNKNOWN (never retried automatically) and re-throw
      if (key && this.ledger?.finish) await this.ledger.finish(ctx.tenantId, key, 'unknown', field(action, 'appointmentId'), 'INTERNAL_ERROR').catch(ledgerWriteFailed);
      throw e;
    }
    if (key && this.ledger) {
      const resourceId = field(res.result, 'appointmentId') ?? field(res.result, 'notificationId') ?? (res.ok ? field(action, 'appointmentId') : null);
      if (this.ledger.finish) await this.ledger.finish(ctx.tenantId, key, res.ok ? 'succeeded' : 'failed', resourceId, res.ok ? null : (res.errorCode ?? null)).catch(ledgerWriteFailed);
      else await this.ledger.record(ctx.tenantId, ctx.branchId, key, action.type, res.ok, resourceId).catch(ledgerWriteFailed);
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
      const res: any = await this.notifications.send({ tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role, branchId: ctx.branchId ?? undefined }, { channel: 'sms', to: action.to, body: action.body, customerId: action.customerId });
      if (!res?.sent) {
        const code = res?.reason === 'opted_out' ? 'MESSAGE_OPTED_OUT' : res?.reason === 'over_limit' ? 'NO_MESSAGE_CREDITS' : 'MESSAGE_SEND_FAILED';
        return { ok: false, errorCode: code, message: res?.reason === 'opted_out' ? 'That number has opted out of messages.' : res?.reason === 'over_limit' ? 'No SMS credits remaining.' : 'The message could not be sent.' };
      }
      const degraded = typeof res.providerId === 'string' && res.providerId.startsWith('SM-MOCK-'); // no real Twilio configured
      await this.audit.record({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId }, {
        module: 'reception_copilot', action: 'message.sent', resourceType: 'notification', resourceId: res.id ?? null,
        summary: 'SMS sent from Reception Copilot', metadata: { source: 'RECEPTION_COPILOT', to: action.to, customerId: action.customerId ?? null, degraded, idempotencyKey: action.idempotencyKey ?? null },
      });
      return { ok: true, result: { providerId: res.providerId, notificationId: res.id ?? null, degraded } };
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
      await this.audit.record({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId }, {
        module: 'reception_copilot', action: 'appointment.created', resourceType: 'pos_booking_appointment', resourceId: result?.appointmentId ?? null,
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
      await this.audit.record({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId }, {
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
      await this.audit.record({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId }, {
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
    const k = `${tenantId}:${key}`; if (!this.rows.has(k)) this.rows.set(k, { ok, resourceId, state: ok ? 'succeeded' : 'failed' });
  }
  async claim(c: LedgerClaim) {
    const k = `${c.tenantId}:${c.key}`; if (this.rows.has(k)) return false;
    this.rows.set(k, { ok: false, resourceId: null, state: 'pending', payloadHash: c.payloadHash }); return true;
  }
  async finish(tenantId: string, key: string, state: Exclude<LedgerState, 'pending'>, resourceId: string | null) {
    const r = this.rows.get(`${tenantId}:${key}`); if (r && r.state === 'pending') Object.assign(r, { state, ok: state === 'succeeded', resourceId: resourceId ?? r.resourceId });
  }
}

export class KyselyActionLedgerRepo implements ActionLedgerRepo {
  constructor(private readonly db: Kysely<any>) {}
  async find(tenantId: string, key: string): Promise<LedgerEntry | null> {
    const r: any = (await sql`SELECT ok, resource_id, state, payload_hash FROM reception_copilot_action_ledger WHERE tenant_id = ${tenantId} AND idempotency_key = ${key} LIMIT 1`.execute(this.db)).rows[0];
    return r ? { ok: !!r.ok, resourceId: r.resource_id ?? null, state: (r.state ?? (r.ok ? 'succeeded' : 'failed')) as LedgerState, payloadHash: r.payload_hash ?? null } : null;
  }
  /** INSERT … ON CONFLICT DO NOTHING is the claim: exactly one concurrent caller gets the row (unique tenant + key). */
  async claim(c: LedgerClaim): Promise<boolean> {
    const r = await sql`INSERT INTO reception_copilot_action_ledger (tenant_id, branch_id, idempotency_key, action_type, ok, state, actor_user_id, payload_hash, summary)
      VALUES (${c.tenantId}, ${c.branchId}, ${c.key}, ${c.actionType}, false, 'pending', ${c.actorUserId}, ${c.payloadHash}, ${c.summary})
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING id`.execute(this.db);
    return r.rows.length === 1;
  }
  async finish(tenantId: string, key: string, state: Exclude<LedgerState, 'pending'>, resourceId: string | null, errorCode: string | null): Promise<void> {
    await sql`UPDATE reception_copilot_action_ledger SET state = ${state}, ok = ${state === 'succeeded'}, resource_id = coalesce(${resourceId}, resource_id),
        error_code = ${errorCode}, finished_at = now(), updated_at = now(), updated_by = actor_user_id
      WHERE tenant_id = ${tenantId} AND idempotency_key = ${key} AND state = 'pending'
        AND ${canMoveToSql(RECEPTION_COPILOT_ACTION, state)}`.execute(this.db);
  }
  async record(tenantId: string, branchId: string | null, key: string, actionType: string, ok: boolean, resourceId: string | null): Promise<void> {
    await sql`INSERT INTO reception_copilot_action_ledger (tenant_id, branch_id, idempotency_key, action_type, ok, resource_id)
      VALUES (${tenantId}, ${branchId}, ${key}, ${actionType}, ${ok}, ${resourceId})
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`.execute(this.db);
  }
}
