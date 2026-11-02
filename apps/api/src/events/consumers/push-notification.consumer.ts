// push-notification.consumer.ts — Constitution 8, Phase 13 (§57, §105): push notifications as a CONSUMER.
//
// Today queue.service calls push.dispatchToUser inline after commit (best-effort try/catch — lost on crash,
// never retried). As a consumer it becomes durable: the outbox holds the fact, this handler runs at-least-once,
// and §105 idempotency comes from the runner's processed_events (one push per (consumer, event)) plus the push
// service's own reference key. External dependency: the push provider → TRANSIENT on failure, so it retries.
import { type EventConsumer, ConsumerError, type DomainEvent, DOMAIN_EVENTS, TenantMismatchError } from '@aipowersalon/events';
import type { Transaction } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { customerNoticeText, type CustomerNoticeKind } from '@aipowersalon/api-contracts';

const UUID = /^[0-9a-f-]{36}$/i;

export interface PushLike { dispatchToUser(tenantId: string | null, userId: string, msg: { title: string; body: string; data?: Record<string, unknown>; reference?: string; category?: string }): Promise<unknown>; }
export interface UserLookupLike { technicianUserId(ctx: { tenantId: string; branchId: string }, technicianId: string): Promise<string | null>; }

export class PushNotificationConsumer implements EventConsumer {
  readonly name = 'notifications.push';
  // developer merge (Oct 6 2026): the customer app's cancel / check-in pushes (he dispatched them inline, and only on
  // the customer app's own path) and the technician's "customer arrived" — now for EVERY path that records the fact.
  readonly eventTypes = [
    DOMAIN_EVENTS.APPOINTMENT_CREATED,
    DOMAIN_EVENTS.APPOINTMENT_RESCHEDULED,
    DOMAIN_EVENTS.QUEUE_CUSTOMER_ASSIGNED,
    DOMAIN_EVENTS.QUEUE_SERVICE_LINES_ASSIGNED,
    DOMAIN_EVENTS.APPOINTMENT_CANCELED,
    DOMAIN_EVENTS.CUSTOMER_CHECKED_IN,
    DOMAIN_EVENTS.TICKET_READY_FOR_CHECKOUT,
    DOMAIN_EVENTS.CHECKOUT_COMPLETED,
  ] as const;
  readonly critical = false;
  // §43: replaying would push a NEW notification to a technician about an assignment that is hours old. The
  //         reference key stops a redelivery, not a deliberate replay of history.
  readonly replay = 'NOT_REPLAYABLE' as const;
  readonly timeoutMs = 15_000;
  constructor(private readonly push: PushLike | null, private readonly users: UserLookupLike | null) { }

  async handle(e: DomainEvent<any>, trx: Transaction<DB>): Promise<void> {
    if (!this.push || !this.users || !e.tenantId) return;
    if (
      e.eventType === DOMAIN_EVENTS.APPOINTMENT_CREATED ||
      e.eventType === DOMAIN_EVENTS.APPOINTMENT_RESCHEDULED ||
      e.eventType === DOMAIN_EVENTS.APPOINTMENT_CANCELED ||
      e.eventType === DOMAIN_EVENTS.CUSTOMER_CHECKED_IN
    ) return this.appointmentFact(e, trx);
    if (e.eventType === DOMAIN_EVENTS.TICKET_READY_FOR_CHECKOUT) return this.ticketReadyForCheckoutPush(e, trx);
    if (e.eventType === DOMAIN_EVENTS.CHECKOUT_COMPLETED) return this.checkoutCompletedPush(e, trx);
    if (e.eventType === DOMAIN_EVENTS.QUEUE_CUSTOMER_ASSIGNED) {
      const technicianId = String(e.payload?.technicianId ?? '');
      if (!technicianId) return;
      const uid = await this.users.technicianUserId({ tenantId: e.tenantId, branchId: e.branchId ?? '' }, technicianId);
      if (!uid) return;                                         // technician has no app account — nothing to send, not an error
      try {
        await this.push.dispatchToUser(e.tenantId, uid, {
          title: 'New assignment', body: 'A guest is waiting for you', category: 'QUEUE_ASSIGNMENT',   // §95: no customer name in a push triggered by an event
          data: { kind: 'queue_assignment', queueItemId: e.aggregateId }, reference: `queue_assignment:${e.eventId}`,   // §105 idempotency key
        });
      } catch (err) {
        throw new ConsumerError('TRANSIENT', 'push_provider_failed', String((err as Error)?.message ?? err));   // §50: retry
      }
    }
    // multi-technician routing: every LINE technician who is not the lead (the lead got queue.customer_assigned) hears
    // that a guest's service is theirs. One push per (event, technician) — the reference key; never the guest's name.
    if (e.eventType === DOMAIN_EVENTS.QUEUE_SERVICE_LINES_ASSIGNED) {
      const lead = String(e.payload?.leadTechnicianId ?? '');
      const lines: any[] = Array.isArray(e.payload?.lines) ? e.payload.lines : [];
      const techs = [...new Set(lines.map((l) => String(l?.technicianId ?? '')).filter((t) => t && t !== lead))];
      for (const technicianId of techs) {
        const uid = await this.users.technicianUserId({ tenantId: e.tenantId, branchId: e.branchId ?? '' }, technicianId);
        if (!uid) continue;
        try {
          await this.push.dispatchToUser(e.tenantId, uid, {
            title: 'New assignment', body: 'A guest has a service with you', category: 'QUEUE_ASSIGNMENT',
            data: { kind: 'queue_assignment', queueItemId: e.aggregateId }, reference: `queue_lines:${e.eventId}:${technicianId}`,
          });
        } catch (err) {
          throw new ConsumerError('TRANSIENT', 'push_provider_failed', String((err as Error)?.message ?? err));
        }
      }
    }
  }

