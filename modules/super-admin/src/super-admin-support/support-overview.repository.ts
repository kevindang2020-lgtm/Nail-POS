// support-overview.repository.ts — READ-ONLY aggregates for the Support Center dashboard over the real support_tickets /
// support_access_sessions / help_articles tables, joined to tenants/branches. Tenant-scoped via the shared helper.
// Returns raw rows + counts; SLA/session status is DERIVED in the service via support-center-core so there is one
// source of truth. Unmodeled fields (CSAT, actual first-response time, session access level) are simply not selected.
import { type DB, tenantPred, type OverviewScope } from '@aipowersalon/database';
import { Kysely, sql } from 'kysely';

const ACTIVE = sql`status in ('submitted','open','assigned','waiting_support','waiting_customer','in_progress','escalated','reopened')`;
const ACTIVE_S = sql`s.status in ('submitted','open','assigned','waiting_support','waiting_customer','in_progress','escalated','reopened')`;

export interface SupportOverviewData {
  kpis: { openTickets: number; urgentTickets: number; assignedTickets: number; waitingForCustomer: number; resolvedToday: number; auditedSessions: number; sessionsStartedToday: number; newToday: number; knowledgeArticles: number };
  avgFirstResponseMin: number | null;
  ticketCsat: number | null;
  slaRows: { status: string; responseTargetMinutes: number | null; createdAtMs: number }[];
  priorityCounts: { key: string; count: number }[];
  volumeTrend: { day: string; count: number }[];
  agentPerformance: { agent: string; assigned: number; resolved: number; csat: number | null }[];
  queue: { id: string; ticketNumber: string; tenant: string | null; branch: string | null; category: string; priority: string; assignedTo: string | null; status: string; responseTargetMinutes: number | null; createdAtMs: number; lastUpdate: string }[];
  urgentIncidents: { id: string; subject: string; tenant: string | null; priority: string; createdAt: string }[];
  resolvedTodayRows: { id: string; ticketNumber: string; tenant: string | null; resolvedAt: string }[];
  waitingRows: { id: string; ticketNumber: string; tenant: string | null; waitingSince: string }[];
  escalatedRows: { id: string; ticketNumber: string; tenant: string | null; escalatedTo: string | null }[];
  sessions: { id: string; tenant: string | null; reason: string; startedAtMs: number; expiresAtMs: number; endedAtMs: number | null; startedBy: string | null }[];
  knowledgeBase: { id: string; title: string; status: string; updated: string }[];
}

export interface SupportQueueFilters { category?: string; priority?: string; agent?: string; dateFrom?: string; dateTo?: string }

const n = (v: unknown): number => (v == null ? 0 : Number(v) || 0);
const ms = (v: unknown): number => (v == null ? 0 : new Date(v as string).getTime());

export class SupportOverviewRepository {
  constructor(private readonly db: Kysely<DB> | null) {}

