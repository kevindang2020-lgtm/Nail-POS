// support-tickets.service.ts — the support ticket system (spec §20–21, §38, §41). Tenant/user scoped: ordinary
// users see only their own tickets; owners/managers see the whole tenant. Creation is idempotent (a client key
// dedupes double-submits) and "critical" priority from a non-privileged role is downgraded + flagged for review
// (§20). Raw SQL, fail-soft. Pure validation/scoping helpers are exported for DB-free testing.
import { sql, type Kysely } from 'kysely';
import { InvalidStateTransitionError, transitionStatus, type DB } from '@aipowersalon/database';
import { SUPPORT_TICKET } from './support-ticket-lifecycle';
import type { HelpCtx } from './help.service';
import { hasPermission, isPlatformPrincipal } from '@aipowersalon/permissions';

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent', 'critical'] as const;
export type TicketPriority = typeof TICKET_PRIORITIES[number];

export const TICKET_CATEGORIES = [
  'general', 'getting_started', 'booking', 'check_in', 'queue', 'serving', 'checkout', 'payment', 'refund',
  'payroll', 'customer', 'team', 'inventory', 'reports', 'ai_receptionist', 'communications', 'marketing',
  'device', 'integration', 'account', 'billing', 'security', 'bug', 'feature_request', 'other',
] as const;

// BUILD_PLAN Phase 9 (Constitution 2 §148): was PRIVILEGED = new Set(['owner', 'manager', 'admin', 'super_admin']) —
// role NAMES. The salon's ticket administrators are now the holders of help.triage (owners and managers by default; a
// template or a DENY narrows it like any other key) and platform support keeps its plane.
export interface TicketPrincipal { role: string; permissions?: readonly string[] }
const TICKET_ADMIN_PERM = 'help.triage';
function isTicketAdmin(p: TicketPrincipal): boolean {
  if (isPlatformPrincipal(p)) return true;
  return hasPermission({ tenantId: '', branchId: '', userId: '', role: p.role as any, permissions: [...(p.permissions ?? [])] }, TICKET_ADMIN_PERM);
}

export function isValidPriority(p: string): p is TicketPriority { return (TICKET_PRIORITIES as readonly string[]).includes(p); }
export function isValidCategory(c: string): boolean { return (TICKET_CATEGORIES as readonly string[]).includes(c); }

/** Owners/managers see all tenant tickets; everyone else sees only the tickets they created. Never cross-tenant. */
export function canSeeAllTenantTickets(p: TicketPrincipal): boolean { return isTicketAdmin(p); }

/** §20: only privileged roles may file a platform-wide "critical" outage; ordinary users are downgraded to
 * "urgent" and the ticket is flagged for review rather than trusting the classification. */
export function clampPriorityForRole(priority: string, principal: TicketPrincipal): { priority: TicketPriority; needsReview: boolean } {
  const p: TicketPriority = isValidPriority(priority) ? priority : 'normal';
  if (p === 'critical' && !isTicketAdmin(principal)) return { priority: 'urgent', needsReview: true };
  return { priority: p, needsReview: false };
}

/** Human-friendly ticket reference like "SUP-AB12CD" derived from a seed. */
export function formatTicketNumber(seed: string | number): string {
  const s = String(seed).replace(/[^a-z0-9]/gi, '').toUpperCase();
  return 'SUP-' + s.slice(-6).padStart(6, '0');
}

export const TICKET_STATUSES = ['draft', 'submitted', 'open', 'assigned', 'waiting_support', 'waiting_customer', 'in_progress', 'escalated', 'resolved', 'closed', 'reopened', 'canceled'] as const;
export type TicketStatus = typeof TICKET_STATUSES[number];

/** Only privileged roles may triage tickets (status, assignment, priority). Non-privileged users may only reply. */
export function canTriageTickets(p: TicketPrincipal): boolean { return isTicketAdmin(p); }