  /** The salon's owners and managers to tell about a booking / payment (merged from the developer tree, Oct 23 2026):
   *  active OWNER / MANAGER users of the tenant — a manager tied to ANOTHER branch is not told about this branch's guests.
   *  A failed read is an error (retried), never "nobody to tell". */
  private async salonManagers(trx: Transaction<DB>, e: DomainEvent<any>): Promise<{ id: string }[]> {
    let q: any = trx.selectFrom('users').select(['id']).where('tenant_id', '=', e.tenantId!).where('role', 'in', ['OWNER', 'MANAGER']).where('status', '=', 'active');
    if (e.branchId) q = q.where((eb: any) => eb.or([eb('role', '=', 'OWNER'), eb('branch_id', 'is', null), eb('branch_id', '=', e.branchId)]));
    return q.execute();
  }

  private async filterAlreadySent(trx: Transaction<DB>, tenantId: string, items: { uid: string; msg: any }[]): Promise<{ uid: string; msg: any }[]> {
    const filtered: { uid: string; msg: any }[] = [];
    for (const item of items) {
      if (!item.msg.reference) {
        filtered.push(item);
        continue;
      }
      const sent: any = await trx.selectFrom('notification_delivery_logs')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('template', '=', String(item.msg.reference))
        .where('status', '=', 'sent')
        .executeTakeFirst();   // a failed dedup read is retried, never "not sent yet" (it would push twice)
      if (!sent) filtered.push(item);
    }
    return filtered;
  }