  async overviewData(scope?: OverviewScope, filters?: SupportQueueFilters): Promise<SupportOverviewData> {
    if (!this.db) return EMPTY;
    const t = tenantPred(scope);
    // Queue-only filters (headline KPIs/analytics stay at scope totals). Priority validated against the vocab; safe binds.
    const f = filters ?? {};
    const qCat = f.category ? sql`and s.category = ${f.category}` : sql``;
    const qPrio = f.priority && ['critical', 'urgent', 'high', 'normal', 'low'].includes(f.priority) ? sql`and s.priority = ${f.priority}` : sql``;
    const qAgent = f.agent ? sql`and s.assigned_agent = ${f.agent}` : sql``;
    const qFrom = f.dateFrom ? sql`and s.created_at >= ${f.dateFrom}::timestamptz` : sql``;
    const qTo = f.dateTo ? sql`and s.created_at <= ${f.dateTo}::timestamptz` : sql``;

    const kpiP = sql<any>`
      select
        count(*) filter (where ${ACTIVE})::int as open_tickets,
        count(*) filter (where ${ACTIVE} and priority in ('critical','urgent','high'))::int as urgent_tickets,
        count(*) filter (where ${ACTIVE} and assigned_agent is not null)::int as assigned_tickets,
        count(*) filter (where status = 'waiting_customer')::int as waiting_for_customer,
        count(*) filter (where status = 'resolved' and updated_at >= date_trunc('day', now()))::int as resolved_today,
        count(*) filter (where created_at >= date_trunc('day', now()))::int as new_today
      from support_tickets where ${t}`.execute(this.db);

    const sessP = sql<any>`
      select count(*)::int as total, count(*) filter (where started_at >= date_trunc('day', now()))::int as today
      from support_access_sessions where ${t}`.execute(this.db);

    const kbCountP = sql<any>`select count(*)::int c from help_articles where status = 'published'`.execute(this.db);

    // Real avg first-response (minutes): time from ticket creation to its first 'agent' message. Null if no agent replies.
    const frP = sql<any>`
      select avg(extract(epoch from (fa.first_agent_at - s.created_at)) / 60) as avg_min
      from support_tickets s
      join lateral (select min(created_at) as first_agent_at from support_ticket_messages m where m.ticket_id = s.id and m.author_kind = 'agent') fa on true
      where fa.first_agent_at is not null and fa.first_agent_at >= s.created_at and ${tenantPred(scope, 's.tenant_id')}`.execute(this.db);

    const csatP = sql<any>`select avg(csat_score)::numeric as avg_csat from support_tickets where csat_score is not null and ${t}`.execute(this.db);

    const slaP = sql<any>`select status, response_target_minutes, created_at from support_tickets where ${ACTIVE} and ${t} limit 5000`.execute(this.db);
    const prioP = sql<any>`select priority as key, count(*)::int as count from support_tickets where ${ACTIVE} and ${t} group by 1`.execute(this.db);
    const trendP = sql<any>`select to_char(date_trunc('day', created_at),'YYYY-MM-DD') as day, count(*)::int as count from support_tickets where created_at >= now() - interval '7 days' and ${t} group by 1 order by 1`.execute(this.db);
    const agentP = sql<any>`
      select assigned_agent as agent,
             count(*) filter (where ${ACTIVE})::int as assigned,
             count(*) filter (where status in ('resolved','closed'))::int as resolved,
             avg(csat_score) filter (where csat_score is not null) as csat
      from support_tickets where assigned_agent is not null and ${t} group by 1 order by assigned desc, resolved desc limit 6`.execute(this.db);

    const queueP = sql<any>`
      select s.id, s.ticket_number, tn.display_name as tenant, b.name as branch, s.category, s.priority, s.assigned_agent as assigned_to, s.status, s.response_target_minutes, s.created_at, s.updated_at
      from support_tickets s left join tenants tn on tn.id = s.tenant_id left join branches b on b.id = s.branch_id
      where ${ACTIVE_S} and ${tenantPred(scope, 's.tenant_id')} ${qCat} ${qPrio} ${qAgent} ${qFrom} ${qTo}
      order by (s.priority = 'critical') desc, (s.priority = 'urgent') desc, s.updated_at desc limit 100`.execute(this.db);

    const urgentP = sql<any>`
      select s.id, s.subject, tn.display_name as tenant, s.priority, s.created_at
      from support_tickets s left join tenants tn on tn.id = s.tenant_id
      where ${ACTIVE_S} and s.priority in ('critical','urgent','high') and ${tenantPred(scope, 's.tenant_id')}
      order by (s.priority='critical') desc, s.created_at asc limit 6`.execute(this.db);

    const resolvedP = sql<any>`
      select s.id, s.ticket_number, tn.display_name as tenant, s.updated_at as resolved_at
      from support_tickets s left join tenants tn on tn.id = s.tenant_id
      where s.status = 'resolved' and s.updated_at >= date_trunc('day', now()) and ${tenantPred(scope, 's.tenant_id')}
      order by s.updated_at desc limit 12`.execute(this.db);

    const waitingP = sql<any>`
      select s.id, s.ticket_number, tn.display_name as tenant, s.updated_at as waiting_since
      from support_tickets s left join tenants tn on tn.id = s.tenant_id
      where s.status = 'waiting_customer' and ${tenantPred(scope, 's.tenant_id')}
      order by s.updated_at asc limit 12`.execute(this.db);

    const escalatedP = sql<any>`
      select s.id, s.ticket_number, tn.display_name as tenant, s.assigned_agent as escalated_to
      from support_tickets s left join tenants tn on tn.id = s.tenant_id
      where s.status = 'escalated' and ${tenantPred(scope, 's.tenant_id')}
      order by s.updated_at desc limit 12`.execute(this.db);

    const sessionsP = sql<any>`
      select se.id, tn.display_name as tenant, se.reason, se.started_at, se.expires_at, se.ended_at, se.admin_email as started_by
      from support_access_sessions se left join tenants tn on tn.id = se.tenant_id
      where ${tenantPred(scope, 'se.tenant_id')}
      order by se.started_at desc limit 12`.execute(this.db);

    const kbP = sql<any>`select id, title, status, coalesce(last_updated_at, created_at) as updated from help_articles order by coalesce(last_updated_at, created_at) desc limit 12`.execute(this.db);

    const [kpi, sess, kb, fr, sla, prio, trend, agent, queue, urgent, resolved, waiting, escalated, sessions, kbRows] =
      await Promise.all([kpiP, sessP, kbCountP, frP, slaP, prioP, trendP, agentP, queueP, urgentP, resolvedP, waitingP, escalatedP, sessionsP, kbP]);
    const csat = await csatP;
    const k0 = kpi.rows[0] ?? {};

    return {
      kpis: { openTickets: n(k0.open_tickets), urgentTickets: n(k0.urgent_tickets), assignedTickets: n(k0.assigned_tickets), waitingForCustomer: n(k0.waiting_for_customer), resolvedToday: n(k0.resolved_today), auditedSessions: n(sess.rows[0]?.total), sessionsStartedToday: n(sess.rows[0]?.today), newToday: n(k0.new_today), knowledgeArticles: n(kb.rows[0]?.c) },
      avgFirstResponseMin: fr.rows[0]?.avg_min == null ? null : Math.round(Number(fr.rows[0].avg_min) * 10) / 10,
      ticketCsat: csat.rows[0]?.avg_csat == null ? null : Math.round(Number(csat.rows[0].avg_csat) * 10) / 10,
      slaRows: sla.rows.map((r: any) => ({ status: String(r.status), responseTargetMinutes: r.response_target_minutes == null ? null : n(r.response_target_minutes), createdAtMs: ms(r.created_at) })),
      priorityCounts: prio.rows.map((r: any) => ({ key: String(r.key), count: n(r.count) })),
      volumeTrend: trend.rows.map((r: any) => ({ day: String(r.day), count: n(r.count) })),
      agentPerformance: agent.rows.map((r: any) => ({ agent: String(r.agent), assigned: n(r.assigned), resolved: n(r.resolved), csat: r.csat == null ? null : Math.round(Number(r.csat) * 10) / 10 })),
      queue: queue.rows.map((r: any) => ({ id: String(r.id), ticketNumber: String(r.ticket_number), tenant: r.tenant ?? null, branch: r.branch ?? null, category: String(r.category), priority: String(r.priority), assignedTo: r.assigned_to ?? null, status: String(r.status), responseTargetMinutes: r.response_target_minutes == null ? null : n(r.response_target_minutes), createdAtMs: ms(r.created_at), lastUpdate: new Date(r.updated_at).toISOString() })),
      urgentIncidents: urgent.rows.map((r: any) => ({ id: String(r.id), subject: String(r.subject), tenant: r.tenant ?? null, priority: String(r.priority), createdAt: new Date(r.created_at).toISOString() })),
      resolvedTodayRows: resolved.rows.map((r: any) => ({ id: String(r.id), ticketNumber: String(r.ticket_number), tenant: r.tenant ?? null, resolvedAt: new Date(r.resolved_at).toISOString() })),
      waitingRows: waiting.rows.map((r: any) => ({ id: String(r.id), ticketNumber: String(r.ticket_number), tenant: r.tenant ?? null, waitingSince: new Date(r.waiting_since).toISOString() })),
      escalatedRows: escalated.rows.map((r: any) => ({ id: String(r.id), ticketNumber: String(r.ticket_number), tenant: r.tenant ?? null, escalatedTo: r.escalated_to ?? null })),
      sessions: sessions.rows.map((r: any) => ({ id: String(r.id), tenant: r.tenant ?? null, reason: String(r.reason), startedAtMs: ms(r.started_at), expiresAtMs: ms(r.expires_at), endedAtMs: r.ended_at ? ms(r.ended_at) : null, startedBy: r.started_by ?? null })),
      knowledgeBase: kbRows.rows.map((r: any) => ({ id: String(r.id), title: String(r.title), status: String(r.status), updated: new Date(r.updated).toISOString() })),
    };
  }
}

const EMPTY: SupportOverviewData = {
  kpis: { openTickets: 0, urgentTickets: 0, assignedTickets: 0, waitingForCustomer: 0, resolvedToday: 0, auditedSessions: 0, sessionsStartedToday: 0, newToday: 0, knowledgeArticles: 0 },
  avgFirstResponseMin: null, ticketCsat: null, slaRows: [], priorityCounts: [], volumeTrend: [], agentPerformance: [], queue: [], urgentIncidents: [], resolvedTodayRows: [], waitingRows: [], escalatedRows: [], sessions: [], knowledgeBase: [],
};
