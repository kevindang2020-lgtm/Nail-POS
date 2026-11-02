// Super-Admin → Safety Community Moderation — BUILD_PLAN Phase 8 (tenant_safety_community → complete).
//
// The moderation center for the salons' Safety Community: an overview, the post queues (review, sensitive data,
// returned / evidence requested, published, removed), post and comment reports, disputes, appeals, evidence review,
// cases + case detail, post detail (versions, reports, disputes, evidence, redactions, AI signals — advisory only —,
// comments), salons (conduct + restrictions), the audit trail, analytics and the platform settings.
// Reads need the workforce view key (super_admin.technicians.view); writes need super_admin.technicians.manage (buttons
// hidden otherwise — the server refuses regardless), a reason of ≥ 8 characters, a fresh step-up (the shared client
// re-confirms and retries once; a cancelled step-up is said plainly) and run under a moderation case (the one being
// worked, or one the action opens). A 409 (someone acted first) reloads and says so.
import { useCallback, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  superAdminCommunityModerationApi as modApi, MOD_MANAGE_PERMISSION,
  type ModQueue, type ModOverview,
} from '../api/superAdminCommunityModerationApi';
import type { ModPostAction } from '@aipowersalon/api-contracts/platform';
import {
  ModActionDialog, failMessage, label, n, when, useLoad, items, Pager, Loading, card, table, opts,
  postActionsFor, postActionDialog, ACTION_TEXT, SEVERITIES, CATEGORY_OPTIONS,
  type DialogSpec, type ModCtx, type TabId,
} from './CommunityModerationShared';
import {
  ReportsPanel, DisputesPanel, AppealsPanel, EvidencePanel, CasesPanel, CaseDetailPanel, PostDetailPanel, SalonsPanel,
  AuditPanel, AnalyticsPanel, SettingsPanel,
} from './CommunityModerationPanels';

export const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'review', label: 'Review queue' }, { id: 'sensitive', label: 'Sensitive data' },
  { id: 'returned', label: 'Returned / evidence requested' }, { id: 'published', label: 'Published' }, { id: 'removed', label: 'Removed' },
  { id: 'postReports', label: 'Post reports' }, { id: 'commentReports', label: 'Comment reports' }, { id: 'disputes', label: 'Disputes' },
  { id: 'appeals', label: 'Appeals' }, { id: 'evidence', label: 'Evidence review' }, { id: 'cases', label: 'Cases' },
  { id: 'case', label: 'Case detail' }, { id: 'post', label: 'Post detail' }, { id: 'salons', label: 'Salons' },
  { id: 'audit', label: 'Audit trail' }, { id: 'analytics', label: 'Analytics' }, { id: 'settings', label: 'Settings' },
];
const QUEUE_TAB: Record<ModQueue, TabId> = {
  review: 'review', sensitive: 'sensitive', reports: 'postReports', comment_reports: 'commentReports', disputes: 'disputes',
  appeals: 'appeals', evidence: 'evidence', returned: 'returned', published: 'published', removed: 'removed',
};
const POST_QUEUES: Partial<Record<TabId, ModQueue>> = { review: 'review', sensitive: 'sensitive', returned: 'returned', published: 'published', removed: 'removed' };
const QUEUE_HINT: Partial<Record<ModQueue, string>> = {
  review: 'Advisories held for moderation (critical, moderation-required categories, escalations) and resubmissions after evidence was requested.',
  sensitive: 'The privacy scan found data that must not be shared (card, bank, government id, …). Redact or return before anyone sees it.',
  returned: 'Waiting on the posting salon: returned for changes or asked for evidence.',
};

