// support-actions.service.ts — thin super-admin write layer for Support Center. Reuses the existing audited
// SupportTicketsService.createTicket (does NOT reimplement ticket creation) but lets an authorized super-admin create a
// ticket FOR a validated target tenant. Controlled support-mode session start/end already lives in super-admin-platform
// (reason + time-limit + step-up + audit) and is reused directly by the frontend — not duplicated here.
import { sql, type Kysely } from 'kysely';
import type { SupportTicketsService } from '@aipowersalon/support';
import type { AdminCtx } from './support-overview.service';

const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export interface CreateTicketInput { tenantId?: string; branchId?: string | null; subject?: string; description?: string; category?: string; subcategory?: string; priority?: string }

export class SupportActionsService {
  constructor(private readonly tickets: SupportTicketsService, private readonly db: Kysely<any> | null) {}

  /** Cross-tenant super-admin ticket detail: meta + full conversation (support_ticket_messages) + internal timeline
   *  (support_ticket_events). Read-only; not tenant-restricted (SuperAdminGuard gates the route). */
  async ticketDetail(_ctx: AdminCtx, ticketId: string): Promise<{ ok: boolean; error?: string; ticket?: unknown; conversation?: unknown[]; events?: unknown[] }> {
    if (!this.db) return { ok: false, error: 'unavailable' };
    if (!isUuid(ticketId)) return { ok: false, error: 'invalid_id' };
    const meta = await sql<any>`
      select s.id, s.ticket_number, s.tenant_id, tn.display_name as tenant, s.branch_id, s.subject, s.description, s.category,
             s.priority, s.status, s.assigned_agent, s.response_target_minutes, s.csat_score, s.created_at, s.updated_at
      from support_tickets s left join tenants tn on tn.id = s.tenant_id where s.id = ${ticketId} limit 1`.execute(this.db);
    const t = meta.rows[0];
    if (!t) return { ok: false, error: 'not_found' };
    const msgs = await sql<any>`select id, author_kind, body, created_at from support_ticket_messages where ticket_id = ${ticketId} order by created_at asc limit 200`.execute(this.db);
    const evs = await sql<any>`select id, kind, detail, created_at from support_ticket_events where ticket_id = ${ticketId} order by created_at desc limit 50`.execute(this.db);
    return {
      ok: true,
      ticket: { id: String(t.id), ticketNumber: t.ticket_number, tenant: t.tenant ?? null, tenantId: String(t.tenant_id), subject: t.subject, description: t.description, category: t.category, priority: t.priority, status: t.status, assignedAgent: t.assigned_agent ?? null, csatScore: t.csat_score ?? null, createdAt: new Date(t.created_at).toISOString(), updatedAt: new Date(t.updated_at).toISOString() },
      conversation: msgs.rows.map((m: any) => ({ id: String(m.id), authorKind: m.author_kind, body: m.body, createdAt: new Date(m.created_at).toISOString() })),
      events: evs.rows.map((e: any) => ({ id: String(e.id), kind: e.kind, detail: e.detail, createdAt: new Date(e.created_at).toISOString() })),
    };
  }

  private async ticketTenant(ticketId: string): Promise<string | null> {
    if (!this.db || !isUuid(ticketId)) return null;
    const r = await sql<any>`select tenant_id from support_tickets where id = ${ticketId} limit 1`.execute(this.db);
    return r.rows[0]?.tenant_id ? String(r.rows[0].tenant_id) : null;
  }

  /** Super-admin reply — recorded as an 'agent' message, tenant-scoped via the ticket's own tenant. */
  async reply(ctx: AdminCtx, ticketId: string, body: string): Promise<{ ok: boolean; error?: string }> {
    const tenantId = await this.ticketTenant(ticketId);
    if (!tenantId) return { ok: false, error: 'not_found' };
    return this.tickets.replyTicket({ tenantId, branchId: '', userId: ctx.userId, role: 'super_admin', permissions: [] } as never, ticketId, body);
  }

  /** Super-admin status transition — validated lifecycle, tenant-scoped + event-logged by the ticket service. */
  async setStatus(ctx: AdminCtx, ticketId: string, to: string, note?: string): Promise<{ ok: boolean; error?: string }> {
    const tenantId = await this.ticketTenant(ticketId);
    if (!tenantId) return { ok: false, error: 'not_found' };
    return this.tickets.transitionStatus({ tenantId, branchId: '', userId: ctx.userId, role: 'super_admin', permissions: [] } as never, ticketId, to, note);
  }

  /** Add an INTERNAL note — recorded on the ticket's event timeline, never written to the tenant-visible conversation
   *  (which only reads support_ticket_messages). Structurally guarantees the spec's internal/tenant separation. */
  async addInternalNote(ctx: AdminCtx, ticketId: string, body: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.db) return { ok: false, error: 'unavailable' };
    const text = (body || '').trim();
    if (!text) return { ok: false, error: 'empty' };
    const tenantId = await this.ticketTenant(ticketId);
    if (!tenantId) return { ok: false, error: 'not_found' };
    try {
      await sql`INSERT INTO support_ticket_events (ticket_id, tenant_id, kind, detail, actor_user_id)
                VALUES (${ticketId}, ${tenantId}, 'internal_note', ${text.slice(0, 2000)}, ${ctx.userId ?? null})`.execute(this.db);
      return { ok: true };
    } catch { return { ok: false, error: 'note_failed' }; }
  }

  /** Create a support ticket for a validated tenant, delegating to the existing audited ticket creator. */
  async createTicket(ctx: AdminCtx, input: CreateTicketInput): Promise<{ ok: boolean; error?: string; ticket?: unknown }> {
    if (!isUuid(input.tenantId)) return { ok: false, error: 'tenant_required' };
    if (!String(input.subject ?? '').trim()) return { ok: false, error: 'subject_required' };
    if (input.branchId != null && !isUuid(input.branchId)) return { ok: false, error: 'invalid_branch' };
    const helpCtx = { tenantId: input.tenantId!, branchId: input.branchId ?? '', userId: ctx.userId, role: 'super_admin', permissions: [] as string[] };
    const res = await this.tickets.createTicket(helpCtx as never, {
      subject: input.subject, description: input.description, category: input.category, subcategory: input.subcategory, priority: input.priority,
    });
    if (res.ok && this.db) {
      try {
        await sql`INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                  VALUES (${input.tenantId}, ${isUuid(input.branchId) ? input.branchId : null}, ${ctx.userId ?? null}, 'super_admin', 'support_ticket.create', 'support_ticket', ${res.ticket?.id ?? null}, ${JSON.stringify({ category: input.category ?? 'general', priority: input.priority ?? 'normal', via: 'support_center' })}::jsonb)`.execute(this.db);
      } catch { /* best-effort */ }
    }
    return res;
  }
}
