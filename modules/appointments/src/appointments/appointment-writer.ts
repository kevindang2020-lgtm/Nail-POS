// appointment-writer.ts — Oct 14 build plan §7 / Phase 3-J ("one appointment writer"), rebuilt Oct 21 2026.
//
// Five places inserted pos_tech_appointments (the POS booking engine, the customer app twice, the technician's own
// appointments, the live technician schedule's open slot) — each with its own column list and its own idea of what else
// must happen. Two of them wrote NO appointment.created: an online booking never reached the realtime projection (the
// booking board learned of it from the 15-second sync) or the analytics roll-up. This is now THE place an appointment
// row is born: the row and its appointment.created commit together, inside whatever transaction and slot guard the
// caller already holds (the technician-day lock, the hold re-check, the overlap constraint are the caller's and the
// database's business — see appointment-slot-guard). apps/api's one-appointment-writer test pins that no other file
// inserts into the table.
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';

export interface NewAppointmentRow {
  /** technicianId null: booked for "first available" (Fair Turn §19) */
  tenantId: string; branchId: string; technicianId: string | null; customerId: string | null; customerName: string; customerPhone?: string | null; isVip?: boolean;
  source: string; services: unknown[]; date: string; startTime: string; endTime: string; durationMinutes: number; status?: string;
  notes?: string | null; inspirationPhotoId?: string | null; anyTechnician?: boolean; depositStatus?: string;
  /** an intentional, reasoned overbook (Smooth Refresh §11) — written flagged */
  overbook?: { reason: string; byUserId: string | null } | null;
  /** extra columns a caller owns (idempotency keys, phone verification stamps); never the ones above */
  extra?: Record<string, unknown>;
}
export interface AppointmentActor { userId?: string | null; actorType?: 'user' | 'system' | 'ai' | 'worker' }

export class AppointmentWriter {
  constructor(private readonly outbox?: OutboxWriter | null) {}

  /** INSERT the row and its appointment.created in the caller's transaction. Returns the new id. A 23P01 (overlap) is
   *  the caller's to map — it already does, through the slot guard. */
  async insert(trx: Kysely<DB>, row: NewAppointmentRow, actor: AppointmentActor = {}): Promise<string> {
    const r: any = await trx.insertInto('pos_tech_appointments').values({
      tenant_id: row.tenantId, branch_id: row.branchId, technician_id: row.technicianId, customer_id: row.customerId ?? null, customer_name: row.customerName, customer_phone: row.customerPhone ?? null, is_vip: !!row.isVip,
      source: row.source, services: JSON.stringify(row.services ?? []) as any, appt_date: row.date, start_time: row.startTime, end_time: row.endTime, duration_minutes: row.durationMinutes, status: row.status ?? 'booked',
      ...(row.depositStatus ? { deposit_status: row.depositStatus } : {}),
      ...(row.notes !== undefined ? { notes: row.notes } : {}), ...(row.inspirationPhotoId !== undefined ? { inspiration_photo_id: row.inspirationPhotoId } : {}),
      ...(row.anyTechnician ? { any_technician: true } : {}),
      ...(row.overbook ? { overbook_ok: true, overbook_reason: row.overbook.reason, overbook_by_user_id: row.overbook.byUserId } : {}),
      ...(row.extra ?? {}),
    } as any).returning(['id', 'version']).executeTakeFirstOrThrow();
    const id = String(r.id);
    if (this.outbox) {
      await this.outbox.write(trx, createDomainEvent({
        eventType: DOMAIN_EVENTS.APPOINTMENT_CREATED, tenantId: row.tenantId, branchId: row.branchId,
        aggregateType: 'appointment', aggregateId: id, aggregateVersion: r.version != null ? Number(r.version) : undefined,   // §43
        actorId: actor.userId ?? undefined, actorType: actor.actorType ?? (actor.userId ? 'user' : 'system'),
        // §95: ids and scheduling facts only — never the customer's name or phone
        payload: { appointmentId: id, technicianId: row.technicianId ?? null, customerId: row.customerId ?? null, date: row.date, startTime: row.startTime, endTime: row.endTime,
                   source: row.source, status: row.status ?? 'booked', serviceCount: (row.services ?? []).length },
      }));
    }
    return id;
  }
}
