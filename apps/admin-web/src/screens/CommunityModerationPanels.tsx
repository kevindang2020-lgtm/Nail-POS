// CommunityModerationPanels.tsx — BUILD_PLAN Phase 8: the Safety Community Moderation center's panels after the post
// queues — reports, disputes, appeals, evidence, cases + case detail, post detail, salons, audit trail, analytics,
// settings. Every write goes through ctx.act (a dialog with a reason ≥ 8) and ctx.run (notice, reload, plain errors).
import { useState } from 'react';
import {
  superAdminCommunityModerationApi as modApi,
  type ModReportView, type ModDisputeView, type ModAppealView, type ModEvidenceView, type ModCaseView, type ModCommentView,
  type ModTenantConduct, type ModRestrictionView, type ModPostDetail, type ModCaseDetail, type ModAnalytics, type ModPlatformSettings,
} from '../api/superAdminCommunityModerationApi';
import type { ModCaseKind, ModCaseStatus, ModTenantAction } from '@aipowersalon/api-contracts/platform';
import type { CommunityEvidenceAccess, CommunityIncidentView } from '@aipowersalon/api-contracts/tenant';
import {
  label, n, when, pct, utcDay, useLoad, items, Pager, Loading, card, table, opts, reasonField, postActionsFor, postActionDialog,
  ACTION_TEXT, type DialogSpec, type ModCtx,
} from './CommunityModerationShared';

const CASE_KINDS: ModCaseKind[] = ['post_review', 'report', 'dispute', 'appeal', 'sensitive_data', 'evidence', 'comment', 'tenant_conduct', 'incident_access'];
const CASE_STATUSES: ModCaseStatus[] = ['open', 'investigating', 'resolved', 'closed'];
const withCase = (ctx: ModCtx) => (ctx.activeCaseId ? { caseId: ctx.activeCaseId } : {});

function StatusFilter({ value, onChange, options, name = 'Status' }: { value: string; onChange: (v: string) => void; options: string[]; name?: string }) {
  return (
    <select aria-label={name} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Every {name.toLowerCase()}</option>
      {options.map((o) => <option key={o} value={o}>{label(o)}</option>)}
    </select>
  );
}

// "Every status" is `all` on the wire — the server's lists default to the open / submitted ones when status is absent.
// ── dialogs shared by several panels ───────────────────────────────────────────────────────────────────────────────────
function resolveReportDialog(r: ModReportView, resolution: 'actioned' | 'dismissed', ctx: ModCtx): DialogSpec {
  return {
    title: resolution === 'actioned' ? 'Mark the report actioned' : 'Dismiss the report',
    question: resolution === 'actioned' ? `The report “${label(r.reason)}” led to an action. Why?` : `Dismiss the report “${label(r.reason)}” — no action needed. Why?`,
    confirmLabel: resolution === 'actioned' ? 'Mark actioned' : 'Dismiss', fields: [reasonField()],
    onSubmit: (v) => ctx.run(() => modApi.resolveReport(r.id, r.kind, { resolution, reason: String(v.reason), ...withCase(ctx) }), resolution === 'actioned' ? 'Report marked actioned.' : 'Report dismissed.'),
  };
}
function commentDialog(c: Pick<ModCommentView, 'id'>, action: 'remove' | 'restore' | 'redact', ctx: ModCtx): DialogSpec {
  const word = action === 'remove' ? 'Remove' : action === 'restore' ? 'Restore' : 'Redact';
  return {
    title: `${word} comment`, question: action === 'remove' ? 'Remove this comment? Salons see “[removed by moderator]”.' : action === 'restore' ? 'Restore this comment?' : 'Replace text in this comment?',
    confirmLabel: word,
    fields: [...(action === 'redact' ? [{ name: 'find', label: 'Text to replace', kind: 'text' as const, required: true }, { name: 'replaceWith', label: 'Replace with', kind: 'text' as const, defaultValue: '[redacted]' }] : []), reasonField()],
    onSubmit: (v) => ctx.run(() => modApi.commentAction(c.id, { action, reason: String(v.reason), ...withCase(ctx), ...(action === 'redact' ? { find: String(v.find), replaceWith: String(v.replaceWith ?? '') } : {}) }), `Comment ${action === 'remove' ? 'removed' : action === 'restore' ? 'restored' : 'redacted'}.`),
  };
}
function disputeDialog(d: ModDisputeView, ctx: ModCtx): DialogSpec {
  return {
    title: 'Decide the dispute', question: `“${d.reason}” — upheld keeps the post as it is; corrected marks it corrected; overturned removes it.`, confirmLabel: 'Decide',
    fields: [{ name: 'decision', label: 'Decision', kind: 'select', options: opts(['upheld', 'corrected', 'overturned']) }, reasonField('Note')],
    onSubmit: (v) => ctx.run(() => modApi.decideDispute(d.id, { decision: v.decision as 'upheld', note: String(v.reason), ...withCase(ctx) }), `Dispute decided: ${label(String(v.decision))}.`),
  };
}
function appealDialog(a: ModAppealView, ctx: ModCtx): DialogSpec {
  return {
    title: 'Decide the appeal',
    question: a.originalDeciderIsMe ? 'You made the original decision. Another moderator should review this appeal — decide it yourself only if no one else can.' : `${a.appellantTenantName} appeals: “${a.reason}”.`,
    confirmLabel: 'Decide',
    fields: [
      { name: 'decision', label: 'Decision', kind: 'select', options: [{ value: 'uphold', label: 'Uphold the original decision' }, { value: 'overturn', label: 'Overturn it' }] },
      ...(a.originalDeciderIsMe ? [{ name: 'allowSameDecider', label: 'I made the original decision and still decide this appeal', kind: 'checkbox' as const }] : []),
      reasonField('Note'),
    ],
    onSubmit: (v) => ctx.run(() => modApi.decideAppeal(a.id, { decision: v.decision as 'uphold', note: String(v.reason), ...withCase(ctx), ...(a.originalDeciderIsMe ? { allowSameDecider: !!v.allowSameDecider } : {}) }), `Appeal decided: ${String(v.decision) === 'overturn' ? 'overturned' : 'upheld'}.`),
  };
}
function evidenceReviewDialog(e: ModEvidenceView, ctx: ModCtx): DialogSpec {
  return {
    title: 'Review evidence', question: `A ${e.mimeType ?? 'file'} from ${e.tenantName}. Clean, redacted, or rejected?`, confirmLabel: 'Save review',
    fields: [{ name: 'decision', label: 'Decision', kind: 'select', options: opts(['clean', 'redacted', 'reject']) }, reasonField()],
    onSubmit: (v) => ctx.run(() => modApi.reviewEvidence(e.id, { decision: v.decision as 'clean', reason: String(v.reason), ...withCase(ctx) }), 'Evidence review saved.'),
  };
}
/** Viewing a file is audited under a case: the one being worked, one typed in, or a new evidence case opened for it. */
function evidenceViewDialog(e: ModEvidenceView, ctx: ModCtx, onLink: (a: CommunityEvidenceAccess) => void): DialogSpec {
  return {
    title: 'View an evidence file', question: 'Opening a salon’s evidence is logged against a moderation case.', confirmLabel: 'Get a link',
    fields: [{ name: 'caseId', label: 'Case id', kind: 'text', defaultValue: ctx.activeCaseId ?? '', hint: 'Leave empty to open a new evidence case for this file.' }, reasonField()],
    onSubmit: (v) => ctx.run(async () => {
      const reason = String(v.reason);
      const caseId = String(v.caseId || '') || (await modApi.openCase({ kind: 'evidence', reason, postId: e.postId })).id;
      return modApi.evidenceAccess(e.id, caseId, reason);
    }, 'A time-limited link to the file is ready.', (a) => onLink(a)),
  };
}