// Allowed status transitions for triage: the support_ticket state machine (support-ticket-lifecycle.ts — BUILD_PLAN
// Phase 12 #27). Keeps the lifecycle sane (e.g. you can't jump a closed ticket straight to in_progress without
// reopening it). A no-op (from === to) is rejected.
export function isValidStatus(s: string): s is TicketStatus { return (TICKET_STATUSES as readonly string[]).includes(s); }
export function isValidTransition(from: string, to: string): boolean {
  if (!isValidStatus(to) || from === to) return false;
  return SUPPORT_TICKET.can(from, to);
}
export function nextStatuses(from: string): TicketStatus[] { return [...((SUPPORT_TICKET.transitions as Record<string, readonly TicketStatus[] | undefined>)[from] ?? [])]; }

// First-response SLA targets (minutes) by priority. Set on creation; surfaced read-only on list/detail.
export const SLA_TARGET_MINUTES: Record<string, number> = { critical: 30, urgent: 60, high: 240, normal: 480, low: 1440 };
export function slaTargetForPriority(priority: string): number { return SLA_TARGET_MINUTES[priority] ?? SLA_TARGET_MINUTES.normal; }

export type SlaState = 'on_track' | 'due_soon' | 'breached' | 'responded' | 'paused';
export type SlaInfo = { targetMinutes: number; dueAt: string | null; firstResponseAt: string | null; responded: boolean; breached: boolean; minutesRemaining: number | null; state: SlaState };

const TERMINAL_STATUSES = new Set(['resolved', 'closed', 'canceled']);

/** Pure first-response SLA: dueAt = created + target. Responded once an agent has replied (breached if that reply
 * landed late). Terminal/un-replied tickets are 'paused' (no breach pressure). Otherwise on_track / due_soon /
 * breached vs now (injectable for testing). */
export function computeSla(args: { createdAt: string | null; targetMinutes: number | null; firstAgentResponseAt: string | null; status: string; now?: number }): SlaInfo {
  const target = args.targetMinutes && args.targetMinutes > 0 ? args.targetMinutes : slaTargetForPriority('normal');
  const created = args.createdAt ? Date.parse(args.createdAt) : NaN;
  const dueMs = Number.isFinite(created) ? created + target * 60000 : NaN;
  const dueAt = Number.isFinite(dueMs) ? new Date(dueMs).toISOString() : null;
  const now = args.now ?? Date.now();

  if (args.firstAgentResponseAt) {
    const fr = Date.parse(args.firstAgentResponseAt);
    const breached = Number.isFinite(dueMs) && Number.isFinite(fr) ? fr > dueMs : false;
    return { targetMinutes: target, dueAt, firstResponseAt: args.firstAgentResponseAt, responded: true, breached, minutesRemaining: null, state: 'responded' };
  }
  if (TERMINAL_STATUSES.has(args.status)) {
    return { targetMinutes: target, dueAt, firstResponseAt: null, responded: false, breached: false, minutesRemaining: null, state: 'paused' };
  }
  if (!Number.isFinite(dueMs)) return { targetMinutes: target, dueAt: null, firstResponseAt: null, responded: false, breached: false, minutesRemaining: null, state: 'on_track' };
  const remaining = Math.round((dueMs - now) / 60000);
  const breached = now > dueMs;
  const dueSoon = !breached && remaining <= Math.max(30, Math.round(target * 0.25));
  return { targetMinutes: target, dueAt, firstResponseAt: null, responded: false, breached, minutesRemaining: remaining, state: breached ? 'breached' : dueSoon ? 'due_soon' : 'on_track' };
}

export type TicketStats = {
  total: number; open: number; unassigned: number; awaitingFirstResponse: number; breached: number;
  byStatus: Record<string, number>; byPriority: Record<string, number>;
};
type StatRow = { status: string; priority: string; assignedAgent: string | null; createdAt: string | null; targetMinutes: number | null; firstAgentResponseAt: string | null };

/** Pure queue summary over ticket rows (open = non-terminal; unassigned/awaiting only count open tickets; breached
 * reuses the read-time SLA so it matches the per-ticket badge). */
