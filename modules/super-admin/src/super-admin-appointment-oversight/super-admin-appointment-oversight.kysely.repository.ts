// super-admin-appointment-oversight.kysely.repository.ts — cross-tenant reads that the existing platform
// aggregate does not already compute for the Appointment Oversight › Overview surface. This file lives under a
// `super-admin-*` path and is PATH-ALLOWLISTED by the tenant-isolation CI scan: every query here is intentionally
// platform-wide (Super Admin is the only cross-tenant role) and may optionally narrow to a single tenant when a
// scope is supplied. No raw client tenant id is ever trusted; `sid` arrives already parsed by parseScope.
//
// Sources are REAL (pos_tech_appointments, technicians, payments). Where a signal has no schema source yet
// (failed bookings, sync failures, integrity issues, appointment value) the SERVICE renders an honest gap —
// this repo never fabricates those.

import { sql, type Kysely } from 'kysely';

export type DailyStatusPoint = { date: string; status: string; count: number };
export type SearchRow = { id: string; customerName: string | null; customerPhone: string | null; apptDate: string | null; startTime: string | null; status: string | null; source: string | null; tenantName: string | null; branchName: string | null; technicianName: string | null };
export type SearchOpts = { q?: string; status?: string; source?: string; page: number; pageSize: number };
export type DuplicateGroup = { tenantName: string | null; customerName: string | null; apptDate: string | null; startTime: string | null; count: number; appointmentIds: string[]; matchReasons: string[]; confidence: number };
export type OverlapConflict = { tenantName: string | null; technicianName: string | null; apptDate: string | null; overlapMinutes: number; a: { id: string; customerName: string | null; startTime: string | null; endTime: string | null }; b: { id: string; customerName: string | null; startTime: string | null; endTime: string | null } };
export type ChangeRow = { id: string; tenantName: string | null; appointmentId: string; changeType: string; field: string | null; oldValue: string | null; newValue: string | null; actorType: string | null; actorId: string | null; source: string | null; createdAt: string | null };
export type FailedRow = { id: string; customerName: string | null; customerPhone: string | null; tenantName: string | null; branchName: string | null; technicianName: string | null; apptDate: string | null; startTime: string | null; status: string | null; depositStatus: string | null };
export type MissingInfoRow = { id: string; customerName: string | null; tenantName: string | null; branchName: string | null; technicianName: string | null; apptDate: string | null; startTime: string | null; status: string | null; missing: string[] };
export type IntegrityRow = { id: string; tenantName: string | null; apptDate: string | null; startTime: string | null; status: string | null; issues: string[] };
export type AppointmentOversightGap = {
  appointmentDailyByStatus(sid: string | undefined, days: number): Promise<DailyStatusPoint[]>;
  technicianCount(sid: string | undefined): Promise<number>;
  todayRevenueCents(sid: string | undefined): Promise<number>;
  searchAppointments(sid: string | undefined, opts: SearchOpts): Promise<{ rows: SearchRow[]; total: number }>;
  detectDuplicates(sid: string | undefined, page: number, pageSize: number): Promise<{ groups: DuplicateGroup[]; total: number }>;
  detectOverlaps(sid: string | undefined, page: number, pageSize: number): Promise<{ conflicts: OverlapConflict[]; total: number }>;
  appointmentChanges(sid: string | undefined, page: number, pageSize: number, changeType?: string, appointmentId?: string): Promise<{ rows: ChangeRow[]; total: number }>;
  failedDepositAppointments(sid: string | undefined, page: number, pageSize: number): Promise<{ rows: FailedRow[]; total: number }>;
  missingInfoAppointments(sid: string | undefined, page: number, pageSize: number): Promise<{ rows: MissingInfoRow[]; total: number }>;
  dataIntegrityIssues(sid: string | undefined, page: number, pageSize: number, appointmentId?: string): Promise<{ rows: IntegrityRow[]; total: number }>;
};

export class KyselyAppointmentOversightGapRepo implements AppointmentOversightGap {
  constructor(private readonly db: Kysely<any>) {}

