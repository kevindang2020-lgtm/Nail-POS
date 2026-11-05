// PlatformAnnouncementsScreen.tsx — Super Admin › Communications › Platform Announcements (Super Admin POS Top-Bar
// Announcement & Platform Broadcast mandate, Oct 22 2026). Type a message, choose All Tenants / Selected Tenants / Selected
// Branches, preview it in a POS header at two desktop widths, publish now or schedule it, pause / resume / archive, and
// see the history (status filter + server-side search), every version and the delivery / dismiss / acknowledge counts.
// The server is the authority for every rule; this screen shows its answers (version conflicts, invalid audience, …).
// English + Vietnamese POS mandate WP-F (§56–§57): an optional Vietnamese title / message written by a person (this
// screen stays English), a "Vietnamese reviewed" tick (recorded per wording — any text edit clears it) or an explicit
// "English only", and a preview of what a Vietnamese POS shows. A critical notice needs one of the two to go live.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FiBell, FiMail, FiX } from 'react-icons/fi';   // §34: the icon library the POS header uses — no emoji in the preview
import type {
  PlatformAnnouncementRow, PlatformAnnouncementDetail, PlatformAnnouncementWriteRequest, PlatformAnnouncementTenantOption, PlatformAnnouncementBranchOption,
  PlatformAnnouncementTypeAdmin, PlatformAnnouncementPriorityAdmin, PlatformAnnouncementAudience,
} from '@aipowersalon/api-contracts/platform';
import { announcementText } from '@aipowersalon/api-contracts/tenant';
import { platformAnnouncementsApi as api } from '../api/superAdminPlatformAnnouncementsApi';
import { superAdminApi, type SystemStatusOverview } from '../api/superAdminApi';

const LINE = 'var(--line, #E9DAC4)';
const MUTED = 'var(--muted, #9B8B78)';
const TYPES: Array<{ id: PlatformAnnouncementTypeAdmin; label: string }> = [{ id: 'info', label: 'Info' }, { id: 'update', label: 'Update' }, { id: 'maintenance', label: 'Maintenance' }, { id: 'warning', label: 'Warning' }, { id: 'urgent', label: 'Urgent' }];
const PRIORITIES: Array<{ id: PlatformAnnouncementPriorityAdmin; label: string }> = [{ id: 'low', label: 'Low' }, { id: 'normal', label: 'Normal' }, { id: 'high', label: 'High' }, { id: 'critical', label: 'Critical' }];
const STATUSES = ['', 'active', 'scheduled', 'draft', 'paused', 'expired', 'archived'];
const STATUS_COLOR: Record<string, string> = { active: '#3E8F57', scheduled: '#3B6FB6', draft: '#9B8B78', paused: '#C08A2E', expired: '#6B7280', archived: '#6B7280' };
const TONE: Record<string, { bg: string; border: string; ink: string; accent: string }> = {
  info: { bg: '#FBF6EC', border: '#EADBBE', ink: '#5B4A2C', accent: '#B8925A' }, update: { bg: '#FBF6EC', border: '#EADBBE', ink: '#5B4A2C', accent: '#B8925A' },
  maintenance: { bg: '#FFF4DE', border: '#F0D49A', ink: '#6B4A14', accent: '#C98A12' }, warning: { bg: '#FFF4DE', border: '#F0D49A', ink: '#6B4A14', accent: '#C98A12' },
  urgent: { bg: '#FBE5E0', border: '#E9B5A8', ink: '#6E2410', accent: '#B4381E' },
};
const MAX = 2000;
const fmt = (v: string | null) => (v ? new Date(v).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : '—');
const toLocalInput = (v: string | null) => { if (!v) return ''; const d = new Date(v); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
const errText = (e: any, fallback: string) => (e?.code === 'STEP_UP_CANCELLED' ? 'Not changed — the confirmation was cancelled.' : e?.message || fallback);
const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', font: 'inherit', fontSize: 13, background: '#FFFEFB' };
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 16 };

type Draft = { id: string | null; version: number | null; title: string; message: string; type: PlatformAnnouncementTypeAdmin; priority: PlatformAnnouncementPriorityAdmin; audience: PlatformAnnouncementAudience;
  tenants: Array<{ id: string; name: string }>; branches: Array<{ id: string; name: string; tenantId: string; tenantName: string }>; startsAt: string; endsAt: string; dismissible: boolean; requiresAck: boolean;
  /** WP-F: the Vietnamese version; `viReviewed` is the tick on screen, `viReviewedSaved` what the server has (only a change is sent) */
  titleVi: string; messageVi: string; englishOnly: boolean; viReviewed: boolean; viReviewedSaved: boolean };