function EvidenceRows({ rows, ctx }: { rows: ModEvidenceView[]; ctx: ModCtx }) {
  const [link, setLink] = useState<{ id: string; a: CommunityEvidenceAccess } | null>(null);
  return (
    <table style={table}>
      <thead><tr><th align="left">Salon</th><th align="left">File</th><th align="left">Upload</th><th align="left">Scan</th><th align="left">Redaction</th><th align="left">Added</th><th /></tr></thead>
      <tbody>{rows.map((e) => (
        <tr key={e.id} data-testid="mod-evidence-row">
          <td>{e.tenantName}</td><td>{e.mimeType ?? '—'} · {e.sizeBytes == null ? '—' : `${Math.ceil(e.sizeBytes / 1024)} KB`}</td>
          <td>{label(e.uploadStatus)}</td><td>{label(e.scanStatus)}</td><td>{label(e.redactionStatus)}</td><td>{when(e.createdAt)}</td>
          <td style={{ whiteSpace: 'nowrap' }}>
            {e.postId ? <button type="button" onClick={() => ctx.openPost(e.postId!, ctx.activeCaseId)}>Open post</button> : null}
            {ctx.canManage ? <>{' '}<button type="button" onClick={() => ctx.act(evidenceViewDialog(e, ctx, (a) => setLink({ id: e.id, a })))}>View file…</button>
              {' '}<button type="button" onClick={() => ctx.act(evidenceReviewDialog(e, ctx))}>Review…</button></> : null}
            {link?.id === e.id ? <div data-testid="mod-evidence-link"><a href={link.a.url} target="_blank" rel="noreferrer noopener">Open the file</a> (link expires {when(link.a.expiresAt)})</div> : null}
          </td>
        </tr>
      ))}</tbody>
    </table>
  );
}

// ── reports ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function ReportsPanel({ kind, ctx }: { kind: 'post' | 'comment'; ctx: ModCtx }) {
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [data, err] = useLoad(() => modApi.reports(kind, { status: status || 'all', page }), [kind, status, page], ctx.reloadKey);
  const rows = items(data);
  return (
    <div style={{ display: 'grid', gap: 10 }} data-testid={`mod-reports-${kind}`}>
      <StatusFilter value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={['open', 'reviewing', 'actioned', 'dismissed']} />
      <Loading data={data} err={err} empty={rows.length === 0}>{() => (
        <table style={table}>
          <thead><tr><th align="left">Reported by</th><th align="left">Reason</th><th align="left">Detail</th><th align="left">Status</th><th align="left">When</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} data-testid="mod-report-row">
              <td>{r.reporterTenantName}</td><td>{label(r.reason)}</td><td>{r.detail ?? '—'}</td><td>{label(r.status)}</td><td>{when(r.createdAt)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button type="button" onClick={() => ctx.openPost(r.postId, r.caseId ?? ctx.activeCaseId)}>Open post</button>
                {ctx.canManage && r.kind === 'comment' && r.commentId ? <>{' '}<button type="button" onClick={() => ctx.act(commentDialog({ id: r.commentId! }, 'remove', ctx))}>Remove comment…</button></> : null}
                {ctx.canManage && (r.status === 'open' || r.status === 'reviewing') ? <>
                  {' '}<button type="button" onClick={() => ctx.act(resolveReportDialog(r, 'actioned', ctx))}>Actioned…</button>
                  {' '}<button type="button" onClick={() => ctx.act(resolveReportDialog(r, 'dismissed', ctx))}>Dismiss…</button>
                </> : null}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}</Loading>
      <Pager page={page} data={data} onPage={setPage} />
    </div>
  );
}