export function summarizeTicketRows(rows: StatRow[], now: number = Date.now()): TicketStats {
  const byStatus: Record<string, number> = {}; const byPriority: Record<string, number> = {};
  let open = 0, unassigned = 0, awaitingFirstResponse = 0, breached = 0;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    byPriority[r.priority] = (byPriority[r.priority] || 0) + 1;
    const terminal = TERMINAL_STATUSES.has(r.status);
    if (!terminal) open++;
    if (!terminal && !r.assignedAgent) unassigned++;
    if (!terminal && !r.firstAgentResponseAt) awaitingFirstResponse++;
    if (computeSla({ createdAt: r.createdAt, targetMinutes: r.targetMinutes, firstAgentResponseAt: r.firstAgentResponseAt, status: r.status, now }).state === 'breached') breached++;
  }
  return { total: rows.length, open, unassigned, awaitingFirstResponse, breached, byStatus, byPriority };
}

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
/** Pure CSV (RFC-4180-ish): header + one row per ticket, fields quoted/escaped when they contain commas, quotes,
 * or newlines. CRLF line endings. */
export function ticketsToCsv(tickets: TicketSummary[]): string {
  const header = ['Ticket', 'Subject', 'Category', 'Priority', 'Status', 'SLA', 'Created', 'Updated'];
  const lines = [header.join(',')];
  for (const t of tickets) {
    lines.push([t.ticketNumber, t.subject, t.category, t.priority, t.status, t.sla?.state ?? '', t.createdAt ?? '', t.updatedAt ?? ''].map(csvCell).join(','));
  }
  return lines.join('\r\n');
}

/** Pure: build the notification a triager sends to the customer about a ticket. Defaults to a status update;
 * coerces channel to a valid value. The send itself goes through the metered NotificationsService. */
export function buildTicketNotification(ticketNumber: string, status: string, channelRaw?: string, bodyRaw?: string): { channel: 'sms' | 'email'; subject: string; body: string } {
  const channel: 'sms' | 'email' = channelRaw === 'sms' ? 'sms' : 'email';
  const body = (bodyRaw || '').trim() || `Update on your support ticket ${ticketNumber}: the status is now ${status.replace(/_/g, ' ')}.`;
  return { channel, subject: `Support ticket ${ticketNumber}`, body };
}

export interface TicketInput {
  subject?: string; description?: string; category?: string; subcategory?: string; priority?: string;
  affectedModule?: string; appVersion?: string; idempotencyKey?: string;
}
type CleanTicket = {
  subject: string; description: string | null; category: string; subcategory: string | null;
  priority: string; affectedModule: string | null; appVersion: string | null; idempotencyKey: string | null;
};
/** Validate + normalize ticket input. Subject is required; strings are trimmed and length-capped. */
export function sanitizeTicketInput(raw: TicketInput): { ok: boolean; error?: string; value?: CleanTicket } {
  const subject = (raw.subject || '').trim();
  if (!subject) return { ok: false, error: 'subject_required' };
  return {
    ok: true,
    value: {
      subject: subject.slice(0, 200),
      description: (raw.description || '').trim().slice(0, 5000) || null,
      category: raw.category && isValidCategory(raw.category) ? raw.category : 'general',
      subcategory: (raw.subcategory || '').trim().slice(0, 120) || null,
      priority: raw.priority && isValidPriority(raw.priority) ? raw.priority : 'normal',
      affectedModule: (raw.affectedModule || '').trim().slice(0, 120) || null,
      appVersion: (raw.appVersion || '').trim().slice(0, 40) || null,
      idempotencyKey: (raw.idempotencyKey || '').trim().slice(0, 120) || null,
    },
  };
}

export type TicketSummary = {
  id: string; ticketNumber: string; subject: string; category: string; priority: string; status: string;
  needsReview: boolean; createdAt: string | null; updatedAt: string | null; sla: SlaInfo;
};
export type TicketMessage = { id: string; authorKind: string; body: string; createdAt: string | null; mine: boolean };
export type TicketEvent = { id: string; kind: string; detail: string | null; createdAt: string | null };
export type TicketDetail = TicketSummary & {
  description: string | null; affectedModule: string | null; appVersion: string | null; assignedAgent: string | null;
  messages: TicketMessage[]; events: TicketEvent[]; canTriage: boolean; nextStatuses: string[];
};

