// CommunityModerationShared.tsx — BUILD_PLAN Phase 8: the pieces every Safety Community moderation panel shares — the
// action dialog (every write asks for a reason of ≥ 8 characters, plus the fields that action needs), the error wording
// (a cancelled step-up and a 409 are said plainly), labels, the pager, and which post actions fit which status.
import { useCallback, useEffect, useId, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { superAdminCommunityModerationApi as modApi, MOD_MIN_REASON, type ModPostView, type ModPage } from '../api/superAdminCommunityModerationApi';
import type { ModPostAction, ModPostActionRequest } from '@aipowersalon/api-contracts/platform';
import { COMMUNITY_CATEGORIES } from '@aipowersalon/api-contracts/tenant';

// ── formatting ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '—');
export const label = (k: string | null | undefined) => String(k ?? '').replace(/_/g, ' ');
export const when = (iso?: string | null) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
export const pct = (r: number | null | undefined) => (r == null ? '—' : `${Math.round(r * 100)}%`);
/** the UTC calendar day (YYYY-MM-DD) `days` ago — built from the UTC parts, never a sliced ISO string */
export const utcDay = (daysAgo = 0, now: Date = new Date()) => {
  const d = new Date(now.getTime() - daysAgo * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

export const SEVERITIES = ['informational', 'low', 'moderate', 'high', 'critical'] as const;
export const LABELS = ['unverified', 'evidence_reviewed', 'multiple_reports', 'official_report'] as const;
export const CATEGORY_OPTIONS = COMMUNITY_CATEGORIES.map((c) => ({ value: c, label: label(c) }));
export const opts = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: label(x) }));

/** How a failed write is told to the moderator. A 409 means someone changed it first (the panel reloads). */
export function failMessage(e: any, fallback = 'Not changed.'): string {
  if (e?.code === 'STEP_UP_REQUIRED') return 'Not changed — this needs you to confirm your identity again (step-up), and that was not completed.';
  if (e?.status === 409) return `Not changed — ${e?.code === 'version_conflict' || !e?.message ? 'someone else changed this first' : e.message}. The latest version is loaded; check it and try again.`;
  return e?.message || fallback;
}

// ── which actions fit a post's status (the server decides; this keeps the buttons honest) ─────────────────────────────
export const isPublished = (s: string) => s.startsWith('published_');
export function postActionsFor(p: Pick<ModPostView, 'status' | 'commentsLocked'>): ModPostAction[] {
  const s = p.status;
  const lock: ModPostAction = p.commentsLocked ? 'unlock_comments' : 'lock_comments';
  if (s === 'moderation_review') return ['publish', 'request_changes', 'request_evidence', 'reject', 'redact', 'set_severity', 'merge_into', 'link_related'];
  if (s === 'sensitive_data_detected') return ['redact', 'publish', 'request_changes', 'reject'];
  if (s === 'evidence_requested') return ['reject', 'redact'];
  if (isPublished(s)) return ['remove', 'set_label', 'set_severity', 'redact', lock, 'merge_into', 'link_related', 'mark_resolved'];
  if (s === 'disputed' || s === 'corrected') return ['remove', 'set_label', 'redact', lock, 'mark_resolved'];
  if (s === 'resolved') return ['remove', lock];
  if (s === 'removed') return ['restore'];
  return [];
}
export const ACTION_TEXT: Record<ModPostAction, { button: string; confirm: string; question: string }> = {
  publish: { button: 'Publish…', confirm: 'Publish', question: 'Publish this advisory to every salon in the community?' },
  reject: { button: 'Reject…', confirm: 'Reject', question: 'Reject this advisory? It is not published; the posting salon is told why.' },
  request_evidence: { button: 'Request evidence…', confirm: 'Request evidence', question: 'Ask the posting salon for evidence before deciding?' },
  request_changes: { button: 'Request changes…', confirm: 'Return for changes', question: 'Return this advisory to the posting salon for changes?' },
  redact: { button: 'Redact…', confirm: 'Redact', question: 'Replace text in this advisory (logged as a redaction; the post is re-scanned)?' },
  set_label: { button: 'Change label…', confirm: 'Change label', question: 'Change the verification label other salons see?' },
  set_severity: { button: 'Change severity…', confirm: 'Change severity', question: 'Change this advisory’s severity?' },
  remove: { button: 'Remove…', confirm: 'Remove', question: 'Remove this advisory from the community? Other salons stop seeing it.' },
  restore: { button: 'Restore…', confirm: 'Restore', question: 'Restore this advisory to the community?' },
  lock_comments: { button: 'Lock comments…', confirm: 'Lock comments', question: 'Lock comments on this advisory?' },
  unlock_comments: { button: 'Unlock comments…', confirm: 'Unlock comments', question: 'Allow comments on this advisory again?' },
  merge_into: { button: 'Merge into…', confirm: 'Merge', question: 'Merge this advisory into another (this one is removed and points to it)?' },
  link_related: { button: 'Link related…', confirm: 'Link', question: 'Link this advisory to a related one?' },
  mark_resolved: { button: 'Mark resolved…', confirm: 'Mark resolved', question: 'Mark this advisory resolved?' },
};