  // Daily appointment counts split by current status over the last `days` (drives the 4-series Appointments Trend).
  async appointmentDailyByStatus(sid: string | undefined, days: number): Promise<DailyStatusPoint[]> {
    const cutoff = sql`current_date - (${days - 1} || ' days')::interval`;
    try {
      const r: any = await sql<{ d: string; status: string; n: number }>`
        select to_char(appt_date, 'YYYY-MM-DD') as d, status, count(*)::int as n
        from pos_tech_appointments
        where appt_date >= ${cutoff}
          ${sid ? sql`and tenant_id = ${sid}` : sql``}
        group by appt_date, status
        order by appt_date
      `.execute(this.db);
      return (r.rows ?? []).map((x: any) => ({ date: String(x.d), status: String(x.status ?? 'unknown'), count: Number(x.n || 0) }));
    } catch { return []; }
  }

  // Active technician count (platform summary card).
  async technicianCount(sid: string | undefined): Promise<number> {
    try {
      const r: any = await sql<{ n: number }>`
        select count(*)::int as n from technicians
        where ${sid ? sql`tenant_id = ${sid}` : sql`true`}
      `.execute(this.db);
      return Number(r.rows?.[0]?.n || 0);
    } catch { return 0; }
  }

  // Today's approved revenue in integer cents (platform summary card; financial-gated in the service).
  async todayRevenueCents(sid: string | undefined): Promise<number> {
    try {
      const r: any = await sql<{ cents: number }>`
        select coalesce(sum(amount_cents) filter (where approved_at is not null and approved_at::date = current_date), 0)::bigint as cents
        from payments
        where ${sid ? sql`tenant_id = ${sid}` : sql`true`}
      `.execute(this.db);
      return Number(r.rows?.[0]?.cents || 0);
    } catch { return 0; }
  }

  // Server-side, scope-enforced appointment search across authorized tenants. `sid` (already parsed by parseScope,
  // never raw client input) narrows to one tenant when present; absent = platform-wide (Super Admin is the only
  // cross-tenant role, enforced by the controller guard). Built with the Kysely query builder (parameterized).
  async searchAppointments(sid: string | undefined, opts: SearchOpts): Promise<{ rows: SearchRow[]; total: number }> {
    const page = Math.max(1, Math.trunc(opts.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(opts.pageSize || 25)));
    const q = (opts.q || '').trim();
    try {
      const base = () => {
        let qb: any = this.db.selectFrom('pos_tech_appointments as a')
          .innerJoin('tenants as t', 't.id', 'a.tenant_id')
          .leftJoin('technicians as tech', 'tech.id', 'a.technician_id')
          .leftJoin('branches as b', 'b.id', 'a.branch_id');
        if (sid) qb = qb.where('a.tenant_id', '=', sid);
        if (opts.status) qb = qb.where('a.status', '=', opts.status);
        if (opts.source) qb = qb.where('a.source', '=', opts.source);
        if (q) qb = qb.where((eb: any) => eb.or([
          eb('a.customer_name', 'ilike', `%${q}%`),
          eb('t.display_name', 'ilike', `%${q}%`),
          eb('tech.full_name', 'ilike', `%${q}%`),
          eb('b.name', 'ilike', `%${q}%`),
        ]));
        return qb;
      };
      const rows: any[] = await base()
        .select([
          'a.id as id', 'a.customer_name as customer_name', 'a.customer_phone as customer_phone',
          sql`to_char(a.appt_date,'YYYY-MM-DD')`.as('appt_date'), 'a.start_time as start_time',
          'a.status as status', 'a.source as source', 't.display_name as tenant_name',
          'b.name as branch_name', 'tech.full_name as technician_name',
        ])
        .orderBy('a.appt_date', 'desc').orderBy('a.start_time', 'desc')
        .limit(pageSize).offset((page - 1) * pageSize).execute();
      const totalRow: any = await base().select(sql`count(*)`.as('n')).executeTakeFirst();
      return {
        rows: rows.map((r) => ({
          id: String(r.id), customerName: r.customer_name ?? null, customerPhone: r.customer_phone ?? null,
          apptDate: r.appt_date ?? null, startTime: r.start_time ? String(r.start_time) : null, status: r.status ?? null,
          source: r.source ?? null, tenantName: r.tenant_name ?? null, branchName: r.branch_name ?? null, technicianName: r.technician_name ?? null,
        })),
        total: Number(totalRow?.n || 0),
      };
    } catch { return { rows: [], total: 0 }; }
  }

