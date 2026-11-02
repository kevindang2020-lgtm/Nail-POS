// audit-logs.service.ts — assembles the Audit Logs oversight dashboard from the append-only audit_events table.
// Read-only: never writes/edits/deletes log rows. The 10 KPIs, category/result/trend charts, top users, suspicious
// queue, audit trail, export events, before/after review, and access-source summary are all real. Legal holds, open
// investigations, and exported evidence packets are surfaced honestly as available:false until their tables exist
// (built as later units). This read path itself performs NO audit write (reading logs must not mutate the log).
import { parseScope, type OverviewScope } from '@aipowersalon/database';
import { AuditLogsRepository, type Range } from './audit-logs.kysely.repository';
import { resultBucket, categoryLabel, riskLevel, beforeAfter, distribution, trendDelta, kpiTrendSemantic, type Semantic } from './audit-logs-core';
import { AuditTamperControlsService } from './audit-tamper-controls.service';
import { AuditRetentionService } from './audit-retention.service';

export interface AdminCtx { userId?: string; email?: string; ip?: string }
const num = (v: string | null | undefined) => Number(v ?? 0) || 0;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

export class AuditLogsService {
  constructor(private readonly repo: AuditLogsRepository, private readonly tamper?: AuditTamperControlsService, private readonly retention?: AuditRetentionService) {}

  private async tamperControls() {
    const base = this.tamper ? await this.tamper.status() : { available: false as const };
    if (!this.retention) return base;
    const ret = await this.retention.list();
    return { ...base, retention: ret };
  }

  private ranges(q: any): { current: Range; prior: Range; days: number } {
    const days = Math.max(1, Math.min(90, Math.round(Number(q?.days)) || 7));
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    return { current: { start, end }, prior: { start: new Date(start.getTime() - days * 86400000), end: start }, days };
  }