function OverviewPanel({ ctx }: { ctx: ModCtx }) {
  const [o, err] = useLoad<ModOverview>(() => modApi.overview(), [], ctx.reloadKey);
  return (
    <Loading data={o} err={err}>{(ov) => (
      <div style={{ display: 'grid', gap: 14 }} data-testid="mod-overview">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: 10 }}>
          {(Object.keys(QUEUE_TAB) as ModQueue[]).map((q) => (
            <button key={q} type="button" data-testid="mod-queue-card" onClick={() => ctx.goTab(QUEUE_TAB[q])} style={{ ...card, textAlign: 'left', background: 'transparent', cursor: 'pointer' }}>
              <div style={{ fontSize: 11, color: '#6b7280' }}>{label(q)}</div><div style={{ fontWeight: 800, fontSize: 18 }}>{n(ov.queues?.[q])}</div>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 13, display: 'grid', gap: 4 }}>
          <div data-testid="mod-overview-cases">Cases: {n(ov.cases.open)} open · {n(ov.cases.investigating)} investigating · {n(ov.cases.urgent)} urgent · {n(ov.cases.assignedToMe)} assigned to me</div>
          <div data-testid="mod-overview-7d">Last 7 days: {n(ov.published7d)} published · {n(ov.rejected7d)} rejected · {n(ov.removed7d)} removed</div>
          <div>{n(ov.restrictionsActive)} active restrictions · {n(ov.tenantsEnabled)} salons in the community</div>
          <div>Average time to a decision: {ov.avgHoursToDecision == null ? '—' : `${ov.avgHoursToDecision.toFixed(1)} h`} · oldest waiting: {ov.oldestWaitingHours == null ? '—' : `${ov.oldestWaitingHours.toFixed(1)} h`}</div>
          <div style={{ color: '#6b7280' }}>Updated {when(ov.generatedAt)}</div>
        </div>
      </div>
    )}</Loading>
  );
}

/** Quick actions offered on a queue row (the full set is on Post detail). */
const QUICK: Partial<Record<ModQueue, ModPostAction[]>> = { review: ['publish', 'request_changes', 'reject'], sensitive: ['reject'], published: ['remove'], removed: ['restore'] };

function QueuePanel({ queue, ctx }: { queue: ModQueue; ctx: ModCtx }) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState('');
  const [page, setPage] = useState(1);
  const [data, err] = useLoad(() => modApi.posts({ queue, q: q.trim() || undefined, category: (category || undefined) as any, severity: (severity || undefined) as any, page }), [queue, q, category, severity, page], ctx.reloadKey);
  const rows = items(data);
  return (
    <div style={{ display: 'grid', gap: 10 }} data-testid={`mod-queue-${queue}`}>
      {QUEUE_HINT[queue] && <div style={{ fontSize: 12, color: '#6b7280' }}>{QUEUE_HINT[queue]}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input aria-label="Search posts" placeholder="Title or text" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select aria-label="Category" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}><option value="">Every category</option>{CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <select aria-label="Severity" value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }}><option value="">Every severity</option>{opts(SEVERITIES).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      </div>
      <Loading data={data} err={err} empty={rows.length === 0}>{() => (
        <table style={table}>
          <thead><tr><th align="left">Advisory</th><th align="left">Salon</th><th align="left">Category</th><th align="left">Severity</th><th align="left">Status</th><th align="right">Reports</th><th align="left">Updated</th><th /></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id} data-testid="mod-post-row">
              <td><strong>{p.title}</strong>{p.privacyScanFlags.length ? <div style={{ fontSize: 11, color: '#B85B4D' }}>Privacy scan: {p.privacyScanFlags.map(label).join(', ')}</div> : null}</td>
              <td>{p.originTenantName}{p.originBranchName ? ` · ${p.originBranchName}` : ''}</td>
              <td>{label(p.category)}</td><td>{label(p.severity)}</td><td>{label(p.status)} · {label(p.verificationLabel)}</td>
              <td align="right">{p.counts.openReports}/{p.counts.reports}</td><td>{when(p.updatedAt)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button type="button" onClick={() => ctx.openPost(p.id)}>Open</button>
                {ctx.canManage ? (QUICK[queue] ?? []).filter((a) => postActionsFor(p).includes(a)).map((a) => <span key={a}>{' '}<button type="button" onClick={() => ctx.act(postActionDialog(p, a, ctx))}>{ACTION_TEXT[a].button}</button></span>) : null}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}</Loading>
      <Pager page={page} data={data} onPage={setPage} />
    </div>
  );
}