  // Duplicate detection: exact same-tenant collisions (same customer + appt_date + start_time). Grouping is keyed
  // by tenant_id so unrelated tenants are NEVER compared (cross-tenant matches are a separate protected alert, not
  // an ordinary duplicate). No appointment is deleted or merged — this only surfaces candidates for review.
  async detectDuplicates(sid: string | undefined, page: number, pageSize: number): Promise<{ groups: DuplicateGroup[]; total: number }> {
    const p = Math.max(1, Math.trunc(page || 1));
    const ps = Math.min(100, Math.max(1, Math.trunc(pageSize || 25)));
    const tenantFilter = sid ? sql`and a.tenant_id = ${sid}` : sql``;
    try {
      const rows: any = await sql<{ tenant_name: string; customer_name: string; d: string; start_time: string; n: number; ids: string[] }>`
        select t.display_name as tenant_name, a.customer_name as customer_name,
               to_char(a.appt_date,'YYYY-MM-DD') as d, a.start_time as start_time,
               count(*)::int as n, array_agg(a.id::text) as ids
        from pos_tech_appointments a
        join tenants t on t.id = a.tenant_id
        where a.customer_name is not null ${tenantFilter}
        group by t.display_name, a.tenant_id, a.customer_name, a.appt_date, a.start_time
        having count(*) > 1
        order by count(*) desc
        limit ${ps} offset ${(p - 1) * ps}
      `.execute(this.db);
      const totalRow: any = await sql<{ n: number }>`
        select count(*)::int as n from (
          select 1 from pos_tech_appointments a
          where a.customer_name is not null ${tenantFilter}
          group by a.tenant_id, a.customer_name, a.appt_date, a.start_time
          having count(*) > 1
        ) g
      `.execute(this.db);
      return {
        groups: (rows.rows ?? []).map((r: any) => ({
          tenantName: r.tenant_name ?? null, customerName: r.customer_name ?? null,
          apptDate: r.d ?? null, startTime: r.start_time ? String(r.start_time) : null,
          count: Number(r.n || 0), appointmentIds: Array.isArray(r.ids) ? r.ids.map(String) : [],
          matchReasons: ['Same tenant', 'Same customer', 'Same appointment date', 'Same start time'],
          confidence: 95,
        })),
        total: Number(totalRow.rows?.[0]?.n || 0),
      };
    } catch { return { groups: [], total: 0 }; }
  }