// ── the action dialog ──────────────────────────────────────────────────────────────────────────────────────────────────
export type FieldValue = string | boolean;
export interface FieldSpec {
  name: string; label: string; kind: 'textarea' | 'text' | 'select' | 'number' | 'checkbox' | 'date';
  options?: { value: string; label: string }[]; required?: boolean; minLength?: number; defaultValue?: FieldValue; hint?: string;
}
export interface DialogSpec {
  title: string; question: string; confirmLabel: string; fields: FieldSpec[];
  onSubmit: (values: Record<string, FieldValue>) => void;
}
export const reasonField = (lbl = 'Reason'): FieldSpec => ({ name: 'reason', label: lbl, kind: 'textarea', required: true, minLength: MOD_MIN_REASON });

export function ModActionDialog({ spec, onClose }: { spec: DialogSpec; onClose: () => void }) {
  const uid = useId();
  const [values, setValues] = useState<Record<string, FieldValue>>(() => Object.fromEntries(spec.fields.map((f) => [f.name, f.defaultValue ?? (f.kind === 'checkbox' ? false : f.kind === 'select' ? (f.options?.[0]?.value ?? '') : '')])));
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: FieldValue) => setValues((s) => ({ ...s, [k]: v }));
  const confirm = () => {
    for (const f of spec.fields) {
      if (f.kind === 'checkbox') continue;
      const v = String(values[f.name] ?? '').trim();
      if (f.required && !v) { setErr(`${f.label}: this field is required.`); return; }
      if (v && f.minLength && v.length < f.minLength) { setErr(`${f.label}: enter at least ${f.minLength} characters.`); return; }
    }
    const out: Record<string, FieldValue> = {};
    for (const f of spec.fields) out[f.name] = typeof values[f.name] === 'string' ? String(values[f.name]).trim() : values[f.name];
    onClose();
    spec.onSubmit(out);
  };
  return (
    <div role="dialog" aria-modal="true" aria-label={spec.title} data-testid="mod-dialog" style={{ position: 'fixed', inset: 0, background: 'rgba(43,33,24,.35)', display: 'grid', placeItems: 'center', zIndex: 240 }}>
      <div style={{ background: '#FFFDF9', border: '1px solid #D8A646', borderRadius: 12, padding: 16, width: 'min(560px, 94vw)', display: 'grid', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{spec.title}</h2>
        <div style={{ fontSize: 13 }}>{spec.question}</div>
        {spec.fields.map((f) => {
          const id = `${uid}-${f.name}`;
          const v = values[f.name];
          return (
            <div key={f.name} style={{ display: 'grid', gap: 4 }}>
              {f.kind === 'checkbox' ? (
                <label htmlFor={id} style={{ fontSize: 13 }}><input id={id} type="checkbox" checked={!!v} onChange={(e) => set(f.name, e.target.checked)} /> {f.label}</label>
              ) : <label htmlFor={id} style={{ fontSize: 12, fontWeight: 600 }}>{f.label}</label>}
              {f.kind === 'textarea' && <textarea id={id} rows={3} value={String(v ?? '')} onChange={(e) => set(f.name, e.target.value)} />}
              {(f.kind === 'text' || f.kind === 'number' || f.kind === 'date') && <input id={id} type={f.kind} value={String(v ?? '')} onChange={(e) => set(f.name, e.target.value)} />}
              {f.kind === 'select' && <select id={id} value={String(v ?? '')} onChange={(e) => set(f.name, e.target.value)}>{(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}
              {f.hint && <div style={{ fontSize: 11, color: '#6b7280' }}>{f.hint}</div>}
            </div>
          );
        })}
        {err && <div role="alert" style={{ color: '#B85B4D', fontSize: 12 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" onClick={confirm} style={{ fontWeight: 700 }}>{spec.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ── loading + paging ───────────────────────────────────────────────────────────────────────────────────────────────────
export type Loaded<T> = T | 'failed' | null;
/** load on mount, whenever `deps` change and whenever `reloadKey` moves (after any write) */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], reloadKey: number): [Loaded<T>, string | null, () => void] {
  const [data, setData] = useState<Loaded<T>>(null);
  const [err, setErr] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(() => { let live = true; fn().then((d) => { if (live) { setData(d); setErr(null); } }).catch((e: any) => { if (live) { setData('failed'); setErr(e?.message || null); } }); return () => { live = false; }; }, deps);
  useEffect(() => load(), [load, reloadKey]);
  return [data, err, () => { load(); }];
}
export const items = <T,>(p: Loaded<ModPage<T>>): T[] => (p && p !== 'failed' && Array.isArray(p.items) ? p.items : []);

export function Pager({ page, data, onPage }: { page: number; data: Loaded<ModPage<unknown>>; onPage: (p: number) => void }) {
  if (!data || data === 'failed') return null;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }} data-testid="mod-pager">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous page</button>
      <span>Page {page} · {data.total} in all</span>
      <button type="button" disabled={!data.hasMore} onClick={() => onPage(page + 1)}>Next page</button>
    </div>
  );
}

export function Loading<T>({ data, err, empty, children }: { data: Loaded<T>; err?: string | null; empty?: boolean; children: (d: T) => ReactNode; }) {
  if (data === 'failed') return <div role="alert">{err || 'Could not load this.'}</div>;
  if (data === null) return <div>Loading…</div>;
  if (empty) return <div data-testid="mod-empty">Nothing here.</div>;
  return <>{children(data)}</>;
}

export const card: CSSProperties = { border: '1px solid #e5e1d8', borderRadius: 10, padding: 10 };
export const table: CSSProperties = { width: '100%', fontSize: 13, borderCollapse: 'collapse' };

// ── what every panel gets from the screen ──────────────────────────────────────────────────────────────────────────────
export type TabId =
  | 'overview' | 'review' | 'sensitive' | 'returned' | 'published' | 'removed' | 'postReports' | 'commentReports'
  | 'disputes' | 'appeals' | 'evidence' | 'cases' | 'case' | 'post' | 'salons' | 'audit' | 'analytics' | 'settings';
export interface ModCtx {
  canManage: boolean;
  reloadKey: number;
  /** open the action dialog */
  act: (spec: DialogSpec) => void;
  /** run a write: success → notice + every panel reloads; failure → plain words (a 409 reloads too) */
  run: (fn: () => Promise<unknown>, done: string, after?: (r: any) => void) => void;
  openPost: (id: string, caseId?: string | null) => void;
  openCase: (id: string) => void;
  goTab: (t: TabId) => void;
  /** the case the moderator is working (opened from Case detail) — actions run under it */
  activeCaseId: string | null;
}

/** The dialog for one post action — extra fields per action, reason always; runs under the case being worked. */
export function postActionDialog(p: Pick<ModPostView, 'id' | 'title' | 'version' | 'verificationLabel' | 'severity'>, action: ModPostAction, ctx: ModCtx): DialogSpec {
  const t = ACTION_TEXT[action];
  const extra: FieldSpec[] = [];
  if (action === 'publish' || action === 'restore' || action === 'set_label') extra.push({ name: 'label', label: 'Verification label', kind: 'select', options: opts(LABELS), defaultValue: p.verificationLabel });
  if (action === 'set_severity') extra.push({ name: 'severity', label: 'Severity', kind: 'select', options: opts(SEVERITIES), defaultValue: p.severity });
  if (action === 'reject' || action === 'request_changes' || action === 'request_evidence') extra.push({ name: 'messageToTenant', label: 'Message to the posting salon', kind: 'textarea', required: action !== 'reject', hint: 'The salon’s owner and approvers see this in the app.' });
  if (action === 'redact') extra.push(
    { name: 'field', label: 'Field', kind: 'select', options: opts(['body', 'title', 'recommendation', 'official_reference']) },
    { name: 'find', label: 'Text to replace', kind: 'text', required: true },
    { name: 'replaceWith', label: 'Replace with', kind: 'text', defaultValue: '[redacted]' },
  );
  if (action === 'merge_into' || action === 'link_related') extra.push({ name: 'targetPostId', label: action === 'merge_into' ? 'Merge into post (id)' : 'Related post (id)', kind: 'text', required: true });
  return {
    title: `${t.confirm}: ${p.title}`, question: t.question, confirmLabel: t.confirm, fields: [...extra, reasonField()],
    onSubmit: (v) => {
      const body: ModPostActionRequest = { action, reason: String(v.reason), expectedVersion: p.version };
      if (ctx.activeCaseId) body.caseId = ctx.activeCaseId;
      if (v.label) body.label = v.label as ModPostActionRequest['label'];
      if (v.severity) body.severity = v.severity as ModPostActionRequest['severity'];
      if (v.messageToTenant) body.messageToTenant = String(v.messageToTenant);
      if (action === 'redact') body.redactions = [{ field: v.field as 'body', find: String(v.find), replaceWith: String(v.replaceWith ?? '') }];
      if (v.targetPostId) body.targetPostId = String(v.targetPostId);
      ctx.run(() => modApi.postAction(p.id, body), `${t.confirm} — done for “${p.title}”.`);
    },
  };
}