// ── disputes / appeals / evidence ──────────────────────────────────────────────────────────────────────────────────────
export function DisputesPanel({ ctx }: { ctx: ModCtx }) {
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [data, err] = useLoad(() => modApi.disputes({ status: status || 'all', page }), [status, page], ctx.reloadKey);
  const rows = items(data);
  return (
    <div style={{ display: 'grid', gap: 10 }} data-testid="mod-disputes">
      <StatusFilter value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={['open', 'under_review', 'upheld', 'overturned', 'withdrawn']} />
      <Loading data={data} err={err} empty={rows.length === 0}>{() => (
        <table style={table}>
          <thead><tr><th align="left">Raised by</th><th align="left">Reason</th><th align="left">Status</th><th align="left">Resolution</th><th align="left">When</th><th /></tr></thead>
          <tbody>{rows.map((d) => (
            <tr key={d.id} data-testid="mod-dispute-row">
              <td>{d.raisedByTenantName ?? label(d.raisedByKind)}</td><td>{d.reason}</td><td>{label(d.status)}</td><td>{d.resolutionNote ?? '—'}</td><td>{when(d.createdAt)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button type="button" onClick={() => ctx.openPost(d.postId, d.caseId ?? ctx.activeCaseId)}>Open post</button>
                {ctx.canManage && (d.status === 'open' || d.status === 'under_review') ? <>{' '}<button type="button" onClick={() => ctx.act(disputeDialog(d, ctx))}>Decide…</button></> : null}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}</Loading>
      <Pager page={page} data={data} onPage={setPage} />
    </div>
  );
}

export function AppealsPanel({ ctx }: { ctx: ModCtx }) {
  const [status, setStatus] = useState('submitted');
  const [page, setPage] = useState(1);
  const [data, err] = useLoad(() => modApi.appeals({ status: status || 'all', page }), [status, page], ctx.reloadKey);
  const rows = items(data);
  return (
    <div style={{ display: 'grid', gap: 10 }} data-testid="mod-appeals">
      <StatusFilter value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={['submitted', 'under_review', 'upheld', 'overturned', 'withdrawn']} />
      <Loading data={data} err={err} empty={rows.length === 0}>{() => (
        <table style={table}>
          <thead><tr><th align="left">Salon</th><th align="left">Appeal</th><th align="left">Original decision</th><th align="left">Status</th><th align="left">When</th><th /></tr></thead>
          <tbody>{rows.map((a) => (
            <tr key={a.id} data-testid="mod-appeal-row">
              <td>{a.appellantTenantName}</td><td><strong>{a.subject}</strong><div>{a.reason}</div></td>
              <td>{a.originalDecision ? label(a.originalDecision) : '—'}{a.originalDeciderIsMe ? <div style={{ fontSize: 11, color: '#B85B4D' }} data-testid="mod-appeal-same-decider">You decided this originally</div> : null}</td>
              <td>{label(a.status)}{a.decisionNote ? ` — ${a.decisionNote}` : ''}</td><td>{when(a.createdAt)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {a.postId ? <button type="button" onClick={() => ctx.openPost(a.postId!, a.caseId ?? ctx.activeCaseId)}>Open post</button> : null}
                {ctx.canManage && (a.status === 'submitted' || a.status === 'under_review') ? <>{' '}<button type="button" onClick={() => ctx.act(appealDialog(a, ctx))}>Decide…</button></> : null}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}</Loading>
      <Pager page={page} data={data} onPage={setPage} />
    </div>
  );
}

export function EvidencePanel({ ctx }: { ctx: ModCtx }) {
  const [status, setStatus] = useState('needs_review');
  const [page, setPage] = useState(1);
  const [data, err] = useLoad(() => modApi.evidence({ status: status || 'all', page }), [status, page], ctx.reloadKey);
  const rows = items(data);
  return (
    <div style={{ display: 'grid', gap: 10 }} data-testid="mod-evidence">
      <div style={{ fontSize: 12, color: '#6b7280' }}>Evidence is private to the posting salon. Opening a file is logged against a case.</div>
      <StatusFilter value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={['needs_review', 'unscanned', 'pending', 'clean', 'infected', 'error', 'redacted']} />
      <Loading data={data} err={err} empty={rows.length === 0}>{() => <EvidenceRows rows={rows} ctx={ctx} />}</Loading>
      <Pager page={page} data={data} onPage={setPage} />
    </div>
  );
}

// ── cases ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
function CaseRows({ rows, ctx }: { rows: ModCaseView[]; ctx: ModCtx }) {
  return (
    <table style={table}>
      <thead><tr><th align="left">Case</th><th align="left">Kind</th><th align="left">Status</th><th align="left">Priority</th><th align="left">About</th><th align="left">Assigned</th><th align="left">Opened</th><th /></tr></thead>
      <tbody>{rows.map((c) => (
        <tr key={c.id} data-testid="mod-case-row">
          <td>{c.id.slice(0, 8)}<div style={{ fontSize: 11 }}>{c.reason}</div></td><td>{label(c.kind)}</td><td>{label(c.status)}</td><td>{label(c.priority)}</td>
          <td>{c.postTitle ?? c.targetTenantName ?? (c.incidentId ? 'a private incident' : '—')}</td><td>{c.assignedToName ?? '—'}</td><td>{when(c.createdAt)}</td>
          <td><button type="button" onClick={() => ctx.openCase(c.id)}>Open case</button></td>
        </tr>
      ))}</tbody>
    </table>
  );
}

export function CasesPanel({ ctx }: { ctx: ModCtx }) {
  const [status, setStatus] = useState('open');
  const [kind, setKind] = useState('');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const [data, err] = useLoad(() => modApi.cases({ status: status as ModCaseStatus, kind: kind as ModCaseKind, mine, page }), [status, kind, mine, page], ctx.reloadKey);
  const rows = items(data);
  const openNew = () => ctx.act({
    title: 'Open a case', question: 'Open a moderation case (every cross-salon look and action is recorded under one).', confirmLabel: 'Open case',
    fields: [
      { name: 'kind', label: 'Kind', kind: 'select', options: opts(CASE_KINDS) },
      { name: 'priority', label: 'Priority', kind: 'select', options: opts(['normal', 'low', 'high', 'urgent']) },
      { name: 'postId', label: 'Post id (optional)', kind: 'text' },
      { name: 'targetTenantId', label: 'Salon id (optional)', kind: 'text' },
      { name: 'incidentId', label: 'Private incident id (incident access only)', kind: 'text' },
      reasonField(),
    ],
    onSubmit: (v) => ctx.run(() => modApi.openCase({
      kind: v.kind as ModCaseKind, priority: v.priority as 'normal', reason: String(v.reason),
      postId: String(v.postId || '') || null, targetTenantId: String(v.targetTenantId || '') || null, incidentId: String(v.incidentId || '') || null,
    }), 'Case opened.', (c: ModCaseView) => { if (c?.id) ctx.openCase(c.id); }),
  });
  return (
    <div style={{ display: 'grid', gap: 10 }} data-testid="mod-cases">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <StatusFilter value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={CASE_STATUSES} />
        <StatusFilter name="Kind" value={kind} onChange={(v) => { setKind(v); setPage(1); }} options={CASE_KINDS} />
        <label style={{ fontSize: 13 }}><input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(1); }} /> Assigned to me</label>
        {ctx.canManage ? <button type="button" onClick={openNew}>Open a case…</button> : null}
      </div>
      <Loading data={data} err={err} empty={rows.length === 0}>{() => <CaseRows rows={rows} ctx={ctx} />}</Loading>
      <Pager page={page} data={data} onPage={setPage} />
    </div>
  );
}

function ActionRows({ rows }: { rows: ModCaseDetail['actions'] }) {
  if (!rows.length) return <div style={{ fontSize: 13 }}>No actions yet.</div>;
  return (
    <table style={table}>
      <thead><tr><th align="left">When</th><th align="left">Action</th><th align="left">By</th><th align="left">Salon</th><th align="left">Reason</th></tr></thead>
      <tbody>{rows.map((a) => <tr key={a.id} data-testid="mod-action-row"><td>{when(a.createdAt)}</td><td>{label(a.action)}</td><td>{a.actorName ?? '—'}</td><td>{a.targetTenantName ?? '—'}</td><td>{a.reason ?? '—'}</td></tr>)}</tbody>
    </table>
  );
}

export function CaseDetailPanel({ id, ctx }: { id: string; ctx: ModCtx }) {
  const [data, err] = useLoad<ModCaseDetail>(() => modApi.caseDetail(id), [id], ctx.reloadKey);
  const [incident, setIncident] = useState<CommunityIncidentView | null>(null);
  return (
    <Loading data={data} err={err}>{(d) => {
      const c = d.case;
      const update = () => ctx.act({
        title: 'Update the case', question: 'Change the case’s status or priority; a resolution note is kept with it.', confirmLabel: 'Update case',
        fields: [
          { name: 'status', label: 'Status', kind: 'select', options: opts(CASE_STATUSES), defaultValue: c.status },
          { name: 'priority', label: 'Priority', kind: 'select', options: opts(['low', 'normal', 'high', 'urgent']), defaultValue: c.priority },
          { name: 'resolutionNote', label: 'Resolution note', kind: 'textarea', defaultValue: c.resolutionNote ?? '' },
        ],
        onSubmit: (v) => ctx.run(() => modApi.updateCase(c.id, { status: v.status as ModCaseStatus, priority: v.priority as 'normal', resolutionNote: String(v.resolutionNote || '') || null }), 'Case updated.'),
      });
      const openIncident = () => ctx.act({
        title: 'Open the private incident', question: 'This is the salon’s private record (never shared with other salons). The access is logged loudly against this case. Why?', confirmLabel: 'Open incident',
        fields: [reasonField()],
        onSubmit: (v) => ctx.run(() => modApi.incidentAccess(c.incidentId!, { caseId: c.id, reason: String(v.reason) }), 'Private incident opened (logged).', (r: CommunityIncidentView) => setIncident(r)),
      });
      return (
        <div style={{ display: 'grid', gap: 12 }} data-testid="mod-case-detail">
          <div style={card}>
            <div style={{ fontWeight: 700 }}>Case {c.id.slice(0, 8)} · {label(c.kind)}</div>
            <div style={{ fontSize: 13 }} data-testid="mod-case-summary">{label(c.status)} · {label(c.priority)} priority · opened by {c.openedByName ?? '—'} {when(c.createdAt)} · assigned to {c.assignedToName ?? 'no one'}</div>
            <div style={{ fontSize: 13 }}>Reason: {c.reason}</div>
            {c.resolutionNote ? <div style={{ fontSize: 13 }}>Resolution: {c.resolutionNote}</div> : null}
            {c.targetTenantName ? <div style={{ fontSize: 13 }}>Salon: {c.targetTenantName}</div> : null}
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {c.postId ? <button type="button" onClick={() => ctx.openPost(c.postId!, c.id)}>Open post</button> : null}
              {ctx.canManage ? <>
                <button type="button" onClick={() => ctx.run(() => modApi.updateCase(c.id, { assignToMe: true }), 'The case is assigned to you.')}>Assign to me</button>
                <button type="button" onClick={update}>Update…</button>
                {c.incidentId && c.kind === 'incident_access' ? <button type="button" onClick={openIncident}>Open the private incident…</button> : null}
              </> : null}
            </div>
          </div>
          {incident ? (
            <div style={{ ...card, borderColor: '#B85B4D' }} data-testid="mod-incident">
              <div style={{ fontSize: 12, color: '#B85B4D' }}>Private to the salon — this view is audited.</div>
              <div style={{ fontSize: 13 }}>{label(incident.category)} · {label(incident.severity)} · {incident.occurredOn ?? 'date not given'}</div>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{incident.rawDetail ?? '—'}</div>
            </div>
          ) : null}
          {d.post ? <div style={{ fontSize: 13 }}>Post: <strong>{d.post.title}</strong> — {label(d.post.status)} · {d.post.originTenantName}</div> : null}
          <h3 style={{ fontSize: 14, margin: 0 }}>Actions on this case</h3>
          <ActionRows rows={d.actions} />
        </div>
      );
    }}</Loading>
  );
}

// ── post detail ────────────────────────────────────────────────────────────────────────────────────────────────────────
export function PostDetailPanel({ id, ctx }: { id: string; ctx: ModCtx }) {
  const [data, err] = useLoad<ModPostDetail>(() => modApi.post(id), [id], ctx.reloadKey);
  const [comments] = useLoad<ModCommentView[]>(() => modApi.postComments(id), [id], ctx.reloadKey);
  return (
    <Loading data={data} err={err}>{(d) => {
      const p = d.post;
      const acts = postActionsFor(p);
      return (
        <div style={{ display: 'grid', gap: 12 }} data-testid="mod-post-detail">
          <div style={card}>
            <h2 style={{ margin: 0, fontSize: 17 }}>{p.title}</h2>
            <div style={{ fontSize: 13 }} data-testid="mod-post-meta">{label(p.status)} · {label(p.verificationLabel)} · {label(p.category)} · {label(p.severity)} · v{p.version}</div>
            <div style={{ fontSize: 13 }}>Posted by {p.originTenantName}{p.originBranchName ? ` (${p.originBranchName})` : ''}{p.createdByName ? ` — ${p.createdByName}` : ''} · shown as “{p.authorLabel ?? label(p.authorDisplay)}”</div>
            {p.privacyScanFlags.length ? <div style={{ fontSize: 12, color: '#B85B4D' }} data-testid="mod-post-flags">Privacy scan: {p.privacyScanFlags.map(label).join(', ')}</div> : null}
            {p.removedReason ? <div style={{ fontSize: 12 }}>Removed: {p.removedReason}</div> : null}
            <p style={{ whiteSpace: 'pre-wrap', fontSize: 14 }} data-testid="mod-post-body">{p.body}</p>
            {p.recommendation ? <div style={{ fontSize: 13 }}>Recommendation: {p.recommendation}</div> : null}
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              {p.region ?? 'no region'} · {p.incidentDate ?? 'no date'} · channels {p.channels.map(label).join(', ') || '—'} · tags {p.tags.join(', ') || '—'}
              {p.officialReference ? ` · official reference ${p.officialReference}` : ''} · comments {p.commentsLocked ? 'locked' : 'open'}
            </div>
            <div style={{ fontSize: 12 }} data-testid="mod-post-counts">{n(p.counts.comments)} comments · {n(p.counts.openReports)}/{n(p.counts.reports)} open reports · {n(p.counts.similar)} similar · {n(p.counts.disputes)} disputes · {n(p.counts.evidence)} evidence</div>
            {ctx.canManage && acts.length ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }} data-testid="mod-post-actions">
                {acts.map((a) => <button key={a} type="button" onClick={() => ctx.act(postActionDialog(p, a, ctx))}>{ACTION_TEXT[a].button}</button>)}
              </div>
            ) : null}
          </div>
          <div style={card} data-testid="mod-post-signals">
            <h3 style={{ fontSize: 14, margin: '0 0 4px' }}>AI signals — advisory only, never a decision</h3>
            {p.signals ? <div style={{ fontSize: 13 }}>Score {p.signals.score.toFixed(2)} · {p.signals.flags.map(label).join(', ') || 'no flags'}{p.signals.notes.length ? <ul>{p.signals.notes.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}</div> : <div style={{ fontSize: 13 }}>No AI signals for this post.</div>}
          </div>
          <section><h3 style={{ fontSize: 14, margin: '0 0 4px' }}>Versions</h3>
            {d.versions.length === 0 ? <div style={{ fontSize: 13 }}>No earlier versions.</div> : (
              <table style={table}><thead><tr><th align="left">v</th><th align="left">Status</th><th align="left">Title</th><th align="left">By</th><th align="left">Note</th><th align="left">When</th></tr></thead>
                <tbody>{d.versions.map((v) => <tr key={v.version} data-testid="mod-version-row"><td>{v.version}</td><td>{label(v.status)}</td><td>{v.title ?? '—'}</td><td>{v.editedBy ?? '—'}</td><td>{v.changeNote ?? '—'}</td><td>{when(v.createdAt)}</td></tr>)}</tbody></table>
            )}
          </section>
          <section><h3 style={{ fontSize: 14, margin: '0 0 4px' }}>Reports</h3>
            {d.reports.length === 0 ? <div style={{ fontSize: 13 }}>No reports.</div> : (
              <table style={table}><tbody>{d.reports.map((r) => (
                <tr key={r.id} data-testid="mod-post-report"><td>{r.reporterTenantName}</td><td>{label(r.reason)}</td><td>{r.detail ?? ''}</td><td>{label(r.status)}</td>
                  <td>{ctx.canManage && (r.status === 'open' || r.status === 'reviewing') ? <><button type="button" onClick={() => ctx.act(resolveReportDialog(r, 'actioned', ctx))}>Actioned…</button>{' '}<button type="button" onClick={() => ctx.act(resolveReportDialog(r, 'dismissed', ctx))}>Dismiss…</button></> : null}</td></tr>
              ))}</tbody></table>
            )}
          </section>
          <section><h3 style={{ fontSize: 14, margin: '0 0 4px' }}>Disputes</h3>
            {d.disputes.length === 0 ? <div style={{ fontSize: 13 }}>No disputes.</div> : (
              <table style={table}><tbody>{d.disputes.map((x) => (
                <tr key={x.id} data-testid="mod-post-dispute"><td>{x.raisedByTenantName ?? label(x.raisedByKind)}</td><td>{x.reason}</td><td>{label(x.status)}</td>
                  <td>{ctx.canManage && (x.status === 'open' || x.status === 'under_review') ? <button type="button" onClick={() => ctx.act(disputeDialog(x, ctx))}>Decide…</button> : null}</td></tr>
              ))}</tbody></table>
            )}
          </section>
          <section><h3 style={{ fontSize: 14, margin: '0 0 4px' }}>Evidence</h3>
            {d.evidence.length === 0 ? <div style={{ fontSize: 13 }}>No evidence.</div> : <EvidenceRows rows={d.evidence} ctx={ctx} />}
          </section>
          <section><h3 style={{ fontSize: 14, margin: '0 0 4px' }}>Cases</h3>
            {d.cases.length === 0 ? <div style={{ fontSize: 13 }}>No cases yet — the first action opens one.</div> : <CaseRows rows={d.cases} ctx={ctx} />}
          </section>
          <section><h3 style={{ fontSize: 14, margin: '0 0 4px' }}>Related posts</h3>
            {d.related.length === 0 ? <div style={{ fontSize: 13 }}>None.</div> : <ul style={{ fontSize: 13 }}>{d.related.map((r) => <li key={r.id} data-testid="mod-related"><button type="button" onClick={() => ctx.openPost(r.id, ctx.activeCaseId)}>{r.title}</button> — {label(r.relation)}{r.score == null ? '' : ` (${pct(r.score)})`}</li>)}</ul>}
          </section>
          <section><h3 style={{ fontSize: 14, margin: '0 0 4px' }}>Redactions</h3>
            {d.redactions.length === 0 ? <div style={{ fontSize: 13 }}>None.</div> : <ul style={{ fontSize: 13 }}>{d.redactions.map((r, i) => <li key={i} data-testid="mod-redaction">{label(r.field)} — {r.reason} ({r.by ?? 'system'}, {when(r.createdAt)})</li>)}</ul>}
          </section>
          <section><h3 style={{ fontSize: 14, margin: '0 0 4px' }}>Comments</h3>
            <Loading data={comments} empty={Array.isArray(comments) && comments.length === 0}>{(cs) => (
              <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 6 }}>{cs.map((c) => (
                <li key={c.id} data-testid="mod-comment" style={{ ...card, marginLeft: c.parentId ? 24 : 0 }}>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{c.tenantName} as “{c.authorLabel ?? '—'}” · {when(c.createdAt)} · {c.reportCount} reports</div>
                  <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{c.removed ? <em>[removed by moderator{c.removedReason ? `: ${c.removedReason}` : ''}]</em> : c.body}</div>
                  {ctx.canManage ? <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    {c.removed ? <button type="button" onClick={() => ctx.act(commentDialog(c, 'restore', ctx))}>Restore comment…</button> : <>
                      <button type="button" onClick={() => ctx.act(commentDialog(c, 'remove', ctx))}>Remove comment…</button>
                      <button type="button" onClick={() => ctx.act(commentDialog(c, 'redact', ctx))}>Redact comment…</button></>}
                  </div> : null}
                </li>
              ))}</ul>
            )}</Loading>
          </section>
        </div>
      );
    }}</Loading>
  );
}

// ── salons ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const TENANT_ACTION_TEXT: Record<ModTenantAction, { button: string; confirm: string; question: string }> = {
  restrict_posting: { button: 'Restrict posting…', confirm: 'Restrict posting', question: 'Stop this salon from drafting or submitting advisories?' },
  restrict_commenting: { button: 'Restrict commenting…', confirm: 'Restrict commenting', question: 'Stop this salon from commenting?' },
  suspend: { button: 'Suspend…', confirm: 'Suspend', question: 'Suspend this salon from the community (it can still read)?' },
  lift: { button: 'Lift…', confirm: 'Lift restriction', question: 'Lift this restriction?' },
  contact: { button: 'Contact…', confirm: 'Send message', question: 'Send an in-app message to the salon’s owner.' },
};
function tenantDialog(tenantId: string, tenantName: string, action: ModTenantAction, ctx: ModCtx, restrictionId?: string): DialogSpec {
  const t = TENANT_ACTION_TEXT[action];
  const restricting = action === 'restrict_posting' || action === 'restrict_commenting' || action === 'suspend';
  return {
    title: `${t.confirm}: ${tenantName}`, question: t.question, confirmLabel: t.confirm,
    fields: [
      ...(restricting ? [
        { name: 'expiresOn', label: 'Until (optional, UTC day)', kind: 'date' as const, hint: 'Leave empty for no end date.' },
        { name: 'userId', label: 'Only this user (id, optional)', kind: 'text' as const, hint: 'Leave empty for the whole salon.' },
      ] : []),
      ...(action === 'contact' ? [{ name: 'message', label: 'Message', kind: 'textarea' as const, required: true }] : []),
      reasonField(),
    ],
    onSubmit: (v) => ctx.run(() => modApi.tenantAction(tenantId, {
      action, reason: String(v.reason), ...withCase(ctx),
      ...(restricting ? { expiresAt: v.expiresOn ? `${String(v.expiresOn)}T23:59:59Z` : null, userId: String(v.userId || '') || null } : {}),
      ...(action === 'lift' ? { restrictionId: restrictionId ?? null } : {}),
      ...(action === 'contact' ? { message: String(v.message) } : {}),
    }), action === 'contact' ? `Message sent to ${tenantName}.` : `${t.confirm} — done for ${tenantName}.`),
  };
}

function RestrictionList({ rows, ctx }: { rows: ModRestrictionView[]; ctx: ModCtx }) {
  const live = rows.filter((r) => !r.liftedAt);
  if (!live.length) return <div style={{ fontSize: 13 }}>No active restrictions.</div>;
  return (
    <ul style={{ fontSize: 13, margin: 0 }}>{live.map((r) => (
      <li key={r.id} data-testid="mod-restriction">{r.tenantName}: {label(r.kind)}{r.userId ? ' (one user)' : ''} — {r.reason}{r.expiresAt ? ` · until ${when(r.expiresAt)}` : ''}
        {ctx.canManage ? <>{' '}<button type="button" onClick={() => ctx.act(tenantDialog(r.tenantId, r.tenantName, 'lift', ctx, r.id))}>Lift…</button></> : null}</li>
    ))}</ul>
  );
}

export function SalonsPanel({ ctx }: { ctx: ModCtx }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, err] = useLoad(() => modApi.tenants({ q: q.trim() || undefined, page }), [q, page], ctx.reloadKey);
  const [restrictions, rErr] = useLoad<ModRestrictionView[]>(() => modApi.restrictions(true), [], ctx.reloadKey);
  const rows = items<ModTenantConduct>(data);
  const [openId, setOpenId] = useState<string | null>(null);
  const [one, oneErr] = useLoad<ModTenantConduct | null>(() => (openId ? modApi.tenant(openId) : Promise.resolve(null)), [openId], ctx.reloadKey);
  return (
    <div style={{ display: 'grid', gap: 12 }} data-testid="mod-salons">
      <section><h3 style={{ fontSize: 14, margin: '0 0 4px' }}>Active restrictions</h3>
        <Loading data={restrictions} err={rErr}>{(rs) => <RestrictionList rows={rs} ctx={ctx} />}</Loading>
      </section>
      <input aria-label="Search salons" placeholder="Salon name" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      <Loading data={data} err={err} empty={rows.length === 0}>{() => (
        <table style={table}>
          <thead><tr><th align="left">Salon</th><th align="left">Community</th><th align="right">Posts</th><th align="right">Removed</th><th align="right">Upheld disputes</th><th align="right">Reports against</th><th align="left">Restrictions</th><th /></tr></thead>
          <tbody>{rows.map((t) => (
            <tr key={t.tenantId} data-testid="mod-salon-row">
              <td>{t.tenantName}</td><td>{t.enabled ? 'On' : 'Off'}</td><td align="right">{t.posts}</td><td align="right">{t.removed}</td><td align="right">{t.upheldDisputes}</td><td align="right">{t.reportsAgainst}</td>
              <td>{t.restrictions.filter((r) => !r.liftedAt).map((r) => label(r.kind)).join(', ') || 'none'}</td>
              <td style={{ whiteSpace: 'nowrap' }}><button type="button" aria-expanded={openId === t.tenantId} onClick={() => setOpenId(openId === t.tenantId ? null : t.tenantId)}>{openId === t.tenantId ? 'Close' : 'Details'}</button>{ctx.canManage ? (['restrict_posting', 'restrict_commenting', 'suspend', 'contact'] as ModTenantAction[]).map((a) => (
                <span key={a}>{' '}<button type="button" onClick={() => ctx.act(tenantDialog(t.tenantId, t.tenantName, a, ctx))}>{TENANT_ACTION_TEXT[a].button}</button></span>
              )) : null}</td>
            </tr>
          ))}</tbody>
        </table>
      )}</Loading>
      <Pager page={page} data={data} onPage={setPage} />
      {openId ? (
        <section style={card} data-testid="mod-salon-detail">
          <Loading data={one} err={oneErr}>{(t) => (t ? <>
            <h3 style={{ fontSize: 14, margin: '0 0 4px' }}>{t.tenantName}</h3>
            <div style={{ fontSize: 13 }}>Community {t.enabled ? 'on' : 'off'} · {t.posts} posts · {t.removed} removed · {t.upheldDisputes} upheld disputes · {t.reportsAgainst} reports against</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>Restriction history:</div>
            {t.restrictions.length === 0 ? <div style={{ fontSize: 13 }}>None.</div> : <ul style={{ fontSize: 13, margin: 0 }}>{t.restrictions.map((r) => (
              <li key={r.id} data-testid="mod-salon-restriction">{label(r.kind)} — {r.reason} · {when(r.createdAt)}{r.liftedAt ? ` · lifted ${when(r.liftedAt)}` : ' · active'}</li>
            ))}</ul>}
          </> : null)}</Loading>
        </section>
      ) : null}
    </div>
  );
}

// ── audit trail / analytics / settings ─────────────────────────────────────────────────────────────────────────────────
export function AuditPanel({ ctx }: { ctx: ModCtx }) {
  const [postId, setPostId] = useState('');
  const [caseId, setCaseId] = useState('');
  const [page, setPage] = useState(1);
  const [data, err] = useLoad(() => modApi.actions({ postId: postId.trim() || undefined, caseId: caseId.trim() || undefined, page }), [postId, caseId, page], ctx.reloadKey);
  const rows = items(data);
  return (
    <div style={{ display: 'grid', gap: 10 }} data-testid="mod-audit">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input aria-label="Post id" placeholder="Post id" value={postId} onChange={(e) => { setPostId(e.target.value); setPage(1); }} />
        <input aria-label="Case id" placeholder="Case id" value={caseId} onChange={(e) => { setCaseId(e.target.value); setPage(1); }} />
      </div>
      <Loading data={data} err={err} empty={rows.length === 0}>{() => <ActionRows rows={rows} />}</Loading>
      <Pager page={page} data={data} onPage={setPage} />
    </div>
  );
}

export function AnalyticsPanel({ ctx }: { ctx: ModCtx }) {
  const [from, setFrom] = useState(() => utcDay(30));
  const [to, setTo] = useState(() => utcDay(0));
  const [data, err] = useLoad<ModAnalytics>(() => modApi.analytics(from, to), [from, to], ctx.reloadKey);
  return (
    <div style={{ display: 'grid', gap: 10 }} data-testid="mod-analytics">
      <div style={{ display: 'flex', gap: 8 }}>
        <label style={{ fontSize: 13 }}>From <input aria-label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={{ fontSize: 13 }}>To <input aria-label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <Loading data={data} err={err}>{(a) => (
        <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
          <div data-testid="mod-analytics-totals">{n(a.published)} published · {n(a.rejected)} rejected · {n(a.removed)} removed · {n(a.disputes)} disputes · {n(a.appeals)} appeals · overturn rate {pct(a.overturnRate)} · median time to a decision {a.medianHoursToDecision == null ? '—' : `${a.medianHoursToDecision.toFixed(1)} h`}</div>
          <div data-testid="mod-analytics-severity">By severity: {Object.entries(a.bySeverity ?? {}).map(([k, v]) => `${label(k)} ${v}`).join(' · ') || 'none'}</div>
          <table style={table}><thead><tr><th align="left">Category</th><th align="right">Posts</th></tr></thead>
            <tbody>{a.byCategory.map((c) => <tr key={c.category} data-testid="mod-analytics-category"><td>{label(c.category)}</td><td align="right">{c.count}</td></tr>)}</tbody></table>
        </div>
      )}</Loading>
    </div>
  );
}

export function SettingsPanel({ ctx }: { ctx: ModCtx }) {
  const [data, err] = useLoad<ModPlatformSettings>(() => modApi.settings(), [], ctx.reloadKey);
  return (
    <Loading data={data} err={err}>{(s) => (
      <div style={{ display: 'grid', gap: 8, fontSize: 13 }} data-testid="mod-settings">
        <div>Rules version {s.rulesVersion} · settings v{s.version}</div>
        <div data-testid="mod-settings-risk">Risk matching (salted fingerprints across salons): {s.riskMatchingEnabled ? 'on' : 'off'}</div>
        <div data-testid="mod-settings-threshold">Reports before a post is queued for review: {s.autoHideReportThreshold}</div>
        {ctx.canManage ? <div><button type="button" onClick={() => ctx.act({
          title: 'Change community settings', question: 'Platform-wide; versioned and audited.', confirmLabel: 'Save settings',
          fields: [
            { name: 'riskMatchingEnabled', label: 'Risk matching on', kind: 'checkbox', defaultValue: s.riskMatchingEnabled },
            { name: 'autoHideReportThreshold', label: 'Reports before review', kind: 'number', required: true, defaultValue: String(s.autoHideReportThreshold) },
            reasonField(),
          ],
          onSubmit: (v) => {
            const th = Number(v.autoHideReportThreshold);
            if (!Number.isInteger(th) || th < 1 || th > 100) { ctx.run(() => Promise.reject(new Error('Reports before review must be a whole number from 1 to 100.')), ''); return; }
            ctx.run(() => modApi.saveSettings({ expectedVersion: s.version, riskMatchingEnabled: !!v.riskMatchingEnabled, autoHideReportThreshold: th, reason: String(v.reason) }), 'Settings saved.');
          },
        })}>Change settings…</button></div> : null}
      </div>
    )}</Loading>
  );
}