  // Overlap detection: same technician + same date with intersecting [start,end) windows, within one tenant only
  // (a.id < b.id de-duplicates the pair and excludes self-pairs). Duration-aware via the half-open interval test.
  // Surfaces conflicts for review; never cancels or reschedules anything automatically.
  async detectOverlaps(sid: string | undefined, page: number, pageSize: number): Promise<{ conflicts: OverlapConflict[]; total: number }> {
    const p = Math.max(1, Math.trunc(page || 1));
    const ps = Math.min(100, Math.max(1, Math.trunc(pageSize || 25)));
    const tenantFilter = sid ? sql`and a.tenant_id = ${sid}` : sql``;
    try {
      const rows: any = await sql<any>`
        select t.display_name as tenant_name, tech.full_name as technician_name,
               to_char(a.appt_date,'YYYY-MM-DD') as d,
               greatest(0, floor(extract(epoch from (least(a.end_time::time, b.end_time::time) - greatest(a.start_time::time, b.start_time::time))) / 60))::int as overlap_minutes,
               a.id::text as a_id, a.customer_name as a_cust, a.start_time as a_start, a.end_time as a_end,
               b.id::text as b_id, b.customer_name as b_cust, b.start_time as b_start, b.end_time as b_end
        from pos_tech_appointments a
        join pos_tech_appointments b
          on b.tenant_id = a.tenant_id and b.technician_id = a.technician_id and b.appt_date = a.appt_date
         and a.id < b.id and a.start_time::time < b.end_time::time and b.start_time::time < a.end_time::time
        join tenants t on t.id = a.tenant_id
        left join technicians tech on tech.id = a.technician_id
        where a.technician_id is not null ${tenantFilter}
        order by a.appt_date desc, tech.full_name nulls last
        limit ${ps} offset ${(p - 1) * ps}
      `.execute(this.db);
      const totalRow: any = await sql<{ n: number }>`
        select count(*)::int as n
        from pos_tech_appointments a
        join pos_tech_appointments b
          on b.tenant_id = a.tenant_id and b.technician_id = a.technician_id and b.appt_date = a.appt_date
         and a.id < b.id and a.start_time::time < b.end_time::time and b.start_time::time < a.end_time::time
        where a.technician_id is not null ${tenantFilter}
      `.execute(this.db);
      return {
        conflicts: (rows.rows ?? []).map((r: any) => ({
          tenantName: r.tenant_name ?? null, technicianName: r.technician_name ?? null, apptDate: r.d ?? null,
          overlapMinutes: Number(r.overlap_minutes || 0),
          a: { id: String(r.a_id), customerName: r.a_cust ?? null, startTime: r.a_start ? String(r.a_start) : null, endTime: r.a_end ? String(r.a_end) : null },
          b: { id: String(r.b_id), customerName: r.b_cust ?? null, startTime: r.b_start ? String(r.b_start) : null, endTime: r.b_end ? String(r.b_end) : null },
        })),
        total: Number(totalRow.rows?.[0]?.n || 0),
      };
    } catch { return { conflicts: [], total: 0 }; }
  }

  // Change History read: append-only appointment_change_log joined to tenant, newest first, scope-enforced.
  async appointmentChanges(sid: string | undefined, page: number, pageSize: number, changeType?: string, appointmentId?: string): Promise<{ rows: ChangeRow[]; total: number }> {
    const p = Math.max(1, Math.trunc(page || 1));
    const ps = Math.min(100, Math.max(1, Math.trunc(pageSize || 25)));
    const tenantFilter = sid ? sql`and l.tenant_id = ${sid}` : sql``;
    const typeFilter = changeType ? sql`and l.change_type = ${changeType}` : sql``;
    const apptFilter = appointmentId ? sql`and l.appointment_id = ${appointmentId}` : sql``;
    try {
      const rows: any = await sql<any>`
        select l.id::text as id, t.display_name as tenant_name, l.appointment_id::text as appointment_id,
               l.change_type as change_type, l.field as field, l.old_value as old_value, l.new_value as new_value,
               l.actor_type as actor_type, l.actor_id::text as actor_id, l.source as source,
               to_char(l.created_at, 'YYYY-MM-DD"T"HH24:MI:SSZ') as created_at
        from appointment_change_log l
        join tenants t on t.id = l.tenant_id
        where true ${tenantFilter} ${typeFilter} ${apptFilter}
        order by l.created_at desc
        limit ${ps} offset ${(p - 1) * ps}
      `.execute(this.db);
      const totalRow: any = await sql<{ n: number }>`select count(*)::int as n from appointment_change_log l where true ${tenantFilter} ${typeFilter} ${apptFilter}`.execute(this.db);
      return {
        rows: (rows.rows ?? []).map((r: any) => ({
          id: String(r.id), tenantName: r.tenant_name ?? null, appointmentId: String(r.appointment_id),
          changeType: r.change_type ?? '', field: r.field ?? null, oldValue: r.old_value ?? null, newValue: r.new_value ?? null,
          actorType: r.actor_type ?? null, actorId: r.actor_id ?? null, source: r.source ?? null, createdAt: r.created_at ?? null,
        })),
        total: Number(totalRow.rows?.[0]?.n || 0),
      };
    } catch { return { rows: [], total: 0 }; }
  }