  /** appointment.canceled → the customer ("Appointment cancelled"); checkin.customer_checked_in → the customer
   *  ("Checked in successfully") and the appointment's technician ("Customer arrived"). §61/§95: a push never names
   *  the guest, the salon or a time — the in-app feed (notifications.in_app) carries the detail behind the lock screen. */
  private async appointmentFact(e: DomainEvent<any>, trx: Transaction<DB>): Promise<void> {
    const id = String(e.payload?.appointmentId ?? (e.aggregateType === 'appointment' ? e.aggregateId : ''));
    if (!UUID.test(id)) return;
    const a: any = await trx.selectFrom('pos_tech_appointments').select(['tenant_id', 'customer_id', 'technician_id']).where('id', '=', id).executeTakeFirst();
    if (!a) return;
    if (String(a.tenant_id) !== String(e.tenantId)) throw new TenantMismatchError(`appointment ${id}`);
    const created = e.eventType === DOMAIN_EVENTS.APPOINTMENT_CREATED;
    const rescheduled = e.eventType === DOMAIN_EVENTS.APPOINTMENT_RESCHEDULED;
    const cancelled = e.eventType === DOMAIN_EVENTS.APPOINTMENT_CANCELED;
    const byCustomerApp = e.payload?.source === 'customer_app';
    const sends: { uid: string; msg: any }[] = [];
    if (a.customer_id && !(created && byCustomerApp)) {
      const c: any = await trx.selectFrom('customers').select(['user_id', 'preferred_language']).where('id', '=', a.customer_id).where('tenant_id', '=', e.tenantId!).executeTakeFirst();
      // VietnamesePOS §54 / §119 (Oct 28 2026 audit): the push in the CUSTOMER's language (customers.preferred_language)
      const say = (k: CustomerNoticeKind) => { const n = customerNoticeText(k, c?.preferred_language ?? null); return { title: n.title, body: n.body }; };
      if (c?.user_id) {
        if (created) {
          sends.push({ uid: String(c.user_id), msg: { ...say('appointment_booked_push'), category: 'APPOINTMENT_CONFIRMATION', data: { kind: 'appointment_created', appointmentId: id }, reference: `appointment_created:${id}` } });
        } else if (rescheduled) {
          sends.push({ uid: String(c.user_id), msg: { ...say('appointment_rescheduled_push'), category: 'BOOKING_CHANGE', data: { kind: 'appointment_rescheduled', appointmentId: id }, reference: `appointment_rescheduled:${e.eventId}` } });
        } else if (cancelled) {
          sends.push({ uid: String(c.user_id), msg: { ...say('appointment_cancelled_push'), category: 'BOOKING_CHANGE', data: { kind: 'appointment_cancelled', appointmentId: id }, reference: `appointment_cancelled:${e.eventId}` } });
        } else {
          sends.push({ uid: String(c.user_id), msg: { ...say('checked_in'), category: 'CHECK_IN_READY', data: { kind: 'customer_checked_in', appointmentId: id }, reference: `checked_in:${id}` } });
        }
      }
    }
    if (created && a.technician_id) {
      const uid = await this.users!.technicianUserId({ tenantId: e.tenantId!, branchId: e.branchId ?? '' }, String(a.technician_id));
      if (uid) sends.push({ uid, msg: { title: 'New appointment booked', body: 'A new appointment was booked with you. Open the app for details.', category: 'APPOINTMENT_CONFIRMATION', data: { kind: 'appointment_created', appointmentId: id }, reference: `customer_booked:${id}` } });
    }
    if (rescheduled && a.technician_id) {
      const uid = await this.users!.technicianUserId({ tenantId: e.tenantId!, branchId: e.branchId ?? '' }, String(a.technician_id));
      if (uid) sends.push({ uid, msg: { title: 'Appointment rescheduled', body: 'An appointment with you was rescheduled. Open the app for details.', category: 'BOOKING_CHANGE', data: { kind: 'appointment_rescheduled', appointmentId: id }, reference: `tech_rescheduled:${e.eventId}:${a.technician_id}` } });
    }
    if (cancelled && a.technician_id) {
      const uid = await this.users!.technicianUserId({ tenantId: e.tenantId!, branchId: e.branchId ?? '' }, String(a.technician_id));
      if (uid) sends.push({ uid, msg: { title: 'Appointment cancelled', body: 'An appointment with you was cancelled. Open the app for details.', category: 'BOOKING_CHANGE', data: { kind: 'appointment_cancelled', appointmentId: id }, reference: `tech_cancelled:${e.eventId}:${a.technician_id}` } });
    }
    if (created) {
      const owners: any[] = await this.salonManagers(trx, e);
      for (const o of owners) {
        sends.push({ uid: String(o.id), msg: { title: 'New appointment booked', body: 'A new appointment was booked. Open the app for details.', category: 'BUSINESS_ALERT', data: { kind: 'appointment_created', appointmentId: id }, reference: `owner_booked:${id}:${o.id}` } });
      }
    }
    if (rescheduled) {
      const owners: any[] = await this.salonManagers(trx, e);
      for (const o of owners) {
        sends.push({ uid: String(o.id), msg: { title: 'Appointment rescheduled', body: 'An appointment was rescheduled. Open the app for details.', category: 'BUSINESS_ALERT', data: { kind: 'appointment_rescheduled', appointmentId: id }, reference: `owner_rescheduled:${e.eventId}:${o.id}` } });
      }
    }
    if (cancelled) {
      const owners: any[] = await this.salonManagers(trx, e);
      for (const o of owners) {
        sends.push({ uid: String(o.id), msg: { title: 'Appointment cancelled', body: 'An appointment was cancelled. Open the app for details.', category: 'BUSINESS_ALERT', data: { kind: 'appointment_cancelled', appointmentId: id }, reference: `owner_cancelled:${e.eventId}:${o.id}` } });
      }
    }
    if (!cancelled && !created && !rescheduled && a.technician_id) {
      const uid = await this.users!.technicianUserId({ tenantId: e.tenantId!, branchId: e.branchId ?? '' }, String(a.technician_id));
      if (uid) sends.push({ uid, msg: { title: 'Customer arrived', body: 'A guest checked in for their appointment with you.', category: 'NEW_CUSTOMER', data: { kind: 'customer_arrived', appointmentId: id }, reference: `customer_arrived:${id}` } });
    }
    const sendsToDispatch = await this.filterAlreadySent(trx, e.tenantId!, sends);
    for (const s of sendsToDispatch) {
      try { await this.push!.dispatchToUser(e.tenantId!, s.uid, s.msg); }
      catch (err) { throw new ConsumerError('TRANSIENT', 'push_provider_failed', String((err as Error)?.message ?? err)); }
    }
  }

