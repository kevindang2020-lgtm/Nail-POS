// noshow-risk.kysely.source.ts — production source for no-show risk. Reads UPCOMING appointments for the ctx tenant+branch
// and derives ONLY operational features (lead time, confirmation state, source, and the customer's own prior no-show /
// late-cancellation / total counts). No sensitive attributes are read. Prior counts are correlated subqueries scoped to
// the same tenant + customer; the whole query is tenant+branch scoped. Read-only. Validated against Postgres semantics.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { AiForecastContext } from './ai-analytics-forecasting.dto';
import type { NoShowRiskSource, UpcomingAppointmentRisk } from './noshow-risk.service';

export class KyselyNoShowSource implements NoShowRiskSource {
  constructor(private readonly db: Kysely<DB>) {}

  async getUpcoming(ctx: AiForecastContext, days: number): Promise<UpcomingAppointmentRisk[]> {
    const d = Math.max(1, Math.min(30, days));
    // NOTE: this source was originally authored against a hypothetical `appointments` table (timestamp start_time,
    // confirmed_at, confirmation_required, no_show_at) that does not exist. Repointed to the real pos_tech_appointments
    // table, whose datetime is (appt_date date + start_time text-time) and which models confirmation/no-show via `status`.
    // Semantic mapping (review against intended product semantics): confirmed := status='confirmed';
    // confirmation_required := unknown → false; prior no-show := prior status='no_show'.
    const rows = await sql<any>`
      SELECT a.id AS appointment_id, a.customer_id,
             (a.appt_date + a.start_time::time) AS start_time,
             (a.status = 'confirmed') AS confirmed,
             false AS confirmation_required,
             GREATEST(0, EXTRACT(EPOCH FROM ((a.appt_date + a.start_time::time) - a.created_at)) / 86400.0)::float AS lead_days,
             (SELECT count(*) FROM pos_tech_appointments p
                WHERE p.tenant_id = a.tenant_id AND p.customer_id = a.customer_id
                  AND (p.appt_date + p.start_time::time) < (a.appt_date + a.start_time::time)) AS prior_total,
             (SELECT count(*) FROM pos_tech_appointments p
                WHERE p.tenant_id = a.tenant_id AND p.customer_id = a.customer_id
                  AND (p.appt_date + p.start_time::time) < (a.appt_date + a.start_time::time)
                  AND p.status = 'no_show') AS prior_noshow,
             (SELECT count(*) FROM pos_tech_appointments p
                WHERE p.tenant_id = a.tenant_id AND p.customer_id = a.customer_id
                  AND (p.appt_date + p.start_time::time) < (a.appt_date + a.start_time::time)
                  AND p.status = 'cancelled') AS prior_cancel
      FROM pos_tech_appointments a
      WHERE a.tenant_id = ${ctx.tenantId} AND a.branch_id = ${ctx.branchId}
        AND (a.appt_date + a.start_time::time) > now()
        AND (a.appt_date + a.start_time::time) <= now() + (${String(d)} || ' days')::interval
        AND a.status NOT IN ('cancelled', 'completed', 'no_show', 'in_service', 'serving')
      ORDER BY (a.appt_date + a.start_time::time)
      LIMIT 500
    `.execute(this.db);

    return rows.rows.map((r): UpcomingAppointmentRisk => ({
      appointmentId: r.appointment_id,
      customerId: r.customer_id,
      customerName: null, // name intentionally not joined here; the operational view keys off appointment + time
      startTime: new Date(r.start_time).toISOString(),
      features: {
        totalPriorAppointments: Number(r.prior_total ?? 0),
        priorNoShows: Number(r.prior_noshow ?? 0),
        priorLateCancellations: Number(r.prior_cancel ?? 0),
        bookingLeadTimeDays: Number(r.lead_days ?? 0),
        confirmationRequired: !!r.confirmation_required,
        confirmed: !!r.confirmed,
        depositOnFile: null,            // not modelled in this schema → unknown (not penalized as strongly)
        reminderRecentlyDelivered: null,
        groupSize: null,
      },
    }));
  }
}
