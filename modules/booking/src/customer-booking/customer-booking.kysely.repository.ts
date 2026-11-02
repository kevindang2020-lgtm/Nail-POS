// customer-booking.kysely.repository.ts — Postgres adapter. Reads the tenant's active services/technicians, resolves
// the customer from the session (customers.user_id), pulls existing appointments for a date for conflict checking, and
// inserts the new appointment. Tenant-scoped on every query.
import { AppointmentWriter } from '@aipowersalon/appointments';
import type { OutboxWriter } from '@aipowersalon/events';
import { localDateTimeToEpochMs, utcDate } from '@aipowersalon/date-time';
import { recordAppointmentChanges, detectTechnicianConflict, APPOINTMENT } from '@aipowersalon/appointments';
import { sql, type Kysely } from 'kysely';
import { categoryAddOnsForService, mergeAddOnRows, assertTransition, canMoveToSql, type DB } from '@aipowersalon/database';
import type { BookableService, BookableTechnician } from './customer-booking.dto';
import { holdGuardFor, lockedForeignHold } from './booking-hold-locked-check';
import { KyselyBookingRepository } from '../booking/booking.kysely.repository';
import { pbTechDayWindows } from '../booking/booking.dto';
import type { CustomerBookingDataPort, CustomerBookingContext, ExistingApptRow, InsertBookingInput , RescheduleAtomicInput} from './customer-booking.repository';
import { customerNoticeText } from '@aipowersalon/api-contracts';
/** customers.preferred_language for this salon's customer (null = English), read in the booking's own transaction */
async function customerLanguageOf(db: any, tenantId: string, customerId: string): Promise<string | null> {
  const r = await db.selectFrom('customers').select(['preferred_language']).where('tenant_id', '=', tenantId).where('id', '=', customerId).executeTakeFirst();
  return r?.preferred_language ?? null;
}

export class KyselyCustomerBookingRepository implements CustomerBookingDataPort {
  constructor(private db: Kysely<DB>, private readonly outbox: OutboxWriter | null = null) {}
  /** Oct 21 2026: THE one appointment writer — the row and its appointment.created commit together (an online booking used to write no event) */
  private readonly writer = new AppointmentWriter(this.outbox);

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