  // Failures & Issues (live signal): appointments with a FAILED deposit — the failure category the schema captures
  // today. Predicate matches the platform aggregate's failedDeposits count (current/future, not cancelled/no_show)
  // so the oversight view stays consistent. Scope-enforced. Customer phone masked by the service.
  async failedDepositAppointments(sid: string | undefined, page: number, pageSize: number): Promise<{ rows: FailedRow[]; total: number }> {
    const p = Math.max(1, Math.trunc(page || 1));
    const ps = Math.min(100, Math.max(1, Math.trunc(pageSize || 25)));
    const tenantFilter = sid ? sql`and a.tenant_id = ${sid}` : sql``;
    try {
      const rows: any = await sql<any>`
        select a.id::text as id, a.customer_name as customer_name, a.customer_phone as customer_phone,
               t.display_name as tenant_name, b.name as branch_name, tech.full_name as technician_name,
               to_char(a.appt_date,'YYYY-MM-DD') as appt_date, a.start_time as start_time,
               a.status as status, a.deposit_status as deposit_status
        from pos_tech_appointments a
        join tenants t on t.id = a.tenant_id
        left join branches b on b.id = a.branch_id
        left join technicians tech on tech.id = a.technician_id
        where a.deposit_status = 'failed' and a.status not in ('cancelled','no_show') and a.appt_date >= current_date ${tenantFilter}
        order by a.appt_date asc, a.start_time asc
        limit ${ps} offset ${(p - 1) * ps}
      `.execute(this.db);
      const totalRow: any = await sql<{ n: number }>`
        select count(*)::int as n from pos_tech_appointments a
        where a.deposit_status = 'failed' and a.status not in ('cancelled','no_show') and a.appt_date >= current_date ${tenantFilter}
      `.execute(this.db);
      return {
        rows: (rows.rows ?? []).map((r: any) => ({
          id: String(r.id), customerName: r.customer_name ?? null, customerPhone: r.customer_phone ?? null,
          tenantName: r.tenant_name ?? null, branchName: r.branch_name ?? null, technicianName: r.technician_name ?? null,
          apptDate: r.appt_date ?? null, startTime: r.start_time ? String(r.start_time) : null,
          status: r.status ?? null, depositStatus: r.deposit_status ?? null,
        })),
        total: Number(totalRow.rows?.[0]?.n || 0),
      };
    } catch { return { rows: [], total: 0 }; }
  }

  // Missing Information (live signal): upcoming appointments missing customer contact (phone) — matches the platform
  // missingContact count so the workspace stays consistent with the KPI. Per row we also flag any missing technician
  // or customer name. Scope-enforced. No contact is ever auto-filled — this only surfaces gaps for follow-up.
  async missingInfoAppointments(sid: string | undefined, page: number, pageSize: number): Promise<{ rows: MissingInfoRow[]; total: number }> {
    const p = Math.max(1, Math.trunc(page || 1));
    const ps = Math.min(100, Math.max(1, Math.trunc(pageSize || 25)));
    const tenantFilter = sid ? sql`and a.tenant_id = ${sid}` : sql``;
    const predicate = sql`a.appt_date >= current_date and a.status not in ('cancelled','no_show') and (a.customer_phone is null or btrim(a.customer_phone) = '')`;
    try {
      const rows: any = await sql<any>`
        select a.id::text as id, a.customer_name as customer_name, t.display_name as tenant_name, b.name as branch_name,
               tech.full_name as technician_name, to_char(a.appt_date,'YYYY-MM-DD') as appt_date, a.start_time as start_time,
               a.status as status, a.technician_id::text as technician_id, a.customer_phone as customer_phone
        from pos_tech_appointments a
        join tenants t on t.id = a.tenant_id
        left join branches b on b.id = a.branch_id
        left join technicians tech on tech.id = a.technician_id
        where ${predicate} ${tenantFilter}
        order by a.appt_date asc, a.start_time asc
        limit ${ps} offset ${(p - 1) * ps}
      `.execute(this.db);
      const totalRow: any = await sql<{ n: number }>`select count(*)::int as n from pos_tech_appointments a where ${predicate} ${tenantFilter}`.execute(this.db);
      return {
        rows: (rows.rows ?? []).map((r: any) => {
          const missing: string[] = ['Customer phone'];
          if (!r.technician_id) missing.push('Technician');
          if (!r.customer_name || String(r.customer_name).trim() === '') missing.push('Customer name');
          return {
            id: String(r.id), customerName: r.customer_name ?? null, tenantName: r.tenant_name ?? null,
            branchName: r.branch_name ?? null, technicianName: r.technician_name ?? null,
            apptDate: r.appt_date ?? null, startTime: r.start_time ? String(r.start_time) : null, status: r.status ?? null, missing,
          };
        }),
        total: Number(totalRow.rows?.[0]?.n || 0),
      };
    } catch { return { rows: [], total: 0 }; }
  }