const EMPTY: Draft = { id: null, version: null, title: '', message: '', type: 'info', priority: 'normal', audience: 'all_tenants', tenants: [], branches: [], startsAt: '', endsAt: '', dismissible: true, requiresAck: false,
  titleVi: '', messageVi: '', englishOnly: false, viReviewed: false, viReviewedSaved: false };
const isCritical = (d: { type: string; priority: string }) => d.type === 'maintenance' || d.type === 'warning' || d.type === 'urgent' || d.priority === 'critical';
const VI_STATE: Record<string, { label: string; color: string }> = { none: { label: 'English', color: MUTED }, unreviewed: { label: 'VI not reviewed', color: '#C08A2E' }, reviewed: { label: 'EN + VI', color: '#3E8F57' }, english_only: { label: 'English only', color: '#6B7280' } };
const fromDetail = (d: PlatformAnnouncementDetail): Draft => ({
  id: d.id, version: d.version, title: d.title ?? '', message: d.message, type: d.type, priority: d.priority, audience: d.audience,
  tenants: d.audience === 'selected_tenants' ? d.targets.map((t) => ({ id: t.tenantId, name: t.tenantName ?? t.tenantId })) : [],
  branches: d.audience === 'selected_branches' ? d.targets.filter((t) => t.branchId).map((t) => ({ id: t.branchId!, name: t.branchName ?? t.branchId!, tenantId: t.tenantId, tenantName: t.tenantName ?? '' })) : [],
  startsAt: toLocalInput(d.startsAt), endsAt: toLocalInput(d.endsAt), dismissible: d.dismissible, requiresAck: d.requiresAcknowledgement,
  titleVi: d.titleVi ?? '', messageVi: d.messageVi ?? '', englishOnly: !!d.englishOnly, viReviewed: d.vietnamese === 'reviewed', viReviewedSaved: d.vietnamese === 'reviewed',
});
const toRequest = (d: Draft): PlatformAnnouncementWriteRequest => ({
  title: d.title.trim() || null, message: d.message, type: d.type, priority: d.priority, audience: d.audience,
  tenantIds: d.audience === 'selected_tenants' ? d.tenants.map((t) => t.id) : null, branchIds: d.audience === 'selected_branches' ? d.branches.map((b) => b.id) : null,
  startsAt: fromLocalInput(d.startsAt), endsAt: fromLocalInput(d.endsAt), dismissible: d.dismissible, requiresAcknowledgement: d.requiresAck, expectedVersion: d.version,
  titleVi: d.englishOnly ? null : d.titleVi.trim() || null, messageVi: d.englishOnly ? null : d.messageVi.trim() ? d.messageVi : null, englishOnly: d.englishOnly,
  ...(d.viReviewed !== d.viReviewedSaved ? { viReviewed: d.viReviewed } : {}),   // only a change: the server stamps the reviewer
});

/**
 * §84 (Oct 27 2026) — System Status may SUGGEST an announcement. An open incident or a scheduled maintenance window becomes a
 * prefilled DRAFT in the editor; nothing is saved or published until the Super Admin edits it and presses Save / Publish
 * themselves (the same audience, schedule, Vietnamese-review and step-up rules as every other notice). Pure → tested.
 */
export type StatusSuggestion = { key: string; label: string; draft: Partial<Draft> };
export function suggestionsFromStatus(o: Pick<SystemStatusOverview, 'activeIncidents' | 'scheduledMaintenance'> | null | undefined): StatusSuggestion[] {
  const out: StatusSuggestion[] = [];
  for (const i of o?.activeIncidents ?? []) {
    const sev = String(i.severity || '').toLowerCase();
    const type: PlatformAnnouncementTypeAdmin = sev === 'critical' ? 'urgent' : sev === 'high' ? 'warning' : 'maintenance';
    out.push({ key: `incident:${i.incidentId}`, label: `Incident · ${i.service} (${sev || 'unknown'})`, draft: {
      type, priority: sev === 'critical' ? 'critical' : sev === 'high' ? 'high' : 'normal', audience: 'all_tenants',
      title: `${i.service}`.slice(0, 120),
      message: `We are working on an issue affecting ${i.service}. Other parts of the POS keep working. We will update this message when it is resolved.`,
      dismissible: sev !== 'critical', requiresAck: false } });
  }
  for (const m of o?.scheduledMaintenance ?? []) {
    const at = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? v : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }); };
    out.push({ key: `maintenance:${m.service}:${m.windowStart}`, label: `Maintenance · ${m.service}`, draft: {
      type: 'maintenance', priority: 'normal', audience: 'all_tenants', title: 'Scheduled maintenance',
      message: `Scheduled maintenance of ${m.service}: ${at(m.windowStart)} – ${at(m.windowEnd)}. Some features may be briefly unavailable.`,
      dismissible: true, requiresAck: false } });
  }
  return out;
}

