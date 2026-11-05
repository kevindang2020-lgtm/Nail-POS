// customer-booking.kysely.repository.ts — Postgres adapter. Reads the tenant's active services/technicians, resolves
// the customer from the session (customers.user_id), pulls existing appointments for a date for conflict checking, and
// inserts the new appointment. Tenant-scoped on every query.
import { recordAppointmentChanges, detectTechnicianConflict, APPOINTMENT } from '@aipowersalon/appointments';
import { sql, type Kysely } from 'kysely';
import { assertTransition, canMoveToSql, type DB } from '@aipowersalon/database';
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import type { BookableService, BookableTechnician } from './customer-booking.dto';
import { holdGuardFor, lockedForeignHold } from './booking-hold-locked-check';
import { KyselyBookingRepository } from '../booking/booking.kysely.repository';
import { pbTechDayWindows } from '../booking/booking.dto';
import type { CustomerBookingDataPort, CustomerBookingContext, ExistingApptRow, InsertBookingInput, RescheduleAtomicInput } from './customer-booking.repository';

export class KyselyCustomerBookingRepository implements CustomerBookingDataPort {
  constructor(private db: Kysely<DB>, private readonly outbox: OutboxWriter | null = null) { }

  async salonAcceptsBookings(ctx: CustomerBookingContext): Promise<boolean> {
    const r: any = await sql`select status from tenants where id = ${ctx.tenantId} limit 1`.execute(this.db);
    if (r.rows[0]?.status !== 'active') return false;
    // the branch being booked must accept online bookings (the client can now name a branch — Sep 2026 merge)
    if (ctx.branchId) {
      const b: any = await sql`select is_online_booking_enabled from branches where tenant_id = ${ctx.tenantId} and id = ${ctx.branchId} and deleted_at is null limit 1`.execute(this.db).catch(() => ({ rows: [] }));
      if (b.rows.length && b.rows[0].is_online_booking_enabled === false) return false;
    }
    return true;
  }
  async branchBelongsToTenant(ctx: CustomerBookingContext, branchId: string): Promise<boolean> {
    const r: any = await sql`select 1 from branches where tenant_id = ${ctx.tenantId} and id = ${branchId} and deleted_at is null and coalesce(status, 'active') <> 'closed' limit 1`.execute(this.db).catch(() => ({ rows: [] }));
    return r.rows.length > 0;
  }