  async getOverview(_ctx: AdminCtx, q: any) {
    const scope: OverviewScope = parseScope(q?.tenantId);
    const { current, prior, days } = this.ranges(q);

    const [cur, pri, cats, results, byDay, topUsers, suspicious, trail, exportsRecent, beforeAfterRows, access, today, legalHoldActive, legalHoldRows, investigationsOpen, investigationRows, evidenceReady, retention, exportsFlagged] = await Promise.all([
      this.repo.counts(scope, current), this.repo.counts(scope, prior), this.repo.byCategory(scope, current),
      this.repo.byResult(scope, current), this.repo.byDay(scope, current), this.repo.topUsers(scope, current),
      this.repo.suspicious(scope, current), this.repo.trail(scope, current), this.repo.recentExports(scope),
      this.repo.beforeAfterEvents(scope), this.repo.accessSource(scope, current), this.repo.todayCounts(scope, startOfToday()),
      this.repo.legalHoldActiveCount(), this.repo.legalHoldRecords(), this.repo.investigationsOpenCount(), this.repo.investigationsRecent(), this.repo.evidenceReadyCount(), this.tamperControls(), this.repo.exportFlagsOpenCount(),
    ]);

    const total = num(cur.total);
    const kpi = (key: string, label: string, value: number, priorVal: number, opts: { available?: boolean } = {}) => {
      const t = trendDelta(value, priorVal);
      return { key, label, value, display: opts.available === false ? '—' : value.toLocaleString(), available: opts.available !== false, deltaPct: t.deltaPct, direction: t.direction, semantic: kpiTrendSemantic(key, t.direction) as Semantic };
    };

    const kpis = [
      kpi('total', 'Total Logged Events', total, num(pri.total)),
      kpi('critical', 'Critical Events', num(cur.critical), num(pri.critical)),
      kpi('failed_logins', 'Failed Logins', num(cur.failed_logins), num(pri.failed_logins)),
      kpi('data_exports', 'Data Exports', num(cur.data_exports), num(pri.data_exports)),
      kpi('role_changes', 'Role Changes', num(cur.role_changes), num(pri.role_changes)),
      kpi('support_access', 'Support-Mode Access', num(cur.support_access), num(pri.support_access)),
      kpi('ai_config', 'AI Config Changes', num(cur.ai_config), num(pri.ai_config)),
      kpi('legal_hold', 'Legal Hold Records', legalHoldActive, legalHoldActive),
      kpi('investigations', 'Investigations Open', investigationsOpen, investigationsOpen),
      kpi('evidence_packets', 'Exported Evidence Packets', evidenceReady, evidenceReady),
    ];

    const catSegs = distribution(cats.map((c) => ({ key: (c.module || 'other'), label: categoryLabel(c.module), count: num(c.count) })), total);
    const resultAgg: Record<string, number> = {};
    for (const r of results) { const b = resultBucket(r.status); resultAgg[b.key] = (resultAgg[b.key] || 0) + num(r.count); }
    const resultSegs = distribution(['success', 'warning', 'failed', 'under_review'].map((k) => ({ key: k, label: resultBucket(k === 'success' ? 'ok' : k).label, count: resultAgg[k] || 0 })).filter((s) => s.count > 0), total);
    const accessTotal = access.reduce((s, a) => s + num(a.count), 0);
    const accessSegs = distribution(access.map((a) => ({ key: (a.device || 'unknown'), label: a.device || 'Unknown', count: num(a.count) })), accessTotal);

    return {
      ok: true,
      metadata: { generatedAt: new Date().toISOString(), windowDays: days },
      scope: { tenantId: scope.tenantId ?? null, label: scope.tenantId ? 'Tenant-scoped' : 'All tenants' },
      tamperResistance: { appendOnly: true, editable: false, note: 'Audit logs are append-only and cannot be edited or deleted by administrators.' },
      kpis,
      eventsByCategory: { total, segments: catSegs },
      resultBreakdown: { total, segments: resultSegs },
      eventVolumeTrend: byDay.map((d) => ({ day: d.day, count: num(d.count) })),
      topUsers: topUsers.map((u) => ({ user: u.actor_name || 'system', events: num(u.count) })),
      suspiciousQueue: suspicious.map((s) => ({ time: s.occurred_at, user: s.actor_name || 'system', event: s.action || '—', status: s.status || '—', risk: riskLevel(s.action, s.status, s.severity).key, riskLabel: riskLevel(s.action, s.status, s.severity).label, ip: s.ip || '—' })),
      auditTrail: trail.map((t) => { const ba = beforeAfter(t.metadata); return { time: t.occurred_at, user: t.actor_name || 'system', role: t.actor_role || '—', tenant: t.tenant_name || '—', action: t.action || '—', previous: ba.previous ?? '—', next: ba.next ?? '—', ip: t.ip || '—', device: t.device || '—', reason: t.summary || '—', result: resultBucket(t.status).label }; }),
      recentExports: exportsRecent.map((e) => ({ time: e.occurred_at, user: e.actor_name || 'system', scope: e.module || '—', summary: e.summary || '—' })),
      beforeAfterReview: beforeAfterRows.map((e) => { const ba = beforeAfter(e.metadata); return { time: e.occurred_at, user: e.actor_name || 'system', action: e.action || '—', previous: ba.previous ?? '—', next: ba.next ?? '—' }; }),
      accessSourceSummary: { total: accessTotal, segments: accessSegs },
      legalHoldRecords: { available: true as const, records: legalHoldRows.map((h) => ({ holdRef: h.hold_ref, scope: h.scope_type + (h.scope_value ? ':' + h.scope_value : ''), status: h.status, reason: h.reason, createdAt: h.created_at })) },
      // Honest until their tables exist (later units).
      openInvestigations: { available: true as const, investigations: investigationRows.map((i) => ({ caseRef: i.case_ref, title: i.title, severity: i.severity, assignee: i.assignee, status: i.status })) },
      retentionStatus: retention,
      atAGlance: {
        eventsToday: num(today.total), failedLoginsToday: num(today.failed_logins), highRiskToday: num(today.high_risk),
        openInvestigations: { available: true as const, value: investigationsOpen }, legalHoldsActive: { available: true as const, value: legalHoldActive }, exportsFlagged: { available: true as const, value: exportsFlagged },
      },
    };
  }
}