export function PlatformAnnouncementsScreen() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PlatformAnnouncementRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [detail, setDetail] = useState<PlatformAnnouncementDetail | null>(null);
  const [suggestions, setSuggestions] = useState<StatusSuggestion[] | null>(null);
  const suggest = async () => {
    try { setSuggestions(suggestionsFromStatus(await superAdminApi.systemStatusOverview())); setErr(null); }
    catch (e) { setSuggestions(null); setErr(errText(e, 'Could not read System Status.')); }
  };

  const load = useCallback(async () => {
    try { const r = await api.list({ status: status || undefined, q: q.trim() || undefined, page, pageSize: 25 }); setRows(r.items); setTotal(r.total); setErr(null); }
    catch (e) { setErr(errText(e, 'Could not load the announcements.')); }
  }, [status, q, page]);
  useEffect(() => { const h = setTimeout(() => { void load(); }, 250); return () => clearTimeout(h); }, [load]);

  const open = async (id: string) => {
    try { const d = await api.get(id); setDetail(d); setEditing(fromDetail(d)); setErr(null); } catch (e) { setErr(errText(e, 'Could not open the announcement.')); }
  };
  const done = async (d: PlatformAnnouncementDetail | null) => { if (d) { setDetail(d); setEditing(fromDetail(d)); } await load(); };

  return (
    <div style={{ padding: 20, display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div><h1 style={{ margin: 0, fontSize: 22 }}>Platform Announcements</h1><div style={{ color: MUTED, fontSize: 13 }}>Messages on every matching POS top bar, between Search and the clock — live, no refresh.</div></div>
        <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => { void suggest(); }}>Suggest from System Status</button>
        <button className="btn" onClick={() => { setDetail(null); setEditing({ ...EMPTY }); }}>New Announcement</button>
      </div>
      {suggestions ? (
        <div style={card} data-testid="status-suggestions">
          <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>Suggestions only — a suggestion opens as a draft; nothing is published until you review it and press Publish.</div>
          {suggestions.length === 0 ? <div style={{ fontSize: 13 }}>No open incidents or scheduled maintenance in System Status.</div> : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {suggestions.map((g) => <button key={g.key} className="btn sm ghost" onClick={() => { setDetail(null); setEditing({ ...EMPTY, ...g.draft }); setSuggestions(null); }}>{g.label}</button>)}
              <button className="btn sm ghost" onClick={() => setSuggestions(null)}>Close</button>
            </div>
          )}
        </div>
      ) : null}
      {err ? <div role="alert" style={{ color: '#B4381E', fontSize: 13 }}>{err}</div> : null}
      {editing ? <Editor draft={editing} setDraft={setEditing} detail={detail} onDone={done} onClose={() => { setEditing(null); setDetail(null); }} /> : null}
      <div style={card}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }} role="tablist" aria-label="Status">
          {STATUSES.map((s) => <button key={s || 'all'} role="tab" aria-selected={status === s} className={`btn sm ${status === s ? '' : 'ghost'}`} onClick={() => { setStatus(s); setPage(1); }}>{s ? s[0].toUpperCase() + s.slice(1) : 'All'}</button>)}
          <input aria-label="Search announcements" placeholder="Search message, title or salon…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} style={{ ...field, width: 280, marginLeft: 'auto' }} />
        </div>
        {rows === null ? <div style={{ color: MUTED }}>Loading…</div> : rows.length === 0 ? <div style={{ color: MUTED, padding: 12 }}>No announcements{status ? ` with status ${status}` : ''}.</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ textAlign: 'left', color: MUTED }}><th>Message</th><th>Type</th><th>Priority</th><th>Language</th><th>Audience</th><th>Status</th><th>Starts</th><th>Ends</th><th>Created by</th><th>Updated</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${LINE}`, cursor: 'pointer' }} onClick={() => open(r.id)}>
                  <td style={{ padding: '8px 6px', maxWidth: 420 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title ? <b>{r.title}: </b> : null}{r.message}</div></td>
                  <td>{r.type}</td><td>{r.priority}</td>
                  <td><span style={{ color: (VI_STATE[r.vietnamese] ?? VI_STATE.none).color, fontWeight: 600 }}>{(VI_STATE[r.vietnamese] ?? VI_STATE.none).label}</span></td>
                  <td>{r.audience === 'all_tenants' ? 'All tenants' : `${r.targetCount} ${r.audience === 'selected_tenants' ? 'salon' : 'branch'}${r.targetCount === 1 ? '' : r.audience === 'selected_tenants' ? 's' : 'es'}`}</td>
                  <td><span style={{ color: STATUS_COLOR[r.status], fontWeight: 700 }}>{r.status}</span></td>
                  <td>{fmt(r.startsAt)}</td><td>{fmt(r.endsAt)}</td>
                  <td data-testid="created-by">{r.createdByName ?? (r.createdBy ? r.createdBy.slice(0, 8) : '—')}</td><td>{fmt(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {total > 25 ? <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
          <button className="btn sm ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span style={{ color: MUTED, fontSize: 12, alignSelf: 'center' }}>Page {page} of {Math.ceil(total / 25)}</span>
          <button className="btn sm ghost" disabled={page >= Math.ceil(total / 25)} onClick={() => setPage(page + 1)}>Next</button>
        </div> : null}
      </div>
    </div>
  );
}

/** §118: the preview IS the POS header — salon, search, the announcement, clock, bell, mail, owner — at a real width. */
export function HeaderPreview({ d, width, language = 'en' }: { d: Draft; width: number; language?: 'en' | 'vi' }) {
  const tone = d.priority === 'critical' ? TONE.urgent : TONE[d.type] ?? TONE.info;
  // WP-F: exactly what a POS in this language shows — the Vietnamese version when one exists, else the English
  const shown = announcementText({ title: d.title.trim() || null, message: d.message, titleVi: d.englishOnly ? null : d.titleVi.trim() || null, messageVi: d.englishOnly ? null : d.messageVi.trim() || null }, language);
  const scale = Math.min(1, 640 / width);
  const longText = shown.message.length > 140;
  return (
    <div style={{ width: width * scale, overflow: 'hidden', border: `1px solid ${LINE}`, borderRadius: 10 }} data-testid={`preview-${width}${language === 'vi' ? '-vi' : ''}`} lang={shown.language}>
      <div style={{ width, transform: `scale(${scale})`, transformOrigin: 'top left', height: 64 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 64, padding: '0 20px', background: 'linear-gradient(180deg,#FFFDF9 0%,#FBF6EC 100%)', boxSizing: 'border-box' }}>
          <div style={{ flex: '0 0 auto', border: `1px solid ${LINE}`, borderRadius: 12, padding: '7px 10px', fontSize: 13, fontWeight: 700 }}>Pilot Nail Salon ▾</div>
          <div style={{ flex: '0 1 auto', minWidth: width <= 1366 ? 180 : 220, maxWidth: 460, width: width <= 1366 ? 220 : 340, border: '1px solid #ECE1CD', borderRadius: 14, padding: '9px 14px', color: '#B7A88F', fontSize: 14, background: '#FFFDF8' }}>Search anything…</div>
          <div style={{ flex: '1 1 0', minWidth: 0 }}>
            {shown.message.trim() ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px 5px 10px', border: `1px solid ${tone.border}`, borderLeft: `4px solid ${tone.accent}`, borderRadius: 10, background: tone.bg, color: tone.ink, fontSize: 12.5, lineHeight: 1.3 }}>
                <span style={{ flex: 1, minWidth: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{shown.title ? <b>{shown.title}: </b> : null}{shown.message}</span>
                {longText ? <span style={{ border: '1px solid currentColor', borderRadius: 8, padding: '3px 9px', fontWeight: 700, fontSize: 12 }}>More</span> : null}
                {d.requiresAck ? <span style={{ border: '1px solid currentColor', borderRadius: 8, padding: '3px 9px', fontWeight: 700, fontSize: 12, background: '#fff' }}>I understand</span> : d.dismissible ? <FiX size={14} aria-hidden /> : null}
              </div>
            ) : <div style={{ color: MUTED, fontSize: 12 }}>(the message appears here)</div>}
          </div>
          <div style={{ flex: '0 0 auto', textAlign: 'right', fontSize: 12, lineHeight: 1.2 }}><b>{new Date().toLocaleDateString([], { month: 'short', day: '2-digit', year: 'numeric' })}</b><br /><span style={{ color: MUTED }}>{new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
          <div style={{ flex: '0 0 auto', display: 'flex', gap: 8, color: '#8A6420' }} aria-hidden><FiBell size={16} />{width > 1366 ? <FiMail size={16} /> : null}</div>
          <div style={{ flex: '0 0 auto', fontSize: 12, fontWeight: 700 }}>OWNER</div>
        </div>
      </div>
    </div>
  );
}

function Editor({ draft: d, setDraft, detail, onDone, onClose }: { draft: Draft; setDraft: (d: Draft) => void; detail: PlatformAnnouncementDetail | null; onDone: (d: PlatformAnnouncementDetail | null) => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [highConfirmed, setHighConfirmed] = useState(false);
  const [when, setWhen] = useState<'now' | 'schedule'>(d.startsAt ? 'schedule' : 'now');
  const status = detail?.status ?? 'draft';
  const editable = status !== 'archived';
  const set = (p: Partial<Draft>) => setDraft({ ...d, ...p });
  const needsConfirm = d.audience === 'all_tenants' || d.priority === 'high' || d.priority === 'critical';
  const highPriority = d.priority === 'high' || d.priority === 'critical';
  const critical = isCritical(d);
  const hasVi = !d.englishOnly && !!d.messageVi.trim();
  // a review belongs to one wording: editing any text clears the tick (the server does the same)
  const setText = (p: Partial<Draft>) => set({ ...p, viReviewed: false });

  const run = async (fn: () => Promise<PlatformAnnouncementDetail>, ok: string) => {
    setBusy(true); setErr(null); setNote(null);
    try { const r = await fn(); await onDone(r); setNote(ok); setConfirming(false); setConfirmed(false); setHighConfirmed(false); }
    catch (e: any) { setErr(errText(e, 'That did not work.')); }
    finally { setBusy(false); }
  };
  const save = () => run(() => (d.id ? api.update(d.id, toRequest(d)) : api.create(toRequest(d))), d.id ? 'Saved.' : 'Saved as a draft — nothing is shown until you publish.');
  const publish = () => run(async () => {
    let cur = d;
    if (cur.id === null || status === 'draft') { const saved = cur.id ? await api.update(cur.id, toRequest(cur)) : await api.create(toRequest(cur)); cur = fromDetail(saved); }
    return api.publish(cur.id!, { expectedVersion: cur.version, publishNow: when === 'now', startsAt: when === 'schedule' ? fromLocalInput(d.startsAt) : null, confirm: needsConfirm ? confirmed && (!highPriority || highConfirmed) : null });
  }, when === 'now' ? 'Published — matching POS screens show it now.' : 'Scheduled — it appears at the start time.');

  return (
    <div style={{ ...card, display: 'grid', gap: 12 }} data-testid="announcement-editor">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>{d.id ? 'Announcement' : 'New Announcement'}</h2>
        {detail ? <span style={{ color: STATUS_COLOR[status], fontWeight: 700, fontSize: 13 }}>{status}</span> : null}
        {detail ? <span style={{ color: MUTED, fontSize: 12 }}>version {detail.version}</span> : null}
        <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 14 }}>
        <div style={{ display: 'grid', gap: 10 }}>
          <label style={{ fontSize: 12, color: MUTED }}>Title (optional)<input aria-label="Title" style={field} maxLength={120} value={d.title} disabled={!editable} onChange={(e) => setText({ title: e.target.value })} placeholder="e.g. Maintenance" /></label>
          <label style={{ fontSize: 12, color: MUTED }}>Message (plain text — line breaks are kept)
            <textarea aria-label="Message" style={{ ...field, minHeight: 110, resize: 'vertical' }} value={d.message} disabled={!editable} onChange={(e) => setText({ message: e.target.value })} />
            <span style={{ float: 'right', color: d.message.length > MAX ? '#B4381E' : MUTED }}>{d.message.length.toLocaleString()} / {MAX.toLocaleString()}</span>
          </label>
          <fieldset style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: 10, display: 'grid', gap: 8 }} disabled={!editable} data-testid="announcement-vietnamese">
            <legend style={{ fontSize: 12, color: MUTED }}>Vietnamese version (optional)</legend>
            <div style={{ fontSize: 11.5, color: MUTED }}>Shown on POS screens set to Vietnamese. Write it yourself — nothing is machine-translated. Without it, a Vietnamese POS shows the English.</div>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={d.englishOnly} onChange={(e) => set({ englishOnly: e.target.checked, ...(e.target.checked ? { titleVi: '', messageVi: '', viReviewed: false } : {}) })} /> English only (no Vietnamese version)</label>
            {!d.englishOnly ? (<>
              <label style={{ fontSize: 12, color: MUTED }}>Vietnamese title (optional)<input aria-label="Vietnamese title" lang="vi" style={field} maxLength={120} value={d.titleVi} onChange={(e) => setText({ titleVi: e.target.value })} /></label>
              <label style={{ fontSize: 12, color: MUTED }}>Vietnamese message
                <textarea aria-label="Vietnamese message" lang="vi" style={{ ...field, minHeight: 80, resize: 'vertical' }} value={d.messageVi} onChange={(e) => setText({ messageVi: e.target.value })} />
                <span style={{ float: 'right', color: d.messageVi.length > MAX ? '#B4381E' : MUTED }}>{d.messageVi.length.toLocaleString()} / {MAX.toLocaleString()}</span>
              </label>
              <label style={{ fontSize: 13 }}><input type="checkbox" checked={d.viReviewed} disabled={!hasVi} onChange={(e) => set({ viReviewed: e.target.checked })} /> Vietnamese reviewed — it says the same as the English</label>
            </>) : null}
            {critical && !d.englishOnly && !(hasVi && d.viReviewed) ? <div role="note" style={{ fontSize: 12, color: '#B4381E' }}>A Maintenance, Warning, Urgent or Critical announcement needs a reviewed Vietnamese version — or tick English only — before it can be published.</div> : null}
          </fieldset>
          <div style={{ display: 'flex', gap: 10 }}>
            <label style={{ fontSize: 12, color: MUTED, flex: 1 }}>Type<select aria-label="Type" style={field} value={d.type} disabled={!editable} onChange={(e) => { const type = e.target.value as Draft['type']; set({ type, ...(type === 'urgent' ? { dismissible: false } : {}) }); }}>{TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
            <label style={{ fontSize: 12, color: MUTED, flex: 1 }}>Priority<select aria-label="Priority" style={field} value={d.priority} disabled={!editable} onChange={(e) => { const priority = e.target.value as Draft['priority']; set({ priority, ...(priority === 'critical' ? { dismissible: false } : {}) }); }}>{PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
          </div>
          <fieldset style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: 10 }} disabled={!editable}>
            <legend style={{ fontSize: 12, color: MUTED }}>Audience</legend>
            {(['all_tenants', 'selected_tenants', 'selected_branches'] as const).map((a) => (
              <label key={a} style={{ marginRight: 14, fontSize: 13 }}><input type="radio" name="audience" checked={d.audience === a} onChange={() => set({ audience: a })} /> {a === 'all_tenants' ? 'All Tenants' : a === 'selected_tenants' ? 'Selected Tenants' : 'Selected Branches'}</label>
            ))}
            {d.audience !== 'all_tenants' ? <AudiencePicker d={d} set={set} /> : null}
          </fieldset>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, color: MUTED }}>Start<br />
              <label style={{ fontSize: 13, marginRight: 8 }}><input type="radio" name="when" checked={when === 'now'} onChange={() => { setWhen('now'); set({ startsAt: '' }); }} /> Publish now</label>
              <label style={{ fontSize: 13 }}><input type="radio" name="when" checked={when === 'schedule'} onChange={() => setWhen('schedule')} /> Schedule</label>
              {when === 'schedule' ? <input aria-label="Start time" type="datetime-local" style={{ ...field, marginTop: 4 }} value={d.startsAt} onChange={(e) => set({ startsAt: e.target.value })} /> : null}
            </label>
            <label style={{ fontSize: 12, color: MUTED }}>End {d.type === 'maintenance' ? '(required for maintenance)' : '(optional)'}<input aria-label="End time" type="datetime-local" style={field} value={d.endsAt} disabled={!editable} onChange={(e) => set({ endsAt: e.target.value })} /></label>
          </div>
          <div style={{ fontSize: 11.5, color: MUTED }}>Times are in your time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}); the server decides when it starts and ends.</div>
          <label style={{ fontSize: 13 }}><input type="checkbox" checked={d.dismissible} disabled={!editable} onChange={(e) => set({ dismissible: e.target.checked })} /> Staff may dismiss it</label>
          <label style={{ fontSize: 13 }}><input type="checkbox" checked={d.requiresAck} disabled={!editable} onChange={(e) => set({ requiresAck: e.target.checked })} /> Require "I understand" (recorded per employee)</label>
        </div>
        <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          <div style={{ fontSize: 12, color: MUTED }}>Desktop POS preview — 1920 wide</div>
          <HeaderPreview d={d} width={1920} />
          <div style={{ fontSize: 12, color: MUTED }}>Smaller desktop / laptop — 1366 wide</div>
          <HeaderPreview d={d} width={1366} />
          <div style={{ fontSize: 12, color: MUTED }}>Vietnamese POS preview — 1920 wide{hasVi ? '' : ' (no Vietnamese version — a Vietnamese POS shows the English)'}</div>
          <HeaderPreview d={d} width={1920} language="vi" />
          <div style={{ fontSize: 11.5, color: MUTED }}>Preview only — nothing is published from here.</div>
          {detail ? <div style={{ fontSize: 12.5 }}>Delivered to {detail.stats.delivered} employee{detail.stats.delivered === 1 ? '' : 's'} in {detail.stats.tenantsReached} salon{detail.stats.tenantsReached === 1 ? '' : 's'} · {detail.stats.dismissed} dismissed · {detail.stats.acknowledged} acknowledged</div> : null}
        </div>
      </div>

      {err ? <div role="alert" style={{ color: '#B4381E', fontSize: 13 }}>{err}</div> : null}
      {note ? <div role="status" style={{ color: '#3E8F57', fontSize: 13 }}>{note}</div> : null}

      {confirming ? (
        <div style={{ border: '1px solid #F0D49A', background: '#FFF8EA', borderRadius: 10, padding: 12, display: 'grid', gap: 8 }} data-testid="publish-confirm">
          <b>Confirm before publishing</b>
          {d.audience === 'all_tenants' ? <label style={{ fontSize: 13 }}><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I checked the preview — this goes to every salon's POS.</label> : <label style={{ fontSize: 13 }}><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I checked the preview and the audience.</label>}
          {highPriority ? <label style={{ fontSize: 13 }}><input type="checkbox" checked={highConfirmed} onChange={(e) => setHighConfirmed(e.target.checked)} /> This is a {d.priority} message — it stays pinned on the POS.</label> : null}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" disabled={busy || !confirmed || (highPriority && !highConfirmed)} onClick={publish}>{when === 'now' ? 'Publish now' : 'Schedule'}</button>
            <button className="btn ghost" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {editable ? <button className="btn ghost" disabled={busy} onClick={save}>{d.id ? 'Save changes' : 'Save draft'}</button> : null}
        {status === 'draft' ? <button className="btn" disabled={busy} onClick={() => (needsConfirm ? setConfirming(true) : publish())}>{when === 'now' ? 'Publish now' : 'Schedule'}</button> : null}
        {(status === 'active' || status === 'scheduled') && detail ? <button className="btn ghost" disabled={busy} onClick={() => run(() => api.pause(detail.id, detail.version), 'Paused — removed from every POS.')}>Pause</button> : null}
        {status === 'paused' && detail ? <button className="btn" disabled={busy} onClick={() => run(() => api.resume(detail.id, detail.version), 'Resumed.')}>Resume</button> : null}
        {detail && status !== 'archived' ? <button className="btn ghost" disabled={busy} onClick={() => run(() => api.archive(detail.id, detail.version), 'Archived — kept in history.')}>Archive</button> : null}
        {detail ? <button className="btn ghost" disabled={busy} onClick={() => run(() => api.duplicate(detail.id), 'Copied into a new draft.')}>Duplicate to draft</button> : null}
      </div>

      {detail?.revisions.length ? (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 13 }}>Version history ({detail.revisions.length})</summary>
          <ul style={{ fontSize: 12.5, margin: '8px 0 0', paddingLeft: 18 }}>
            {detail.revisions.map((r) => <li key={r.version}>v{r.version} · {r.action} · {fmt(r.at)}{r.actorId ? ` · ${r.actorId.slice(0, 8)}` : ''}</li>)}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** §53–§55: salons from a server-side searchable, paged list; branches from the chosen salon's branch rows. */
function AudiencePicker({ d, set }: { d: Draft; set: (p: Partial<Draft>) => void }) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<PlatformAnnouncementTenantOption[]>([]);
  const [tenant, setTenant] = useState<PlatformAnnouncementTenantOption | null>(null);
  const [branches, setBranches] = useState<PlatformAnnouncementBranchOption[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const h = setTimeout(() => { api.tenants({ q: q.trim() || undefined, pageSize: 10 }).then((r) => { setOpts(r.items); setErr(null); }).catch((e) => setErr(errText(e, 'Could not search salons.'))); }, 250);
    return () => clearTimeout(h);
  }, [q]);
  useEffect(() => { if (!tenant) { setBranches([]); return; } api.branches(tenant.id).then(setBranches).catch((e) => setErr(errText(e, 'Could not load branches.'))); }, [tenant]);
  const selected = useMemo(() => new Set(d.audience === 'selected_tenants' ? d.tenants.map((t) => t.id) : d.branches.map((b) => b.id)), [d]);
  return (
    <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
      <input aria-label="Search salons" placeholder="Search salons by name or code…" style={field} value={q} onChange={(e) => setQ(e.target.value)} />
      {err ? <div role="alert" style={{ color: '#B4381E', fontSize: 12 }}>{err}</div> : null}
      <div style={{ maxHeight: 160, overflowY: 'auto', border: `1px solid ${LINE}`, borderRadius: 8 }}>
        {opts.map((t) => d.audience === 'selected_tenants' ? (
          <label key={t.id} style={{ display: 'flex', gap: 6, padding: '5px 8px', fontSize: 13 }}>
            <input type="checkbox" checked={selected.has(t.id)} onChange={(e) => set({ tenants: e.target.checked ? [...d.tenants, { id: t.id, name: t.name }] : d.tenants.filter((x) => x.id !== t.id) })} />
            {t.name} <span style={{ color: MUTED }}>{t.code ?? ''} · {t.branches} branch{t.branches === 1 ? '' : 'es'}</span>
          </label>
        ) : (
          <button key={t.id} type="button" onClick={() => setTenant(t)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', border: 0, background: tenant?.id === t.id ? '#FBF6EC' : 'transparent', cursor: 'pointer', fontSize: 13 }}>{t.name} <span style={{ color: MUTED }}>{t.code ?? ''}</span></button>
        ))}
      </div>
      {d.audience === 'selected_branches' && tenant ? (
        <div style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: 6 }}>
          <div style={{ fontSize: 12, color: MUTED }}>Branches of {tenant.name}</div>
          {branches.map((b) => (
            <label key={b.id} style={{ display: 'flex', gap: 6, padding: '3px 4px', fontSize: 13 }}>
              <input type="checkbox" checked={selected.has(b.id)} onChange={(e) => set({ branches: e.target.checked ? [...d.branches, { id: b.id, name: b.name, tenantId: tenant.id, tenantName: tenant.name }] : d.branches.filter((x) => x.id !== b.id) })} />
              {b.name} <span style={{ color: MUTED }}>{b.status}</span>
            </label>
          ))}
        </div>
      ) : null}
      <div style={{ fontSize: 12.5 }}>
        {d.audience === 'selected_tenants' ? `${d.tenants.length} salon${d.tenants.length === 1 ? '' : 's'} chosen` : `${d.branches.length} branch${d.branches.length === 1 ? '' : 'es'} chosen`}
        {(d.audience === 'selected_tenants' ? d.tenants.map((t) => t.name) : d.branches.map((b) => `${b.tenantName} › ${b.name}`)).slice(0, 6).map((n) => <span key={n} style={{ marginLeft: 6, padding: '1px 6px', border: `1px solid ${LINE}`, borderRadius: 10 }}>{n}</span>)}
      </div>
    </div>
  );
}