  async resolveCustomerId(ctx: CustomerBookingContext): Promise<{ id: string; fullName: string; phone?: string | null } | null> {
    const row = await this.db.selectFrom('customers').select(['id', 'full_name', 'normalized_phone', 'phone_display'] as any)
      .where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).where('archived_at', 'is', null)
      .executeTakeFirst();
    if (!row) return null;
    let phone: string | null = (row as any).normalized_phone || (row as any).phone_display || null;
    if (!phone) {
      const u = await this.db.selectFrom('users').select(['normalized_phone'] as any).where('id', '=', ctx.userId).executeTakeFirst();
      phone = (u as any)?.normalized_phone || null;
    }
    return { id: (row as any).id, fullName: (row as any).full_name ?? '', phone };
  }

  async listServices(ctx: CustomerBookingContext): Promise<BookableService[]> {
    const rows = await this.db.selectFrom('services')
      .leftJoin('service_categories', 'service_categories.id', 'services.category_id')
      .select(['services.id as id', 'services.name as name', 'services.duration_minutes as duration_minutes', 'services.price_cents as price_cents', 'service_categories.name as category_name'])
      .where('services.tenant_id', '=', ctx.tenantId).where((eb: any) => eb.or([eb('services.branch_id', '=', ctx.branchId), eb('services.branch_id', 'is', null)])).where('services.status', '=', 'active').orderBy('services.name', 'asc').execute();
    return (rows as any[]).map((r) => ({ id: r.id, name: r.name, durationMinutes: Number(r.duration_minutes), priceCents: Number(r.price_cents), category: r.category_name ?? null }));
  }

  async listTechnicians(ctx: CustomerBookingContext): Promise<BookableTechnician[]> {
    const rows = await this.db.selectFrom('technicians').select(['id', 'full_name'])
      .where('tenant_id', '=', ctx.tenantId).where((eb: any) => eb.or([eb('branch_id', '=', ctx.branchId), eb('branch_id', 'is', null)])).where('is_active', '=', true).orderBy('full_name', 'asc').execute();
    return (rows as any[]).map((r) => ({ id: r.id, fullName: r.full_name ?? '' }));
  }

  async getService(ctx: CustomerBookingContext, serviceId: string): Promise<BookableService | null> {
    const r = await this.db.selectFrom('services').select(['id', 'name', 'duration_minutes', 'price_cents'])
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', serviceId).where('status', '=', 'active').executeTakeFirst();
    return r ? { id: (r as any).id, name: (r as any).name, durationMinutes: Number((r as any).duration_minutes), priceCents: Number((r as any).price_cents) } : null;
  }

  async getServiceAddOns(ctx: CustomerBookingContext, serviceId: string): Promise<{ addOnId: string; durationDeltaMinutes: number; priceCents: number; name: string }[]> {
    const rows = await this.db.selectFrom('service_add_ons')
      .select(['add_on_key', 'name', 'duration_delta_minutes', 'price_cents'])
      .where('tenant_id', '=', ctx.tenantId)
      .where('service_id', '=', serviceId)
      .where('is_active', '=', true)
      .execute();
    return (rows as any[]).map(r => ({
      addOnId: r.add_on_key,
      name: r.name,
      durationDeltaMinutes: Number(r.duration_delta_minutes || 0),
      priceCents: Number(r.price_cents || 0)
    }));
  }

  async getTechnician(ctx: CustomerBookingContext, technicianId: string): Promise<BookableTechnician | null> {
    const r = await this.db.selectFrom('technicians').select(['id', 'full_name', 'branch_id'])
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', technicianId).where('is_active', '=', true).executeTakeFirst();
    return r ? { id: (r as any).id, fullName: (r as any).full_name ?? '', branchId: (r as any).branch_id } : null;
  }

  async existingForDate(ctx: CustomerBookingContext, date: string): Promise<ExistingApptRow[]> {
    const rows = await this.db.selectFrom('pos_tech_appointments').select(['id', 'technician_id', 'start_time', 'end_time', 'status'])
      .where('tenant_id', '=', ctx.tenantId).where('appt_date', '=', date).execute();
    return (rows as any[]).map((a) => ({ appointmentId: a.id, technicianId: a.technician_id, startTime: a.start_time, endTime: a.end_time, status: a.status }));
  }

  async insertBooking(input: InsertBookingInput): Promise<string> {
    const row = await this.db.insertInto('pos_tech_appointments').values({
      tenant_id: input.tenantId,
      branch_id: input.branchId,
      technician_id: input.technicianId,
      customer_id: input.customerId,
      customer_name: input.customerName,
      services: JSON.stringify(input.allServicesData && input.allServicesData.length > 0 ? input.allServicesData : [{ serviceId: input.serviceId, serviceName: input.serviceName, durationMinutes: input.durationMinutes, priceCents: input.priceCents, addOns: input.selectedAddOns || [] }]) as any,
      appt_date: input.date,
      start_time: input.startTime,
      end_time: input.endTime,
      duration_minutes: input.durationMinutes,
      status: 'booked',
      source: 'customer_app',
    } as any).returning('id').executeTakeFirstOrThrow();
    return (row as any).id;
  }

  /** §71/§72: the same rows and the same rule the staff Booking engine uses (settings → store hours, technician_schedules,
   *  technician_blocked_times → pbTechDayWindows); read through the staff repository so there is ONE schedule reader. */
  async technicianWindows(ctx: CustomerBookingContext, technicianId: string, date: string): Promise<{ start: number; end: number }[] | null> {
    const staff = new KyselyBookingRepository(this.db as any);
    const bctx = { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: 'customer', permissions: [] } as any;
    const iso = String(date ?? '').slice(0, 10);
    const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
    if (Number.isNaN(dow)) return null;
    const [settings, scheds, blocks] = await Promise.all([staff.settings(bctx), staff.techSchedules(bctx, dow), staff.blockedTimes(bctx, iso)]);
    return pbTechDayWindows(settings.openTime, settings.closeTime, scheds[technicianId] ?? null, blocks[technicianId] ?? []);
  }

  async insertBookingAtomic(input: InsertBookingInput): Promise<{ ok: true; id: string } | { ok: false; conflictingAppointmentId?: string; heldBy?: string }> {
    try {
      // §73 (Oct 13 2026): the hold guard is computed outside the lock (one cached zone read), checked inside it.
      const guard = await holdGuardFor(this.db as any, input.tenantId, input.branchId, input.date, input.startTime, input.endTime, input.bookingSessionId);
      return await this.doInsertBookingAtomic(input, guard);
    } catch (e: any) {
      // Migration 426: the DATABASE is the last line of defense against double-booking. If a pooling proxy defeats
      // the advisory lock's serialization (the 422 failure mode) and two inserts race past the pre-check, the
      // exclusion constraint rejects the loser with SQLSTATE 23P01. Map it to the same conflict shape the pre-check
      // returns — the caller (and the customer) sees "no longer available", never a 500.
      if (e && (e.code === '23P01' || /exclusion|no_overlap/i.test(String(e.message || '')))) {
        const winner = await this.db.selectFrom('pos_tech_appointments').select('id')
          .where('tenant_id', '=', input.tenantId).where('technician_id', '=', input.technicianId)
          .where('appt_date', '=', input.date).where('status', 'not in', ['cancelled', 'no_show', 'completed'])
          .orderBy('created_at', 'desc').executeTakeFirst();
        return { ok: false as const, conflictingAppointmentId: (winner as any)?.id };
      }
      throw e;
    }
  }

  private async doInsertBookingAtomic(input: InsertBookingInput, guard: Awaited<ReturnType<typeof holdGuardFor>>): Promise<{ ok: true; id: string } | { ok: false; conflictingAppointmentId?: string; heldBy?: string }> {
    return this.db.transaction().execute(async (trx) => {
      // Serialize concurrent same-technician bookings for this date so the re-check sees committed rows. Front-desk
      // booking and this customer surface both INSERT pos_tech_appointments, so the lock key must match the one the
      // booking repo uses: `${tenant}|${technician}|${date}`.
      const key = `${input.tenantId}|${input.technicianId}|${input.date}`;
      await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(trx);
      const rows = await trx.selectFrom('pos_tech_appointments').select(['id', 'technician_id', 'start_time', 'end_time', 'status'])
        .where('tenant_id', '=', input.tenantId).where('appt_date', '=', input.date).execute();
      const existing = (rows as any[]).map((a) => ({ appointmentId: a.id, technicianId: a.technician_id, startTime: a.start_time, endTime: a.end_time, status: a.status }));
      const conf = detectTechnicianConflict(existing as any, input.technicianId, input.startTime, input.endTime, input.bufferMinutes ?? 0);
      if (conf.status === 'conflict') return { ok: false as const, conflictingAppointmentId: conf.conflictingAppointmentId };
      // §13/§73: a slot another session (AI receptionist, Reception Copilot, another customer verifying) is holding is not
      // free — re-read under the branch-day hold lock, the lock SlotHoldService.place takes, so the two can never both win.
      const heldBy = await lockedForeignHold(trx as any, input.tenantId, input.branchId, input.technicianId, input.date, guard);
      if (heldBy) return { ok: false as const, heldBy };
      const row = await trx.insertInto('pos_tech_appointments').values({
        tenant_id: input.tenantId, branch_id: input.branchId, technician_id: input.technicianId, customer_id: input.customerId, customer_name: input.customerName,
        customer_phone: input.customerPhone ?? null,
        services: JSON.stringify(input.allServicesData && input.allServicesData.length > 0 ? input.allServicesData : [{ serviceId: input.serviceId, serviceName: input.serviceName, durationMinutes: input.durationMinutes, priceCents: input.priceCents, addOns: input.selectedAddOns || [] }]) as any,
        appt_date: input.date, start_time: input.startTime, end_time: input.endTime, duration_minutes: input.durationMinutes, status: 'booked', source: 'customer_app',
        notes: input.notes ?? null, inspiration_photo_id: input.inspirationPhotoId ?? null,
      } as any).returning('id').executeTakeFirstOrThrow();
      // Real notification for the customer's bell/feed — same transaction, tenant+customer scoped.
      await trx.insertInto('customer_notifications').values({
        tenant_id: input.tenantId, customer_id: input.customerId, type: 'appointment',
        title: 'Appointment booked', body: `${input.serviceName} on ${input.date} at ${input.startTime}`, reference: (row as any).id,
      } as any).execute();
      if (this.outbox) {
        await this.outbox.write(trx, createDomainEvent({
          eventType: DOMAIN_EVENTS.APPOINTMENT_CREATED,
          tenantId: input.tenantId,
          branchId: input.branchId || undefined,
          aggregateType: 'appointment',
          aggregateId: (row as any).id,
          actorId: input.customerId || undefined,
          actorType: 'user',
          payload: {
            appointmentId: (row as any).id,
            technicianId: input.technicianId ?? null,
            customerId: input.customerId ?? null,
            customerPhone: input.customerPhone ?? null,
            customerName: input.customerName ?? null,
            date: input.date,
            startTime: input.startTime,
            endTime: input.endTime,
            source: 'customer_app',
            status: 'booked',
            serviceCount: input.allServicesData?.length || 1,
          },
        }));
      }
      return { ok: true as const, id: (row as any).id };
    });
  }

  async getAppointmentForReschedule(ctx: CustomerBookingContext, customerId: string, appointmentId: string): Promise<{ technicianId: string; durationMinutes: number; status: string } | null> {
    const r = await this.db.selectFrom('pos_tech_appointments').select(['technician_id', 'duration_minutes', 'status'])
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', appointmentId).where('customer_id', '=', customerId).executeTakeFirst();
    return r ? { technicianId: (r as any).technician_id, durationMinutes: Number((r as any).duration_minutes), status: (r as any).status } : null;
  }

  async rescheduleAtomic(input: RescheduleAtomicInput): Promise<{ ok: boolean; conflictingAppointmentId?: string; heldBy?: string }> {
    // Merge Oct 12 2026: 23P01 from the no-overlap constraint (426/482) is a lost race, not a 500 — the same mapping
    // insertBookingAtomic has had since 426 (a pooling proxy can defeat the advisory lock; the database is the last line).
    const result = await this.db.transaction().execute(async (trx): Promise<{ ok: boolean; conflictingAppointmentId?: string; heldBy?: string; before?: any }> => {
      // §73 (Oct 13 2026): the appointment's branch decides which holds count; the guard (branch-zone instants) is read
      // before the lock — plain reads, the zone lookup is cached.
      const br: any = await trx.selectFrom('pos_tech_appointments').select(['branch_id']).where('tenant_id', '=', input.tenantId).where('id', '=', input.appointmentId).executeTakeFirst();
      const branchId: string | null = br?.branch_id ?? null;
      const guard = branchId ? await holdGuardFor(trx as any, input.tenantId, branchId, input.date, input.startTime, input.endTime, input.bookingSessionId) : null;
      const key = `${input.tenantId}|${input.technicianId}|${input.date}`;
      await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(trx);
      const rows = await trx.selectFrom('pos_tech_appointments').select(['id', 'technician_id', 'start_time', 'end_time', 'status'])
        .where('tenant_id', '=', input.tenantId).where('appt_date', '=', input.date).execute();
      const existing = (rows as any[]).filter((a) => a.id !== input.appointmentId).map((a) => ({ appointmentId: a.id, technicianId: a.technician_id, startTime: a.start_time, endTime: a.end_time, status: a.status }));
      const conf = detectTechnicianConflict(existing as any, input.technicianId, input.startTime, input.endTime, input.bufferMinutes ?? 0);
      if (conf.status === 'conflict') return { ok: false as const, conflictingAppointmentId: conf.conflictingAppointmentId };
      if (branchId && guard) {
        const heldBy = await lockedForeignHold(trx as any, input.tenantId, branchId, input.technicianId, input.date, guard);
        if (heldBy) return { ok: false as const, heldBy };
      }
      // capture prior values inside the txn (read-only, safe); the change row is written AFTER commit
      let before: any;
      try { before = await trx.selectFrom('pos_tech_appointments').select(['start_time', 'technician_id', 'appt_date', 'status']).where('tenant_id', '=', input.tenantId).where('id', '=', input.appointmentId).executeTakeFirst(); } catch { before = undefined; }
      // Phase 12 (#27): a customer reschedule confirms the visit — through the APPOINTMENT machine (a completed or
      // cancelled visit is not revived by a reschedule: 409), conditional on the status read
      if (before?.status) assertTransition(APPOINTMENT, before.status, 'confirmed');
      await trx.updateTable('pos_tech_appointments').set({ appt_date: input.date, start_time: input.startTime, end_time: input.endTime, status: 'confirmed', updated_at: new Date() } as any)
        .where('tenant_id', '=', input.tenantId).where('id', '=', input.appointmentId).where(canMoveToSql(APPOINTMENT, 'confirmed') as any).execute();
      await trx.insertInto('customer_notifications').values({
        tenant_id: input.tenantId, customer_id: input.customerId, type: 'appointment',
        title: 'Appointment rescheduled', body: `Moved to ${input.date} at ${input.startTime}`, reference: input.appointmentId,
      } as any).execute();
      if (this.outbox) {
        await this.outbox.write(trx, createDomainEvent({
          eventType: DOMAIN_EVENTS.APPOINTMENT_RESCHEDULED,
          tenantId: input.tenantId,
          branchId: branchId || undefined,
          aggregateType: 'appointment',
          aggregateId: input.appointmentId,
          actorId: input.customerId || undefined,
          actorType: 'user',
          payload: {
            appointmentId: input.appointmentId,
            date: input.date,
            startTime: input.startTime,
            endTime: input.endTime,
            status: 'confirmed',
            technicianId: input.technicianId,
          },
        }));
      }
      return { ok: true as const, before };
    }).catch((e: any) => {
      if (e && (e.code === '23P01' || /exclusion|no_overlap/i.test(String(e.message || '')))) return { ok: false as const };
      throw e;
    });
    // Record AFTER commit — a swallowed audit error must never abort the reschedule txn.
    if ((result as any).ok) {
      await recordAppointmentChanges(this.db, { tenantId: input.tenantId, branchId: null, actorType: 'customer', actorId: input.customerId, source: 'customer_booking' }, input.appointmentId, 'rescheduled', [
        { field: 'start_time', old: (result as any).before?.start_time, new: input.startTime },
        { field: 'technician_id', old: (result as any).before?.technician_id, new: input.technicianId },
        { field: 'appt_date', old: (result as any).before?.appt_date, new: input.date },
      ]);
    }
    return { ok: (result as any).ok, conflictingAppointmentId: (result as any).conflictingAppointmentId, ...((result as any).heldBy ? { heldBy: (result as any).heldBy } : {}) };
  }

  /** Mandate §51/§78: verify the technician is approved/eligible for the requested service IDs. */
  async isTechnicianEligibleForServices(ctx: CustomerBookingContext, technicianId: string, serviceIds: string[]): Promise<boolean> {
    if (!serviceIds.length) return true;
    const tech: any = await this.db.selectFrom('technicians')
      .select(['id', 'is_active', 'status', 'service_eligibility_mode'])
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', technicianId)
      .executeTakeFirst().catch(() => undefined);
    if (!tech || tech.is_active === false || tech.status === 'archived' || tech.status === 'suspended') return false;

    const rows: any[] = await this.db.selectFrom('technician_services')
      .select(['service_id'])
      .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId)
      .execute().catch(() => []);

    const approved = new Set(rows.map((r) => String(r.service_id)));
    if (approved.size === 0) {
      // Unmapped / grandfathered: before services are explicitly mapped in technician_services, all are permitted
      return true;
    }
    return serviceIds.every((sid) => approved.has(sid));
  }
}