function iso(v: any): string | null { return v ? new Date(v).toISOString() : null; }
function toSummary(x: any): TicketSummary {
  const createdAt = iso(x.created_at);
  return {
    id: x.id, ticketNumber: x.ticket_number, subject: x.subject, category: x.category, priority: x.priority,
    status: x.status, needsReview: !!x.needs_review, createdAt, updatedAt: iso(x.updated_at),
    sla: computeSla({ createdAt, targetMinutes: x.response_target_minutes ?? null, firstAgentResponseAt: iso(x.first_agent_at), status: x.status }),
  };
}

export class SupportTicketsService {
  constructor(private readonly db: Kysely<DB> | null) {}

  private async query<T>(text: ReturnType<typeof sql>): Promise<T[]> {
    if (!this.db) return [];
    try { const r = await text.execute(this.db); return ((r as any).rows || []) as T[]; }
    catch { return []; }
  }

  async createTicket(ctx: HelpCtx, raw: TicketInput): Promise<{ ok: boolean; error?: string; ticket?: TicketSummary }> {
    if (!ctx.userId || !ctx.tenantId) return { ok: false, error: 'unauthenticated' };
    if (!this.db) return { ok: false, error: 'unavailable' };
    const s = sanitizeTicketInput(raw);
    if (!s.ok || !s.value) return { ok: false, error: s.error };
    const v = s.value;
    const { priority, needsReview } = clampPriorityForRole(v.priority, ctx);

    // Idempotency: a prior ticket with this key is returned as-is rather than duplicated (§41).
    if (v.idempotencyKey) {
      const existing = await this.query<any>(sql`SELECT * FROM support_tickets WHERE tenant_id = ${ctx.tenantId} AND idempotency_key = ${v.idempotencyKey} LIMIT 1`);
      if (existing[0]) return { ok: true, ticket: toSummary(existing[0]) };
    }
    const number = formatTicketNumber(Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    try {
      const rows = await this.query<any>(sql`
        INSERT INTO support_tickets (ticket_number, tenant_id, branch_id, created_by_user_id, subject, description,
          category, subcategory, priority, status, affected_module, app_version, needs_review, idempotency_key, response_target_minutes)
        VALUES (${number}, ${ctx.tenantId}, ${ctx.branchId || null}, ${ctx.userId}, ${v.subject}, ${v.description},
          ${v.category}, ${v.subcategory}, ${priority}, 'submitted', ${v.affectedModule}, ${v.appVersion}, ${needsReview}, ${v.idempotencyKey}, ${slaTargetForPriority(priority)})
        RETURNING *`);
      let ticket = rows[0];
      if (!ticket && v.idempotencyKey) {
        const ex = await this.query<any>(sql`SELECT * FROM support_tickets WHERE tenant_id = ${ctx.tenantId} AND idempotency_key = ${v.idempotencyKey} LIMIT 1`);
        ticket = ex[0];
      }
      if (!ticket) return { ok: false, error: 'create_failed' };
      if (v.description) {
        await sql`INSERT INTO support_ticket_messages (ticket_id, tenant_id, author_user_id, author_kind, body)
                  VALUES (${ticket.id}, ${ctx.tenantId}, ${ctx.userId}, 'customer', ${v.description})`.execute(this.db);
      }
      await sql`INSERT INTO support_ticket_events (ticket_id, tenant_id, kind, detail, actor_user_id)
                VALUES (${ticket.id}, ${ctx.tenantId}, 'created', ${'priority=' + priority}, ${ctx.userId})`.execute(this.db);
      return { ok: true, ticket: toSummary(ticket) };
    } catch { return { ok: false, error: 'create_failed' }; }
  }

  /** Role-scoped ticket list: own tickets, or the whole tenant for owners/managers. Never cross-tenant. */
  async listTickets(ctx: HelpCtx): Promise<TicketSummary[]> {
    if (!ctx.tenantId) return [];
    const all = canSeeAllTenantTickets(ctx);
    const rows = await this.query<any>(sql`
      SELECT *, (SELECT min(created_at) FROM support_ticket_messages m WHERE m.ticket_id = support_tickets.id AND m.author_kind = 'agent') AS first_agent_at
      FROM support_tickets
      WHERE tenant_id = ${ctx.tenantId} ${all ? sql`` : sql`AND created_by_user_id = ${ctx.userId ?? null}`}
      ORDER BY created_at DESC LIMIT 100`);
    return rows.map(toSummary);
  }

  /** Queue summary (role-scoped like the list). Over the most recent 500 tickets — ample for a salon tenant. */
  async ticketStats(ctx: HelpCtx): Promise<TicketStats> {
    const empty: TicketStats = { total: 0, open: 0, unassigned: 0, awaitingFirstResponse: 0, breached: 0, byStatus: {}, byPriority: {} };
    if (!ctx.tenantId) return empty;
    const all = canSeeAllTenantTickets(ctx);
    const rows = await this.query<any>(sql`
      SELECT status, priority, assigned_agent, created_at, response_target_minutes,
        (SELECT min(created_at) FROM support_ticket_messages m WHERE m.ticket_id = support_tickets.id AND m.author_kind = 'agent') AS first_agent_at
      FROM support_tickets
      WHERE tenant_id = ${ctx.tenantId} ${all ? sql`` : sql`AND created_by_user_id = ${ctx.userId ?? null}`}
      ORDER BY created_at DESC LIMIT 500`);
    return summarizeTicketRows(rows.map((r) => ({ status: r.status, priority: r.priority, assignedAgent: r.assigned_agent ?? null, createdAt: iso(r.created_at), targetMinutes: r.response_target_minutes ?? null, firstAgentResponseAt: iso(r.first_agent_at) })));
  }

  /** CSV export of the caller's visible tickets (role-scoped via listTickets). */
  async exportTickets(ctx: HelpCtx): Promise<{ filename: string; csv: string }> {
    const tickets = await this.listTickets(ctx);
    const stamp = new Date().toISOString().slice(0, 10);
    return { filename: `support-tickets-${stamp}.csv`, csv: ticketsToCsv(tickets) };
  }
  async getTicket(ctx: HelpCtx, id: string): Promise<TicketDetail | null> {
    if (!ctx.tenantId) return null;
    const rows = await this.query<any>(sql`
      SELECT *, (SELECT min(created_at) FROM support_ticket_messages m WHERE m.ticket_id = support_tickets.id AND m.author_kind = 'agent') AS first_agent_at
      FROM support_tickets WHERE tenant_id = ${ctx.tenantId} AND id = ${id} LIMIT 1`);
    const t = rows[0];
    if (!t) return null;
    if (!canSeeAllTenantTickets(ctx) && t.created_by_user_id !== ctx.userId) return null;
    const msgs = await this.query<any>(sql`
      SELECT id, author_kind, author_user_id, body, created_at
      FROM support_ticket_messages WHERE ticket_id = ${id} ORDER BY created_at ASC`);
    const evs = await this.query<any>(sql`
      SELECT id, kind, detail, created_at FROM support_ticket_events WHERE ticket_id = ${id} ORDER BY created_at ASC`);
    const canTriage = canTriageTickets(ctx);
    return {
      ...toSummary(t), description: t.description ?? null, affectedModule: t.affected_module ?? null,
      appVersion: t.app_version ?? null, assignedAgent: t.assigned_agent ?? null,
      messages: msgs.map((m) => ({ id: m.id, authorKind: m.author_kind, body: m.body, createdAt: iso(m.created_at), mine: m.author_user_id === ctx.userId })),
      events: evs.map((e) => ({ id: e.id, kind: e.kind, detail: e.detail ?? null, createdAt: iso(e.created_at) })),
      canTriage, nextStatuses: canTriage ? (nextStatuses(t.status) as string[]) : [],
    };
  }

  /** Append a reply to a ticket the caller can view. Privileged repliers are recorded as 'agent'. */
  async replyTicket(ctx: HelpCtx, id: string, body: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.db || !ctx.userId || !ctx.tenantId) return { ok: false, error: 'unauthenticated' };
    const text = (body || '').trim();
    if (!text) return { ok: false, error: 'empty' };
    const ticket = await this.getTicket(ctx, id);
    if (!ticket) return { ok: false, error: 'not_found' };
    const authorKind = canTriageTickets(ctx) ? 'agent' : 'customer';
    try {
      await sql`INSERT INTO support_ticket_messages (ticket_id, tenant_id, author_user_id, author_kind, body)
                VALUES (${id}, ${ctx.tenantId}, ${ctx.userId}, ${authorKind}, ${text.slice(0, 5000)})`.execute(this.db);
      await sql`UPDATE support_tickets SET updated_at = now() WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.db);
      return { ok: true };
    } catch { return { ok: false, error: 'reply_failed' }; }
  }

  /** Submit a satisfaction rating (1–5) for a resolved/closed ticket the caller owns. Rated once; never overwritten. */
  async submitCsat(ctx: HelpCtx, id: string, score: number, comment?: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.db || !ctx.userId || !ctx.tenantId) return { ok: false, error: 'unauthenticated' };
    const s = Math.trunc(Number(score));
    if (!Number.isFinite(s) || s < 1 || s > 5) return { ok: false, error: 'invalid_score' };
    const rows = await this.query<any>(sql`SELECT status, csat_score FROM support_tickets WHERE tenant_id = ${ctx.tenantId} AND id = ${id} LIMIT 1`);
    const cur = rows[0];
    if (!cur) return { ok: false, error: 'not_found' };
    if (!['resolved', 'closed'].includes(cur.status)) return { ok: false, error: 'not_resolved' };
    if (cur.csat_score != null) return { ok: false, error: 'already_rated' };
    try {
      await sql`UPDATE support_tickets SET csat_score = ${s}, csat_comment = ${(comment || '').trim().slice(0, 1000) || null}, csat_submitted_at = now(), updated_at = now()
                WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND csat_score IS NULL`.execute(this.db);
      await sql`INSERT INTO support_ticket_events (ticket_id, tenant_id, kind, detail, actor_user_id)
                VALUES (${id}, ${ctx.tenantId}, 'csat_submitted', ${'score=' + s}, ${ctx.userId})`.execute(this.db);
      return { ok: true };
    } catch { return { ok: false, error: 'csat_failed' }; }
  }

  /** Triage: move a ticket along the allowed lifecycle. Privileged roles only; every change is audited. */
  async transitionStatus(ctx: HelpCtx, id: string, to: string, note?: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.db || !ctx.userId || !ctx.tenantId) return { ok: false, error: 'unauthenticated' };
    if (!canTriageTickets(ctx)) return { ok: false, error: 'forbidden' };
    const rows = await this.query<any>(sql`SELECT status FROM support_tickets WHERE tenant_id = ${ctx.tenantId} AND id = ${id} LIMIT 1`);
    const cur = rows[0];
    if (!cur) return { ok: false, error: 'not_found' };
    if (!isValidTransition(cur.status, to)) return { ok: false, error: 'invalid_transition' };
    try {
      // conditional on the state read: a second triager who read the same state gets 'conflict', never a lost update
      await transitionStatus(this.db, SUPPORT_TICKET, { where: { id, tenant_id: ctx.tenantId }, from: cur.status, to: to as TicketStatus, set: { updated_at: sql`now()` } });
      await sql`INSERT INTO support_ticket_events (ticket_id, tenant_id, kind, detail, actor_user_id)
                VALUES (${id}, ${ctx.tenantId}, 'status_changed', ${`${cur.status} → ${to}${note ? `: ${String(note).slice(0, 300)}` : ''}`}, ${ctx.userId})`.execute(this.db);
      return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof InvalidStateTransitionError ? 'conflict' : 'update_failed' }; }
  }

  /** Triage: assign a ticket to an agent (free-text agent label). Privileged roles only; audited. */
  async assignTicket(ctx: HelpCtx, id: string, agent: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.db || !ctx.userId || !ctx.tenantId) return { ok: false, error: 'unauthenticated' };
    if (!canTriageTickets(ctx)) return { ok: false, error: 'forbidden' };
    const name = (agent || '').trim().slice(0, 120);
    if (!name) return { ok: false, error: 'empty' };
    const rows = await this.query<any>(sql`SELECT id, status FROM support_tickets WHERE tenant_id = ${ctx.tenantId} AND id = ${id} LIMIT 1`);
    const cur = rows[0];
    if (!cur) return { ok: false, error: 'not_found' };
    try {
      // assigning an unassigned 'submitted'/'open' ticket also moves it to 'assigned' when that transition is valid
      const moveToAssigned = isValidTransition(cur.status, 'assigned');
      if (moveToAssigned) await transitionStatus(this.db, SUPPORT_TICKET, { where: { id, tenant_id: ctx.tenantId }, from: cur.status, to: 'assigned', set: { assigned_agent: name, updated_at: sql`now()` } });
      else await sql`UPDATE support_tickets SET assigned_agent = ${name}, updated_at = now() WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.db);
      await sql`INSERT INTO support_ticket_events (ticket_id, tenant_id, kind, detail, actor_user_id)
                VALUES (${id}, ${ctx.tenantId}, 'assigned', ${`assigned to ${name}`}, ${ctx.userId})`.execute(this.db);
      return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof InvalidStateTransitionError ? 'conflict' : 'update_failed' }; }
  }

  /** Triage: change priority. Privileged roles only; clears the needs-review flag; audited. */
  async setPriority(ctx: HelpCtx, id: string, priority: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.db || !ctx.userId || !ctx.tenantId) return { ok: false, error: 'unauthenticated' };
    if (!canTriageTickets(ctx)) return { ok: false, error: 'forbidden' };
    if (!isValidPriority(priority)) return { ok: false, error: 'invalid_priority' };
    const rows = await this.query<any>(sql`SELECT priority FROM support_tickets WHERE tenant_id = ${ctx.tenantId} AND id = ${id} LIMIT 1`);
    const cur = rows[0];
    if (!cur) return { ok: false, error: 'not_found' };
    try {
      await sql`UPDATE support_tickets SET priority = ${priority}, needs_review = false, updated_at = now() WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.db);
      await sql`INSERT INTO support_ticket_events (ticket_id, tenant_id, kind, detail, actor_user_id)
                VALUES (${id}, ${ctx.tenantId}, 'priority_changed', ${`${cur.priority} → ${priority}`}, ${ctx.userId})`.execute(this.db);
      return { ok: true };
    } catch { return { ok: false, error: 'update_failed' }; }
  }

  /** Append a system note + audit event (used after an out-of-band action like notifying the customer). */
  async recordSystemNote(ctx: HelpCtx, id: string, note: string): Promise<void> {
    if (!this.db || !ctx.tenantId) return;
    const text = (note || '').trim().slice(0, 500);
    if (!text) return;
    try {
      const rows = await this.query<any>(sql`SELECT id FROM support_tickets WHERE tenant_id = ${ctx.tenantId} AND id = ${id} LIMIT 1`);
      if (!rows[0]) return;
      await sql`INSERT INTO support_ticket_messages (ticket_id, tenant_id, author_user_id, author_kind, body)
                VALUES (${id}, ${ctx.tenantId}, ${ctx.userId ?? null}, 'system', ${text})`.execute(this.db);
      await sql`INSERT INTO support_ticket_events (ticket_id, tenant_id, kind, detail, actor_user_id)
                VALUES (${id}, ${ctx.tenantId}, 'notified', ${text}, ${ctx.userId})`.execute(this.db);
    } catch { /* best-effort */ }
  }
}