  // Data Integrity (live signal): appointments whose references violate tenant scope, or whose time window is
  // impossible. These are genuine platform-corruption signals (not business decisions): a branch/technician/customer
  // referenced by the appointment that does NOT belong to the appointment's own tenant, or end_time < start_time.
  // Read-only detection — surfaces issues for investigation; never auto-corrects. Scope-enforced.
  async dataIntegrityIssues(sid: string | undefined, page: number, pageSize: number, appointmentId?: string): Promise<{ rows: IntegrityRow[]; total: number }> {
    const p = Math.max(1, Math.trunc(page || 1));
    const ps = Math.min(100, Math.max(1, Math.trunc(pageSize || 25)));
    const tenantFilter = sid ? sql`and a.tenant_id = ${sid}` : sql``;
    const apptFilter = appointmentId ? sql`and a.id = ${appointmentId}` : sql``;
    const predicate = sql`(
        (a.branch_id is not null and b.id is null)
        or (a.technician_id is not null and tech.id is null)
        or (a.customer_id is not null and c.id is null)
        or (a.start_time is not null and a.end_time is not null and a.end_time < a.start_time)
      )`;
    try {
      const rows: any = await sql<any>`
        select a.id::text as id, t.display_name as tenant_name, to_char(a.appt_date,'YYYY-MM-DD') as appt_date,
               a.start_time as start_time, a.status as status,
               (a.branch_id is not null and b.id is null) as bad_branch,
               (a.technician_id is not null and tech.id is null) as bad_tech,
               (a.customer_id is not null and c.id is null) as bad_customer,
               (a.start_time is not null and a.end_time is not null and a.end_time < a.start_time) as bad_time
        from pos_tech_appointments a
        join tenants t on t.id = a.tenant_id
        left join branches b on b.id = a.branch_id and b.tenant_id = a.tenant_id
        left join technicians tech on tech.id = a.technician_id and tech.tenant_id = a.tenant_id
        left join customers c on c.id = a.customer_id and c.tenant_id = a.tenant_id
        where ${predicate} ${tenantFilter} ${apptFilter}
        order by a.appt_date desc nulls last, a.start_time asc
        limit ${ps} offset ${(p - 1) * ps}
      `.execute(this.db);
      const totalRow: any = await sql<{ n: number }>`
        select count(*)::int as n
        from pos_tech_appointments a
        left join branches b on b.id = a.branch_id and b.tenant_id = a.tenant_id
        left join technicians tech on tech.id = a.technician_id and tech.tenant_id = a.tenant_id
        left join customers c on c.id = a.customer_id and c.tenant_id = a.tenant_id
        where ${predicate} ${tenantFilter} ${apptFilter}
      `.execute(this.db);
      return {
        rows: (rows.rows ?? []).map((r: any) => {
          const issues: string[] = [];
          if (r.bad_branch) issues.push('Invalid branch reference');
          if (r.bad_tech) issues.push('Invalid technician reference');
          if (r.bad_customer) issues.push('Invalid customer reference');
          if (r.bad_time) issues.push('Impossible time (end before start)');
          return { id: String(r.id), tenantName: r.tenant_name ?? null, apptDate: r.appt_date ?? null, startTime: r.start_time ? String(r.start_time) : null, status: r.status ?? null, issues };
        }),
        total: Number(totalRow.rows?.[0]?.n || 0),
      };
    } catch { return { rows: [], total: 0 }; }
  }
}