export function CommunityModerationScreen() {
  const { principal } = useAuth();
  const canManage = !!principal?.permissions?.includes(MOD_MANAGE_PERMISSION);
  const [tab, setTab] = useState<TabId>('overview');
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ spec: DialogSpec; seq: number } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [postId, setPostId] = useState<string | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const bump = useCallback(() => setReloadKey((k) => k + 1), []);

  const ctx: ModCtx = {
    canManage, reloadKey, activeCaseId,
    act: (spec) => setDialog((d) => ({ spec, seq: (d?.seq ?? 0) + 1 })),
    run: (fn, done, after) => {
      setNotice(null);
      void fn().then((r) => { setNotice(done); after?.(r); bump(); }).catch((e: any) => { setNotice(failMessage(e)); if (e?.status === 409) bump(); });
    },
    openPost: (id, fromCase) => { setPostId(id); setActiveCaseId(fromCase ?? null); setTab('post'); },
    openCase: (id) => { setCaseId(id); setActiveCaseId(id); setTab('case'); },
    goTab: (t) => setTab(t),
  };
  const queue = POST_QUEUES[tab];

  return (
    <div style={{ padding: 24, display: 'grid', gap: 16, alignContent: 'start' }} data-testid="community-moderation">
      <h1 style={{ margin: 0, fontSize: 22 }}>Safety Community Moderation</h1>
      {notice && <div role="status" style={{ padding: 10, background: '#F3F0E8', borderRadius: 8 }}>{notice}</div>}
      {!canManage && <div data-testid="mod-view-only" style={{ fontSize: 12, color: '#6b7280' }}>View only — moderation actions need the workforce management permission.</div>}
      {activeCaseId && <div style={{ fontSize: 12 }} data-testid="mod-active-case">Working case {activeCaseId.slice(0, 8)} — actions are recorded under it. <button type="button" onClick={() => setActiveCaseId(null)}>Stop working this case</button></div>}
      <div role="tablist" aria-label="Moderation panels" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            style={{ padding: '4px 10px', minHeight: 0, height: 'auto', lineHeight: 1.4, borderRadius: 999, border: '1px solid #e5e1d8', background: tab === t.id ? '#2A2118' : 'transparent', color: tab === t.id ? '#fff' : 'inherit' }}>{t.label}</button>
        ))}
      </div>
      <section role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
        {tab === 'overview' && <OverviewPanel ctx={ctx} />}
        {queue && <QueuePanel key={queue} queue={queue} ctx={ctx} />}
        {tab === 'postReports' && <ReportsPanel kind="post" ctx={ctx} />}
        {tab === 'commentReports' && <ReportsPanel kind="comment" ctx={ctx} />}
        {tab === 'disputes' && <DisputesPanel ctx={ctx} />}
        {tab === 'appeals' && <AppealsPanel ctx={ctx} />}
        {tab === 'evidence' && <EvidencePanel ctx={ctx} />}
        {tab === 'cases' && <CasesPanel ctx={ctx} />}
        {tab === 'case' && (caseId ? <CaseDetailPanel id={caseId} ctx={ctx} /> : <div>Pick a case from Cases.</div>)}
        {tab === 'post' && (postId ? <PostDetailPanel id={postId} ctx={ctx} /> : <div>Pick a post from a queue.</div>)}
        {tab === 'salons' && <SalonsPanel ctx={ctx} />}
        {tab === 'audit' && <AuditPanel ctx={ctx} />}
        {tab === 'analytics' && <AnalyticsPanel ctx={ctx} />}
        {tab === 'settings' && <SettingsPanel ctx={ctx} />}
      </section>
      {dialog && <ModActionDialog key={dialog.seq} spec={dialog.spec} onClose={() => setDialog((d) => (d && d.seq === dialog.seq ? null : d))} />}
    </div>
  );
}
