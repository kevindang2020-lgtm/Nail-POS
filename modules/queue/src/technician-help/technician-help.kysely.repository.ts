// Kysely HelpRepositoryPort — real DB, tenant/branch scoped. Not wired into a module yet (Phase 3b); shipped now so the
// wiring slice is a pure DI step. Mirrors the serving repo's scoped()/line-update patterns and the shared audit_logs
// best-effort insert. The status transition is atomic (UPDATE ... WHERE status = <from>), so a duplicate accept can't
// double-handle a request.
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { projectionDeliversRealtime } from '@aipowersalon/config';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { HelpRepositoryPort, HelpActor, HelpRequest, HelpStatus, ServiceLineRef } from './technician-help.service';
import { allocateHelperOnLine } from '@aipowersalon/workforce';
import { isUuidId } from '@aipowersalon/observability';

const CLOSED_TICKET_STATUSES = ['paid', 'cancelled', 'voided', 'refunded'];

export class KyselyHelpRepository implements HelpRepositoryPort {
  constructor(private readonly db: Kysely<DB>, private readonly outbox?: OutboxWriter) {}
  /** Will help-request changes reach clients through the realtime projection? (outbox AND publisher on — 6f3b0ed) */
  emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.outbox != null); }
  private async helpFact(trx: any, a: HelpActor, type: string, requestId: string, r: any): Promise<void> {
    if (!this.outbox) return;
    await this.outbox.write(trx, createDomainEvent({ eventType: type as any, tenantId: a.tenantId, branchId: (r.branch_id as string) ?? a.branchId ?? undefined,
      aggregateType: 'technician_help_request', aggregateId: requestId, actorId: (a as any).userId || undefined, actorType: 'user', correlationId: r.ticket_id ? `ticket:${r.ticket_id}` : undefined,
      // ids only — the request's free-text note and any decline reason stay in the row (the apps refetch the request)
      payload: { requestId, ticketId: r.ticket_id ?? null, serviceLineId: r.service_line_id ?? null, serviceId: r.service_id ?? null,
        primaryTechnicianId: r.primary_technician_id ?? null, helperTechnicianId: r.helper_technician_id ?? null } }));
  }

  private scoped(qb: any, a: HelpActor): any {
    let q = qb.where('tenant_id', '=', a.tenantId);
    if (a.branchId) q = q.where((eb: any) => eb.or([eb('branch_id', '=', a.branchId), eb('branch_id', 'is', null)]));
    return q;
  }

  async ticketIsOpen(a: HelpActor, ticketId: string): Promise<boolean> {
    if (!isUuidId(ticketId)) return false;
    const r = await this.scoped(this.db.selectFrom('tickets'), a).where('id', '=', ticketId)
      .where('status', 'not in', CLOSED_TICKET_STATUSES).select(['id']).executeTakeFirst().catch(() => undefined);
    return !!r;
  }
  async loadServiceLine(a: HelpActor, ticketId: string, serviceLineId: string): Promise<ServiceLineRef | null> {
    if (!isUuidId(ticketId) || !isUuidId(serviceLineId)) return null;   // SW-21: an empty / malformed id is no line — never sent to PostgreSQL
    const r = await this.scoped(this.db.selectFrom('ticket_service_lines'), a).where('id', '=', serviceLineId).where('ticket_id', '=', ticketId)
      .select(['id', 'ticket_id', 'service_id', 'technician_id']).executeTakeFirst().catch(() => undefined);
    return r ? { serviceLineId: r.id, ticketId: r.ticket_id, serviceId: r.service_id, technicianId: r.technician_id } : null;
  }
  async hasOpenRequest(a: HelpActor, serviceLineId: string, helperTechnicianId: string): Promise<boolean> {
    const r = await this.scoped(this.db.selectFrom('technician_help_requests'), a).where('service_line_id', '=', serviceLineId)
      .where('helper_technician_id', '=', helperTechnicianId).where('status', 'in', ['pending', 'accepted']).select(['id']).executeTakeFirst().catch(() => undefined);
    return !!r;
  }
  async insertRequest(a: HelpActor, row: Omit<HelpRequest, 'id' | 'createdAt' | 'status' | 'respondedAt' | 'declineReason'>): Promise<HelpRequest> {
    const r = await this.db.transaction().execute(async (trx) => {
      const ins: any = await trx.insertInto('technician_help_requests').values({
        tenant_id: row.tenantId, branch_id: row.branchId, ticket_id: row.ticketId, service_line_id: row.serviceLineId, service_id: row.serviceId,
        primary_technician_id: row.primaryTechnicianId, helper_technician_id: row.helperTechnicianId, reason: row.reason, note: row.note,
        created_by_user_id: row.createdByUserId, created_by_technician_id: row.createdByTechnicianId,
      } as any).returningAll().executeTakeFirstOrThrow();
      await this.helpFact(trx, a, DOMAIN_EVENTS.TECH_HELP_REQUESTED, String(ins.id), ins);
      return ins;
    });
    return this.map(r);
  }
  async getRequest(a: HelpActor, id: string): Promise<HelpRequest | null> {
    const r = await this.scoped(this.db.selectFrom('technician_help_requests'), a).where('id', '=', id).selectAll().executeTakeFirst().catch(() => undefined);
    return r ? this.map(r) : null;
  }
  async transition(a: HelpActor, id: string, from: HelpStatus, to: HelpStatus, patch: { respondedAt?: string; declineReason?: string }): Promise<boolean> {
    const set: any = { status: to };
    if (patch.respondedAt) set.responded_at = patch.respondedAt;
    if (patch.declineReason !== undefined) set.decline_reason = patch.declineReason ?? null;
    return this.db.transaction().execute(async (trx) => {
      const row: any = await this.scoped((trx as unknown as Kysely<DB>).updateTable('technician_help_requests'), a).set(set).where('id', '=', id).where('status', '=', from)
        .returningAll().executeTakeFirst();
      if (!row) return false;                               // lost the race / already handled: nothing changed, no fact
      const type = to === 'accepted' ? DOMAIN_EVENTS.TECH_HELP_ACCEPTED : to === 'declined' ? DOMAIN_EVENTS.TECH_HELP_DECLINED : null;
      if (type) await this.helpFact(trx, a, type, id, row);
      return true;
    }).catch(() => false);
  }
  // Helper accept = an explicit ALLOCATION row (587 line allocations — mandate §123/§124: primary keeps technician_id,
  // helper 50/50 share) — the old reassignment of technician_id erased the primary's earnings on the line. The
  // compensation engine reads allocations. (Technician Profile merge, Oct 12 2026.)
  async assignLineTechnician(a: HelpActor, ticketId: string, serviceLineId: string, technicianId: string): Promise<void> {
    await allocateHelperOnLine(this.db, { tenantId: a.tenantId, ticketId, lineId: serviceLineId, helperTechnicianId: technicianId, byUserId: (a as any).userId ?? null }).catch(() => null);
  }
  async listForHelper(a: HelpActor, helperTechnicianId: string, statuses: HelpStatus[]): Promise<HelpRequest[]> {
    const rows = await this.scoped(this.db.selectFrom('technician_help_requests'), a).where('helper_technician_id', '=', helperTechnicianId)
      .where('status', 'in', statuses).orderBy('created_at', 'desc').selectAll().execute().catch(() => []);
    return rows.map((r: any) => this.map(r));
  }
  async listForTicket(a: HelpActor, ticketId: string): Promise<HelpRequest[]> {
    const rows = await this.scoped(this.db.selectFrom('technician_help_requests'), a).where('ticket_id', '=', ticketId)
      .orderBy('created_at', 'desc').selectAll().execute().catch(() => []);
    return rows.map((r: any) => this.map(r));
  }
  async writeAudit(a: HelpActor, action: string, entityId: string, metadata: unknown): Promise<void> {
    try {
      await sql`INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
        VALUES (${a.tenantId}, ${a.branchId}, ${a.userId ?? null}, ${'TECHNICIAN'}, ${action}, ${'technician_help'}, ${entityId}, ${JSON.stringify(metadata ?? {})}::jsonb)`.execute(this.db);
    } catch { /* audit is best-effort; never blocks the workflow */ }
  }
  private map(r: any): HelpRequest {
    return {
      id: r.id, tenantId: r.tenant_id, branchId: r.branch_id, ticketId: r.ticket_id, serviceLineId: r.service_line_id, serviceId: r.service_id,
      primaryTechnicianId: r.primary_technician_id, helperTechnicianId: r.helper_technician_id, reason: r.reason, note: r.note,
      status: r.status as HelpStatus, respondedAt: r.responded_at ? new Date(r.responded_at).toISOString() : null, declineReason: r.decline_reason,
      createdByUserId: r.created_by_user_id, createdByTechnicianId: r.created_by_technician_id, createdAt: new Date(r.created_at).toISOString(),
    };
  }
}
