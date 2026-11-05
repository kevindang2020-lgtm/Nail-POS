// visit-ticket.ts — multi-technician routing (contract §3 "Serving per line"): the ONE place a queue visit becomes its
// canonical `tickets` row + `ticket_service_lines`. Each line's technician_id — and the commission rule baked onto it —
// is the LINE's technician (queue_service_assignments), falling back to the visit's lead for a line nobody split off.
// Before this, every line was stamped with pos_queue_items.assigned_technician_id, so a recorded split paid the lead
// for every service (compensation reads ticket_service_lines.technician_id; tips split over line technicians).
//
// Used by the POS "start service" (createTicketFromQueueItem) and the Tech app's per-part start / complete. Row-locks the
// queue item (FOR UPDATE) and reuses its ticket_id, so two parts starting at once create ONE ticket.
import { sql } from 'kysely';
import { loadEffectiveRules, resolveFromRules, pickLineCommission, defaultCommissionForTenant } from '@aipowersalon/workforce';
import { nextTicketNumber } from './ticket-number';
import { QueueRuleError, type QueueRequestedService } from './queue.dto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
export const parseServices = (v: any): QueueRequestedService[] => { if (Array.isArray(v)) return v; if (typeof v === 'string') { try { const p = JSON.parse(v || '[]'); return Array.isArray(p) ? p : []; } catch { return []; } } return []; };

/** The technician of each service line of a visit (non-cancelled queue_service_assignments). */
export async function lineTechnicians(trx: any, tenantId: string, queueItemId: string): Promise<Map<string, string>> {
  const rows: any[] = await trx.selectFrom('queue_service_assignments').where('tenant_id', '=', tenantId).where('queue_item_id', '=', queueItemId)
    .where('status', '!=', 'cancelled').where('technician_id', 'is not', null).select(['service_id', 'technician_id']).execute();
  return new Map(rows.map((r) => [String(r.service_id), String(r.technician_id)]));
}

export interface EnsureVisitTicketOpts {
  /** ticket_service_lines.status for a new line: (its technician) → status. Default 'in_service' (the POS start). */
  lineStatus?: (technicianId: string | null) => string;
  /** the queue item already locked by the caller (FOR UPDATE) */
  locked?: boolean;
}