  async appointmentBelongsToCustomer(ctx: CustomerBookingContext, appointmentId: string, customerId: string): Promise<boolean> {
    const r: any = await (this.db.selectFrom('pos_tech_appointments') as any).select(['id']).where('tenant_id', '=', ctx.tenantId).where('id', '=', appointmentId).where('customer_id', '=', customerId).executeTakeFirst();
    return !!r;
  }
  async startsAtOf(ctx: CustomerBookingContext, appointmentId: string): Promise<Date | null> {
    const r: any = await (this.db.selectFrom('pos_tech_appointments as a') as any).leftJoin('branches as b', 'b.id', 'a.branch_id').select(['a.appt_date', 'a.start_time', 'b.timezone'])
      .where('a.tenant_id', '=', ctx.tenantId).where('a.id', '=', appointmentId).executeTakeFirst();
    if (!r) return null;
    const date = r.appt_date instanceof Date ? utcDate(r.appt_date) : String(r.appt_date).slice(0, 10);   // a DATE column arrives as midnight UTC
    const ms = localDateTimeToEpochMs(date, String(r.start_time), String(r.timezone || 'America/New_York'));
    return Number.isFinite(ms) ? new Date(ms) : null;
  }
  async resolveCustomerId(ctx: CustomerBookingContext): Promise<{ id: string; fullName: string; phone?: string | null; language?: string | null } | null> {
    const row = await this.db.selectFrom('customers').select(['id', 'full_name', 'normalized_phone', 'phone_display', 'preferred_language'])
      .where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).where('archived_at', 'is', null)
      .executeTakeFirst();
    if (!row) return null;
    // the customer's phone (their salon profile, else their account's verified number) rides onto the appointment row
    let phone: string | null = row.normalized_phone || row.phone_display || null;
    if (!phone) phone = (await this.db.selectFrom('users').select(['normalized_phone']).where('id', '=', ctx.userId).executeTakeFirst())?.normalized_phone ?? null;
    // VietnamesePOS §54 / §119: the language the customer's own messages go out in (customers.preferred_language)
    return { id: String(row.id), fullName: row.full_name ?? '', phone, language: row.preferred_language ?? null };
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
    // §140 (Oct 21 2026): a service is its BRANCH's — its price, duration and availability. Read without the branch, a
    // booking at one location could name another location's row and carry that location's price and duration.
    const r = await this.db.selectFrom('services').select(['id', 'name', 'duration_minutes', 'price_cents'])
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', serviceId).where('status', '=', 'active')
      .where((eb: any) => eb.or([eb('branch_id', '=', ctx.branchId), eb('branch_id', 'is', null)])).executeTakeFirst();
    return r ? { id: (r as any).id, name: (r as any).name, durationMinutes: Number((r as any).duration_minutes), priceCents: Number((r as any).price_cents) } : null;
  }

  // D1 (Oct 22 2026): the "Add-ons" category is the authority — a customer booking offers the same add-ons the kiosk and
  // the POS do; the legacy service_add_ons rows are kept and served beside them (categoryAddOnsForService / mergeAddOnRows).
  async getServiceAddOns(ctx: CustomerBookingContext, serviceId: string): Promise<{ addOnId: string; durationDeltaMinutes: number; priceCents: number; name: string }[]> {
    const category = await categoryAddOnsForService(this.db, ctx.tenantId, serviceId);
    const rows = await this.db.selectFrom('service_add_ons')
      .select(['add_on_key', 'name', 'duration_delta_minutes', 'price_cents'])
      .where('tenant_id', '=', ctx.tenantId)
      .where('service_id', '=', serviceId)
      .where('is_active', '=', true)
      .execute();
    const legacy = (rows as any[]).map(r => ({ addOnId: String(r.add_on_key), name: String(r.name), durationDeltaMinutes: Number(r.duration_delta_minutes || 0), priceCents: Number(r.price_cents || 0), isTaxable: true, isActive: true }));
    return mergeAddOnRows(category.filter((a) => a.isActive), legacy).map((a) => ({ addOnId: a.addOnId, name: a.name, durationDeltaMinutes: a.durationDeltaMinutes, priceCents: a.priceCents }));
  }

  async getTechnician(ctx: CustomerBookingContext, technicianId: string): Promise<BookableTechnician | null> {
    const r = await this.db.selectFrom('technicians').select(['id', 'full_name', 'branch_id'])
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', technicianId).where('is_active', '=', true).executeTakeFirst();
    return r ? { id: (r as any).id, fullName: (r as any).full_name ?? '', branchId: (r as any).branch_id } : null;
  }

  /** the customer app's appointment row, for the one writer */
  private rowOf(input: InsertBookingInput) {
    return {
      tenantId: input.tenantId, branchId: input.branchId, technicianId: input.technicianId, customerId: input.customerId, customerName: input.customerName,
      customerPhone: input.customerPhone ?? null,   // merged from the developer tree (Oct 23 2026): the desk sees the app guest's phone
      services: input.allServicesData && input.allServicesData.length > 0 ? input.allServicesData : [{ serviceId: input.serviceId, serviceName: input.serviceName, durationMinutes: input.durationMinutes, priceCents: input.priceCents, addOns: input.selectedAddOns }],
      date: input.date, startTime: input.startTime, endTime: input.endTime, durationMinutes: input.durationMinutes, status: 'booked', source: 'customer_app',
      notes: input.notes ?? null, inspirationPhotoId: input.inspirationPhotoId ?? null,
    };
  }
  async existingForDate(ctx: CustomerBookingContext, date: string): Promise<ExistingApptRow[]> {
    const rows = await this.db.selectFrom('pos_tech_appointments').select(['id', 'technician_id', 'start_time', 'end_time', 'status'])
      .where('tenant_id', '=', ctx.tenantId).where('appt_date', '=', date).execute();
    return (rows as any[]).map((a) => ({ appointmentId: a.id, technicianId: a.technician_id, startTime: a.start_time, endTime: a.end_time, status: a.status }));
  }

  async insertBooking(input: InsertBookingInput): Promise<string> {
    return this.db.transaction().execute((trx) => this.writer.insert(trx as unknown as Kysely<DB>, this.rowOf(input), { actorType: 'user' }));
  }

  /** §71/§72: the same rows and the same rule the staff Booking engine uses (settings → store hours, technician_schedules,
   *  technician_blocked_times → pbTechDayWindows); read through the staff repository so there is ONE schedule reader. */
  async technicianWindows(ctx: CustomerBookingContext, technicianId: string, date: string): Promise<{ start: number; end: number }[] | null> {
    const staff = new KyselyBookingRepository(this.db as any);
    const bctx = { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: 'customer', permissions: [] } as any;
    const iso = String(date ?? '').slice(0, 10);
    const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
    if (Number.isNaN(dow)) return null;
    const [settings, scheds, blocks] = await Promise.all([staff.settings(bctx), staff.techSchedules(bctx, dow, iso), staff.blockedTimes(bctx, iso)]);
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
      const row = { id: await this.writer.insert(trx as unknown as Kysely<DB>, this.rowOf(input), { actorType: 'user' }) };
      // Real notification for the customer's bell/feed — same transaction, tenant+customer scoped.
      // VietnamesePOS §54 / §119: the feed row in the customer's language (customers.preferred_language)
      const booked = customerNoticeText('appointment_booked_detail', await customerLanguageOf(trx, input.tenantId, input.customerId),
        { serviceName: input.serviceName, extraServices: Math.max(0, (input.allServicesData?.length ?? 1) - 1), ymd: input.date, hhmm: input.startTime });
      await trx.insertInto('customer_notifications').values({
        tenant_id: input.tenantId, customer_id: input.customerId, type: 'appointment',
        title: booked.title, body: booked.body, reference: (row as any).id,
      } as any).execute();
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
      const moved = customerNoticeText('appointment_rescheduled', await customerLanguageOf(trx, input.tenantId, input.customerId), { ymd: input.date, hhmm: input.startTime });
      await trx.insertInto('customer_notifications').values({
        tenant_id: input.tenantId, customer_id: input.customerId, type: 'appointment',
        title: moved.title, body: moved.body, reference: input.appointmentId,
      } as any).execute();
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
}