  private async ticketReadyForCheckoutPush(e: DomainEvent<any>, trx: Transaction<DB>): Promise<void> {
    const ticketId = String(e.payload?.ticketId ?? (e.aggregateType === 'ticket' ? e.aggregateId : ''));
    if (!UUID.test(ticketId)) return;
    const t: any = await trx.selectFrom('tickets').select(['id', 'tenant_id', 'customer_id', 'ticket_number']).where('id', '=', ticketId).executeTakeFirst();
    if (!t || String(t.tenant_id) !== String(e.tenantId) || !t.customer_id) return;
    const c: any = await trx.selectFrom('customers').select(['user_id']).where('id', '=', t.customer_id).where('tenant_id', '=', e.tenantId!).executeTakeFirst();
    if (!c?.user_id) return;

    const refKey = `bill_ready:${t.id}`;
    const alreadySent: any = await trx.selectFrom('notification_delivery_logs')
      .select(['id'])
      .where('tenant_id', '=', e.tenantId!)
      .where('template', '=', refKey)
      .where('status', '=', 'sent')
      .executeTakeFirst();
    if (alreadySent) return;

    const label = t.ticket_number ? `#${t.ticket_number}` : 'a ticket';
    try {
      await this.push!.dispatchToUser(e.tenantId!, String(c.user_id), {
        title: 'Your bill is ready — skip the line',
        body: `Your bill is ready on ${label}. Pay from your phone to skip the line.`,
        category: 'CHECK_IN_READY',
        data: { kind: 'bill_ready', ticketId: t.id },
        reference: refKey,
      });
    } catch (err) {
      throw new ConsumerError('TRANSIENT', 'push_provider_failed', String((err as Error)?.message ?? err));
    }
  }

  private async checkoutCompletedPush(e: DomainEvent<any>, trx: Transaction<DB>): Promise<void> {
    const ticketId = String(e.payload?.ticketId ?? (e.aggregateType === 'ticket' ? e.aggregateId : ''));
    if (!UUID.test(ticketId)) return;
    const t: any = await trx.selectFrom('tickets').select(['id', 'tenant_id', 'customer_id', 'ticket_number', 'primary_technician_id', 'tip_cents']).where('id', '=', ticketId).executeTakeFirst();
    if (!t || String(t.tenant_id) !== String(e.tenantId)) return;
    const label = t.ticket_number ? `#${t.ticket_number}` : 'a ticket';
    const sends: { uid: string; msg: any }[] = [];

    // 1. Owner / Manager push
    const owners: any[] = await this.salonManagers(trx, e);
    for (const o of owners) {
      sends.push({
        uid: String(o.id),
        msg: {
          title: 'Payment received',
          body: `Payment received on ticket ${label}.`,
          category: 'PAYMENT_ALERT',
          data: { kind: 'payment_received', ticketId: t.id },
          reference: `payment_received:${t.id}:${o.id}`,
        },
      });
    }

    // 2. Tipped Technicians push
    const allocs: any[] = await trx.selectFrom('ticket_tip_allocations').select(['technician_id', 'tip_cents']).where('tenant_id', '=', e.tenantId!).where('ticket_id', '=', t.id).execute();   // a failed read is retried, never "no tips"
    const tippedTechs = new Set<string>();
    for (const a of allocs) {
      if (a.technician_id && Number(a.tip_cents) > 0) tippedTechs.add(String(a.technician_id));
    }
    if (!tippedTechs.size && Number(t.tip_cents) > 0 && t.primary_technician_id) {
      tippedTechs.add(String(t.primary_technician_id));
    }
    for (const techId of tippedTechs) {
      const uid = await this.users!.technicianUserId({ tenantId: e.tenantId!, branchId: e.branchId ?? '' }, techId);
      if (uid) {
        sends.push({
          uid,
          msg: {
            title: 'Tip received',
            body: `You received a tip on ticket ${label}.`,
            category: 'SERVICE_ALERT',
            data: { kind: 'tip_received', ticketId: t.id },
            reference: `tip_received:${t.id}:${techId}`,
          },
        });
      }
    }

    // 3. Customer payment receipt push
    if (t.customer_id) {
      const c: any = await trx.selectFrom('customers').select(['user_id']).where('id', '=', t.customer_id).where('tenant_id', '=', e.tenantId!).executeTakeFirst();
      if (c?.user_id) {
        sends.push({
          uid: String(c.user_id),
          msg: {
            title: 'Payment completed',
            body: `Your payment was processed on ticket ${label}.`,
            category: 'RECEIPT',
            data: { kind: 'receipt', ticketId: t.id },
            reference: `payment_receipt:${t.id}`,
          },
        });
      }
    }

    const sendsToDispatch = await this.filterAlreadySent(trx, e.tenantId!, sends);
    for (const s of sendsToDispatch) {
      try { await this.push!.dispatchToUser(e.tenantId!, s.uid, s.msg); }
      catch (err) { throw new ConsumerError('TRANSIENT', 'push_provider_failed', String((err as Error)?.message ?? err)); }
    }
  }
}