/** The visit's canonical ticket: the existing one (ticket_id) or a new one with per-line technicians. In `trx`. */
export async function ensureVisitTicket(trx: any, ctx: { tenantId: string; branchId?: string | null }, queueItemId: string, opts: EnsureVisitTicketOpts = {}): Promise<{ ticketId: string; created: boolean }> {
  const q: any = await trx.selectFrom('pos_queue_items').where('tenant_id', '=', ctx.tenantId).where('id', '=', queueItemId)
    .select(['id', 'branch_id', 'customer_id', 'ticket_id', 'requested_services', 'assigned_technician_id']).forUpdate().executeTakeFirst();
  if (!q) throw new QueueRuleError('Queue item not found');
  if (q.ticket_id) {
    const t: any = await trx.selectFrom('tickets').where('tenant_id', '=', ctx.tenantId).where('id', '=', q.ticket_id).select(['id']).executeTakeFirst();
    if (t) return { ticketId: String(t.id), created: false };
  }
  const branchId = q.branch_id ?? ctx.branchId ?? null;
  const nowIso = new Date().toISOString();
  const ticketNumber = await nextTicketNumber(trx, ctx.tenantId, branchId);
  const ins: any = await trx.insertInto('tickets').values({
    tenant_id: ctx.tenantId, branch_id: branchId, customer_id: q.customer_id, queue_item_id: q.id,
    primary_technician_id: q.assigned_technician_id || null, status: 'serving', accepted_at: nowIso, serving_started_at: nowIso, ticket_number: ticketNumber,
  } as any).returning(['id']).executeTakeFirstOrThrow();
  const ticketId = String(ins.id);
  const services = parseServices(q.requested_services);
  if (services.length) {
    const lineTech = await lineTechnicians(trx, ctx.tenantId, queueItemId);
    // Capture the service's commission rate onto each line (the *_snapshot columns payroll / earnings read), resolved
    // for the LINE's technician — authored rules (§4) win over the service default; the rate is baked so history is stable.
    const svcIds = [...new Set(services.map((s) => s.serviceId).filter((x) => UUID_RE.test(String(x))))];
    // ONE-PAY (Oct 13 2026): THE precedence (pickLineCommission: authored rule → the service's own rate → tenant default),
    // the same the serving path and stampCommissionOnLine use — this file used to keep its own (rule → service row as-is →
    // NULL), so a 'none'-type service kept its stray value and the engine later read it as a percent.
    const commById = new Map<string, { commission_type: string | null; commission_value: number | string | null }>();
    // the service's CATEGORY is snapshotted on the line (as the serving path does): category-scoped membership benefits
    // and "Technician + Category" / category commission rules match on it — it was NULL here (wave 4 PILOT, Oct 13 2026)
    const catById = new Map<string, string | null>();
    if (svcIds.length) {
      const crows: any[] = await trx.selectFrom('services as s').leftJoin('service_categories as c', (j: any) => j.onRef('c.id', '=', 's.category_id').onRef('c.tenant_id', '=', 's.tenant_id'))
        .where('s.tenant_id', '=', ctx.tenantId).where('s.id', 'in', svcIds).select(['s.id as id', 's.commission_type as commission_type', 's.commission_value as commission_value', 'c.name as category_name'] as any).execute();
      for (const c of crows) { commById.set(String(c.id), { commission_type: c.commission_type ?? null, commission_value: c.commission_value ?? null }); catById.set(String(c.id), c.category_name ?? null); }
    }
    const [rules, tenantDefault] = await Promise.all([loadEffectiveRules(trx, ctx.tenantId), defaultCommissionForTenant(trx, ctx.tenantId)]);
    await trx.insertInto('ticket_service_lines').values(services.map((s) => {
      const technicianId = lineTech.get(String(s.serviceId)) ?? (q.assigned_technician_id || null);
      const category = catById.get(String(s.serviceId)) ?? null;
      const resolved = rules.length ? resolveFromRules(rules, { tenantId: ctx.tenantId, branchId, technicianId, serviceId: s.serviceId, serviceCategory: category }) : null;
      const picked = pickLineCommission(resolved, commById.get(String(s.serviceId)) ?? null, tenantDefault);
      return {
        tenant_id: ctx.tenantId, branch_id: branchId, ticket_id: ticketId, service_id: UUID_RE.test(String(s.serviceId)) ? s.serviceId : NIL_UUID, technician_id: technicianId,
        service_name_snapshot: s.serviceName, price_cents_snapshot: s.priceCents ?? 0, duration_minutes_snapshot: s.estimatedDurationMinutes ?? 0,
        commission_type_snapshot: picked.commissionType, commission_value_snapshot: picked.commissionValue,
        supply_method_snapshot: picked.supplyMethod, supply_value_snapshot: picked.supplyValue, policy_id: picked.policyId, rule_source: picked.source,
        line_total_cents: s.priceOverrideCents !== undefined ? s.priceOverrideCents : (s.priceCents ?? 0), is_add_on: !!s.isAddon, category_snapshot: category,
        status: opts.lineStatus ? opts.lineStatus(technicianId) : 'in_service',
      };
    }) as any).execute();
  }
  // ticket_id is not a queue transition (no version bump — migration 525's trigger ignores it)
  await trx.updateTable('pos_queue_items').set({ ticket_id: ticketId, updated_at: sql`now()` } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', queueItemId).execute();
  await trx.updateTable('pos_tech_queue_tickets').set({ ticket_id: ticketId } as any).where('tenant_id', '=', ctx.tenantId).where('queue_item_id', '=', queueItemId).where('ticket_id', 'is', null).execute();
  return { ticketId, created: true };
}
