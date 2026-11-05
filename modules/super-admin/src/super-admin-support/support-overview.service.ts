// support-overview.service.ts — composes support-center-core over SupportOverviewRepository into the Support Center
// dashboard. SLA status is derived per-row through the core (one source of truth), so the SLA breakdown and each queue
// row agree. CSAT and actual avg-first-response are genuinely unmodeled → returned as null so the UI shows "—" rather
// than a fabricated number. Read-only; everything reconciles to the rows.
import type { OverviewScope } from '@aipowersalon/database';
import type { SupportOverviewRepository } from './support-overview.repository';
import { slaStatusOf, sessionStatusOf, sessionAuditStatus, durationMinutes, distribution, type SlaStatus } from './support-center-core';
// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { SupportOverview } from '@aipowersalon/api-contracts/platform';
import type { SupportOverview } from '@aipowersalon/api-contracts/platform';

export interface AdminCtx { userId?: string; email?: string; ip?: string }


export class SupportOverviewService {
  constructor(private readonly repo: SupportOverviewRepository) {}

  async getOverview(_ctx: AdminCtx, q: { scope?: OverviewScope; filters?: { category?: string; priority?: string; agent?: string; slaStatus?: string; dateFrom?: string; dateTo?: string } }): Promise<SupportOverview> {
    const d = await this.repo.overviewData(q.scope, q.filters);
    const now = Date.now();
    const slaFilter = q.filters?.slaStatus;

    // Derive SLA status per active ticket through the core → breakdown + breach KPI reconcile with the queue rows.
    const slaCounts: Record<string, number> = { on_track: 0, near_breach: 0, breached: 0, paused: 0, not_applicable: 0 };
    for (const r of d.slaRows) slaCounts[slaStatusOf(r.status, r.responseTargetMinutes, r.createdAtMs, now)]++;
    const slaBreakdown = distribution([
      { key: 'On Track', count: slaCounts.on_track },
      { key: 'Near Breach', count: slaCounts.near_breach },
      { key: 'Breached', count: slaCounts.breached },
    ]);

    const PRIORITY_LABEL: Record<string, string> = { critical: 'Critical', urgent: 'Urgent', high: 'High', normal: 'Medium', low: 'Low' };
    const ticketsByPriority = distribution(d.priorityCounts.map((p) => ({ key: PRIORITY_LABEL[p.key] ?? p.key, count: p.count })));

    return {
      meta: { generatedAt: new Date().toISOString(), scope: q.scope?.tenantId ? 'tenant' : 'platform' },
      kpis: {
        openTickets: d.kpis.openTickets, urgentTickets: d.kpis.urgentTickets, assignedTickets: d.kpis.assignedTickets,
        waitingForCustomer: d.kpis.waitingForCustomer, resolvedToday: d.kpis.resolvedToday, slaBreaches: slaCounts.breached,
        auditedSessions: d.kpis.auditedSessions, knowledgeArticles: d.kpis.knowledgeArticles,
        ticketCsat: d.ticketCsat,    // real: avg of submitted 1–5 ratings (null until any ticket is rated)
        avgFirstResponseMin: d.avgFirstResponseMin,   // real: derived from first 'agent' message per ticket
      },
      ticketVolumeTrend: d.volumeTrend,
      ticketsByPriority,
      slaBreakdown,
      agentPerformance: d.agentPerformance.map((a) => ({ ...a, csat: a.csat })),
      urgentIncidents: d.urgentIncidents,
      queue: d.queue.map((r) => ({
        id: r.id, ticketNumber: r.ticketNumber, tenant: r.tenant, branch: r.branch, category: r.category, priority: r.priority,
        assignedTo: r.assignedTo, slaStatus: slaStatusOf(r.status, r.responseTargetMinutes, r.createdAtMs, now),
        relatedDevice: null, relatedTransaction: null,   // linked-record model not yet populated → honest —
        lastUpdate: r.lastUpdate, status: r.status,
      })).filter((r) => !slaFilter || r.slaStatus === slaFilter).slice(0, 60),
      resolvedToday: d.resolvedTodayRows.map((r) => ({ ...r, csat: null })),  // per-ticket csat not selected in this list
      waitingForCustomer: d.waitingRows,
      escalated: d.escalatedRows,
      recentSessions: d.sessions.map((s) => {
        const st = sessionStatusOf(s.expiresAtMs, s.endedAtMs, now);
        return { id: s.id, tenant: s.tenant, accessLevel: null, reason: s.reason, started: new Date(s.startedAtMs).toISOString(), ended: s.endedAtMs ? new Date(s.endedAtMs).toISOString() : null, durationMin: durationMinutes(s.startedAtMs, s.endedAtMs, now), startedBy: s.startedBy, auditStatus: sessionAuditStatus(st) };
      }),
      knowledgeBase: d.knowledgeBase,
      atAGlance: { newTickets: d.kpis.newToday, ticketsResolved: d.kpis.resolvedToday, urgentCases: d.kpis.urgentTickets, avgResponseMin: d.avgFirstResponseMin, sessionsStarted: d.kpis.sessionsStartedToday, csat: d.ticketCsat },
    };
  }
}
