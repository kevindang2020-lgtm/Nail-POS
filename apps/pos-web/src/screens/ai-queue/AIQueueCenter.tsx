// AIQueueCenter.tsx — A6 AI Queue guide (Nov 4 2026): the three parts the page lacked.
//   AIQueueHealthDialog   "Check AI Queue System" (§9 Upgrade 1): one row per dependency — status, what was checked, the exact
//                         failure and the fix; the last recorded run shows first, Run check runs it again. Read-only.
//   AIQueueHistoryCard    §4: one search (customer, phone, queue entry, ticket, appointment, technician, recommendation id),
//                         decision + technician filters, Today · Yesterday · This Week · This Month · This Year · Custom (month
//                         calendar), numbered pages with 10 / 20 / 50 rows, newest first. Filters stay in the URL.
//   AIQueueEntryOverlay   §8 / Upgrade 2: the guest in tabs — Queue overview, Customer, Technician eligibility, AI
//                         recommendation, Assignment history, Appointments, Audit. Verified facts are kept apart from the AI's
//                         suggestion; nothing here changes an assignment (Assign Technician hands the guest to the panel,
//                         which assigns through the queue with its checks).
// Every word is a POS key (EN / VI); the server's numbers arrive as `facts` and are worded here.
import { useCallback, useEffect, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posAIQueueAssignmentApi as api, type AqHealthRun, type AqHealthCheck, type AqHealthStatus, type AqHistoryPage, type AqEntryDetail } from '../../api/posAIQueueAssignmentApi';
import type { QueueAssignmentPanel } from '@aipowersalon/api-contracts/tenant';
import { FitDialog, Pager } from '../../components/FitKit';
import { RangeCalendar } from '../../components/FinanceKit';
import { deviceToday } from '../../lib/deviceToday';
import { card, cardHead, input, btnGold, btnGhost, muted, errText, pill, when, errMsg, DECISION_LABEL, mins, pretty } from './aiQueueUi';
import { statusLabel } from '../../i18n/status-label';   // the code stays the truth; only its label is translated

type Roster = { technicianId: string; name: string }[];

const TONE: Record<AqHealthStatus, { bg: string; fg: string }> = {
  READY: { bg: '#E3F1E7', fg: '#2F6E43' }, ATTENTION_REQUIRED: { bg: '#FBEEDD', fg: '#9B6B1E' }, FAILED: { bg: '#F7DDD3', fg: '#B4451E' },
  DISABLED: { bg: '#EEE9E1', fg: '#6C6965' }, NOT_CONFIGURED: { bg: '#EEE9E1', fg: '#6C6965' }, UNKNOWN: { bg: '#F3ECE1', fg: '#8A6A3A' },
};
export const healthStatusLabel = (s: AqHealthStatus) => tx('growth.aiQueue.h.status.' + s);
function StatusPill({ s }: { s: AqHealthStatus }) { const c = TONE[s] ?? TONE.UNKNOWN; return <span style={pill(c.bg, c.fg)} data-testid={'aqh-status-' + s}>{healthStatusLabel(s)}</span>; }

/** one result in the POS language: the key's sentence for this status, filled with the server's numbers */
export function healthText(c: AqHealthCheck, part: 'evidence' | 'failure' | 'fix'): string | null {
  const facts = Object.fromEntries(Object.entries(c.facts ?? {}).map(([k, v]) => [k, String(v)]));
  if (c.status === 'UNKNOWN') return part === 'evidence' ? tx('growth.aiQueue.h.unknown.evidence') : part === 'fix' ? tx('growth.aiQueue.h.unknown.fix') : (c.failure ?? null);
  const key = `growth.aiQueue.h.${c.key}.${part}.${c.status}`;
  const s = tx(key, facts);
  if (s !== key) return s;
  if (part === 'evidence') { const k2 = `growth.aiQueue.h.${c.key}.evidence`; const s2 = tx(k2, facts); return s2 !== k2 ? s2 : c.evidence; }
  return null;
}

export function AIQueueHealthDialog({ onClose }: { onClose: () => void }) {
  const [run, setRun] = useState<AqHealthRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.lastHealth().then((r) => setRun(r.run)).catch(() => setRun(null)); }, []);
  const check = async () => { setBusy(true); setErr(null); try { setRun(await api.runHealth()); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  return (
    <FitDialog title={tx('growth.aiQueue.h.title')} subtitle={run ? <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><StatusPill s={run.overall} /><span style={muted}>{tx('growth.aiQueue.h.lastChecked', { at: when(run.checkedAt) })}</span></span> : null}
      onClose={onClose} busy={busy} wide testId="aq-health"
      footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button style={btnGold} onClick={check} disabled={busy} data-testid="aqh-run">{busy ? tx('growth.aiQueue.h.checking') : run ? tx('growth.aiQueue.h.runAgain') : tx('growth.aiQueue.h.run')}</button><button style={btnGhost} onClick={onClose}>{tx('pos.close')}</button></div>}>
      <p style={muted}>{tx('growth.aiQueue.h.readOnly')}</p>
      {err ? <div style={errText}>{err}</div> : null}
      {!run && !busy ? <div style={muted}>{tx('growth.aiQueue.h.never')}</div> : null}
      {run ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: 8 }}>
          {run.checks.map((c) => {
            const failure = healthText(c, 'failure'), fix = healthText(c, 'fix');
            return (
              <li key={c.key} data-testid={'aqh-' + c.key} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 13.5 }}>{tx('growth.aiQueue.h.' + c.key + '.label')}</strong><StatusPill s={c.status} />
                </div>
                <div style={{ fontSize: 13, marginTop: 4 }}>{healthText(c, 'evidence')}</div>
                {failure ? <div style={{ ...errText, marginTop: 4 }}>{failure}</div> : null}
                {fix ? <div style={{ fontSize: 12.5, marginTop: 4, color: '#4A4744' }}>{tx('growth.aiQueue.h.fix')}: {fix}</div> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </FitDialog>
  );
}

// ── history ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const PRESETS = ['all', 'today', 'yesterday', 'week', 'month', 'year'] as const;
const readUrl = () => { try { return new URLSearchParams(window.location.search); } catch { return new URLSearchParams(); } };
function writeUrl(f: Record<string, string | number | undefined>) {
  try {
    const p = new URLSearchParams(window.location.search);
    for (const k of ['aqq', 'aqd', 'aqt', 'aqp', 'aqf', 'aqto', 'aqpage', 'aqsize']) p.delete(k);
    for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '' && v !== null) p.set(k, String(v));
    const qs = p.toString(); window.history.replaceState(window.history.state, '', window.location.pathname + (qs ? '?' + qs : ''));
  } catch { /* no URL in this host */ }
}

export function AIQueueHistoryCard({ tick, roster, onOpen }: { tick: number; roster: Roster; onOpen: (queueEntryId: string) => void }) {
  const u = readUrl();
  const [q, setQ] = useState(u.get('aqq') ?? '');
  const [typed, setTyped] = useState(u.get('aqq') ?? '');
  const [decision, setDecision] = useState(u.get('aqd') ?? '');
  const [tech, setTech] = useState(u.get('aqt') ?? '');
  const [preset, setPreset] = useState(u.get('aqp') ?? 'all');
  const [range, setRange] = useState<{ from?: string; to?: string }>({ from: u.get('aqf') ?? undefined, to: u.get('aqto') ?? undefined });
  const [page, setPage] = useState(Number(u.get('aqpage')) || 1);
  const [size, setSize] = useState([10, 20, 50].includes(Number(u.get('aqsize'))) ? Number(u.get('aqsize')) : 20);
  const [cal, setCal] = useState(false);
  const [data, setData] = useState<AqHistoryPage | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { const h = setTimeout(() => { setQ(typed.trim()); setPage(1); }, 300); return () => clearTimeout(h); }, [typed]);
  useEffect(() => {
    let live = true;
    const f = { q: q || undefined, decision: decision || undefined, technicianId: tech || undefined, preset, from: preset === 'custom' ? range.from : undefined, to: preset === 'custom' ? range.to : undefined, page, pageSize: size };
    writeUrl({ aqq: f.q, aqd: f.decision, aqt: f.technicianId, aqp: preset === 'all' ? undefined : preset, aqf: f.from, aqto: f.to, aqpage: page > 1 ? page : undefined, aqsize: size !== 20 ? size : undefined });
    api.history(f).then((d) => { if (live) { setData(d && Array.isArray(d.items) ? d : null); setErr(d && Array.isArray(d.items) ? null : tx('growth.aiQueue.hist.loadFailed')); } }).catch((e) => { if (live) setErr(errMsg(e, tx('growth.aiQueue.hist.loadFailed'))); });
    return () => { live = false; };
  }, [q, decision, tech, preset, range.from, range.to, page, size, tick]);

  const filtered = !!(q || decision || tech || preset !== 'all');
  return (
    <section style={card} aria-label={tx('growth.aiQueue.hist.title')} data-testid="aq-history">
      <div style={cardHead}>{tx('growth.aiQueue.hist.title')}<span style={{ ...muted, fontWeight: 400 }}>{tx('growth.aiQueue.hist.newestFirst')}</span></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <input style={{ ...input, flex: '1 1 320px' }} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={tx('growth.aiQueue.hist.search')} aria-label={tx('growth.aiQueue.hist.search')} data-testid="aqh-search" />
        <select style={input} value={decision} onChange={(e) => { setDecision(e.target.value); setPage(1); }} aria-label={tx('growth.aiQueue.hist.decision')} data-testid="aqh-decision">
          <option value="">{tx('growth.aiQueue.hist.allDecisions')}</option>
          {Object.keys(DECISION_LABEL).map((k) => <option key={k} value={k}>{DECISION_LABEL[k]}</option>)}
        </select>
        <select style={input} value={tech} onChange={(e) => { setTech(e.target.value); setPage(1); }} aria-label={tx('glossary.people.technician')} data-testid="aqh-tech">
          <option value="">{tx('growth.aiQueue.hist.allTechs')}</option>
          {roster.map((r) => <option key={r.technicianId} value={r.technicianId}>{r.name}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, position: 'relative' }} role="group" aria-label={tx('growth.aiQueue.hist.period')}>
        {PRESETS.map((p) => <button key={p} type="button" style={{ ...btnGhost, ...(preset === p ? { background: '#F3E6D2', borderColor: '#D9B98A' } : {}) }} aria-pressed={preset === p} onClick={() => { setPreset(p); setCal(false); setPage(1); }} data-testid={'aqh-preset-' + p}>{tx('growth.aiQueue.hist.preset.' + p)}</button>)}
        <button type="button" style={{ ...btnGhost, ...(preset === 'custom' ? { background: '#F3E6D2', borderColor: '#D9B98A' } : {}) }} aria-pressed={preset === 'custom'} onClick={() => setCal((o) => !o)} data-testid="aqh-preset-custom">{tx('growth.aiQueue.hist.preset.custom')} ▾</button>
        {data?.period?.from ? <span style={muted} data-testid="aqh-active-period">{data.period.from === data.period.to ? data.period.from : `${data.period.from} → ${data.period.to}`}</span> : <span style={muted}>{tx('growth.aiQueue.hist.allTime')}</span>}
        {cal ? <div style={{ position: 'absolute', top: 38, left: 0, zIndex: 20 }}><RangeCalendar initial={range} today={data?.period?.today ?? deviceToday()}
          onApply={(r) => { setRange(r); setPreset('custom'); setCal(false); setPage(1); }} onCancel={() => setCal(false)} onClear={() => setRange({})} /></div> : null}
      </div>
      {err ? <div style={errText}>{err}</div> : null}
      {data && data.items.length === 0 ? <div style={muted} data-testid="aqh-empty">{filtered ? tx('growth.aiQueue.hist.noneFiltered') : tx('growth.aiQueue.hist.none')}</div> : null}
      {data && data.items.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} data-testid="aqh-table">
            <thead><tr style={{ textAlign: 'left', color: '#8A857E', fontSize: 12 }}>
              <th style={{ padding: '6px 8px' }}>{tx('growth.aiQueue.hist.col.when')}</th><th style={{ padding: '6px 8px' }}>{tx('growth.aiQueue.hist.col.guest')}</th>
              <th style={{ padding: '6px 8px' }}>{tx('growth.aiQueue.hist.col.decision')}</th><th style={{ padding: '6px 8px' }}>{tx('glossary.people.technician')}</th><th style={{ padding: '6px 8px' }}>{tx('growth.aiQueue.hist.col.reason')}</th>
            </tr></thead>
            <tbody>{data.items.map((r) => (
              <tr key={r.decisionId} style={{ borderTop: '1px solid var(--line)', cursor: 'pointer' }} onClick={() => onOpen(r.queueEntryId)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r.queueEntryId); }} data-testid="aqh-row">
                <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>{when(r.createdAt)}</td>
                <td style={{ padding: '7px 8px' }}>{r.customerName ?? '—'}{r.maskedPhone ? <span style={muted}> · {r.maskedPhone}</span> : null}</td>
                <td style={{ padding: '7px 8px' }}>{DECISION_LABEL[r.decision] ?? r.decision}</td>
                <td style={{ padding: '7px 8px' }}>{r.technicianName ?? '—'}{r.previousTechnicianName ? <span style={muted}> ({tx('growth.aiQueue.hist.was', { name: r.previousTechnicianName })})</span> : null}</td>
                <td style={{ padding: '7px 8px' }}>{r.reason ?? ''}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
        <Pager info={data} onPage={setPage} label={tx('growth.aiQueue.hist.title')} />
        <label style={muted}>{tx('growth.aiQueue.hist.rows')}{' '}<select style={input} value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(1); }} data-testid="aqh-size">{[10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      </div>
    </section>
  );
}

// ── guest overlay ─────────────────────────────────────────────────────────────────────────────────────────────────────
const TABS = ['overview', 'customer', 'technicians', 'ai', 'history', 'appointments', 'audit'] as const;
type Tab = typeof TABS[number];

export function AIQueueEntryOverlay({ queueEntryId, techName, onClose, onAssign, onViewBooking, startTab = 'overview' }: {
  queueEntryId: string; techName: (id: string | null | undefined) => string; onClose: () => void; onAssign?: (queueEntryId: string) => void; onViewBooking?: (appointmentId: string, date: string | null) => void; startTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(startTab);
  const [detail, setDetail] = useState<AqEntryDetail | null>(null);
  const [panel, setPanel] = useState<QueueAssignmentPanel | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    api.entryDetail(queueEntryId).then(setDetail).catch((e) => setErr(errMsg(e, tx('growth.aiQueue.err.guest'))));
    api.panel(queueEntryId).then(setPanel).catch(() => setPanel(null));   // a guest no longer in the live queue has no engine panel
  }, [queueEntryId]);
  useEffect(() => { load(); }, [load]);
  const active = detail ? ['waiting', 'called', 'assigned', 'ready_for_tech'].includes(detail.status) : false;
  const row = (label: string, value: React.ReactNode) => <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 32%) 1fr', gap: 8, padding: '5px 0', borderBottom: '1px solid #F1EAE0' }}><span style={muted}>{label}</span><span>{value ?? '—'}</span></div>;
  const reco = panel?.recommendation ?? null;
  return (
    <FitDialog title={detail?.customer.name ?? tx('pos.this_guest_2')} subtitle={detail ? <span style={muted}>{tx('growth.aiQueue.ov.entry', { id: queueEntryId.slice(0, 8) })}</span> : null} onClose={onClose} wide testId="aq-overlay"
      footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {detail?.appointmentId && onViewBooking ? <button style={btnGhost} onClick={() => onViewBooking(detail.appointmentId!, detail.appointments.find((a) => a.appointmentId === detail.appointmentId)?.date ?? null)} data-testid="aqo-booking">{tx('growth.aiQueue.ov.viewBooking')}</button> : null}
        <button style={btnGhost} onClick={() => setTab('history')} data-testid="aqo-review">{tx('growth.aiQueue.ov.reviewHistory')}</button>
        {active && onAssign ? <button style={btnGold} onClick={() => onAssign(queueEntryId)} data-testid="aqo-assign">{tx('growth.aiQueue.ov.assign')}</button> : null}
        <button style={btnGhost} onClick={onClose}>{tx('pos.close')}</button>
      </div>}>
      <div role="tablist" aria-label={tx('growth.aiQueue.ov.tabs')} style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
        {TABS.map((k) => <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} style={{ ...btnGhost, ...(tab === k ? { background: '#F3E6D2', borderColor: '#D9B98A' } : {}) }} data-testid={'aqo-tab-' + k}>{tx('growth.aiQueue.ov.tab.' + k)}</button>)}
      </div>
      {err ? <div style={errText}>{err}</div> : null}
      {!detail && !err ? <div style={muted}>{tx('pos.loading')}</div> : null}
      {detail ? <div role="tabpanel" data-testid={'aqo-panel-' + tab}>
        {tab === 'overview' ? <>
          {row(tx('growth.aiQueue.ov.status'), tx('growth.aiQueue.ov.st.' + detail.status) !== 'growth.aiQueue.ov.st.' + detail.status ? tx('growth.aiQueue.ov.st.' + detail.status) : detail.status)}
          {row(tx('growth.aiQueue.ov.checkedIn'), when(detail.checkedInAt))}
          {row(tx('growth.aiQueue.ov.wait'), mins(detail.waitMinutes))}
          {row(tx('growth.aiQueue.ov.services'), detail.requestedServices.map((s) => s.name).filter(Boolean).join(', ') || '—')}
          {row(tx('growth.aiQueue.ov.assigned'), detail.assignedTechnicianId ? techName(detail.assignedTechnicianId) : tx('pos.unassigned'))}
          {row(tx('growth.aiQueue.ov.vip'), detail.isVip ? tx('pos.yes') : tx('pos.no'))}
        </> : null}
        {tab === 'customer' ? <>
          <div style={{ ...muted, marginBottom: 6 }}>{tx('growth.aiQueue.ov.verified')}</div>
          {row(tx('growth.aiQueue.ov.name'), detail.customer.name)}
          {row(tx('growth.aiQueue.ov.phone'), detail.customer.maskedPhone)}
          {row(tx('growth.aiQueue.ov.customerId'), detail.customer.customerId ? detail.customer.customerId.slice(0, 8) : tx('growth.aiQueue.ov.walkIn'))}
          {row(tx('growth.aiQueue.ov.preferred'), detail.customer.preferredTechnicianId ? techName(detail.customer.preferredTechnicianId) : tx('growth.aiQueue.ov.noneOnRecord'))}
          {row(tx('growth.aiQueue.ov.visits'), String(detail.customer.paidVisits))}
          {row(tx('growth.aiQueue.ov.lastVisit'), when(detail.customer.lastVisitAt))}
        </> : null}
        {tab === 'technicians' ? (panel?.candidates?.length ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{[...panel.candidates].sort((a, b) => Number(b.eligible) - Number(a.eligible)).map((c) => (
            <li key={c.technicianId} style={{ padding: '6px 0', borderBottom: '1px solid #F1EAE0' }}><strong>{c.name}</strong> · {c.eligible ? tx('growth.aiQueue.ov.eligible') : tx('pos.not_eligible_2')}{!c.eligible && c.reasons?.length ? <span style={muted}> — {c.reasons.join(', ')}</span> : null}</li>
          ))}</ul>) : <div style={muted}>{tx('growth.aiQueue.ov.noCandidates')}</div>) : null}
        {tab === 'ai' ? (reco ? <>
          <div style={{ ...muted, marginBottom: 6 }}>{tx('growth.aiQueue.ov.suggestionOnly')}</div>
          {row(tx('growth.aiQueue.ov.suggested'), reco.recommended ? techName(reco.recommended.technicianId) : tx('growth.aiQueue.ov.noSuggestion'))}
          {/* §6: no confidence percentage — the engine's number is score separation, not a calibrated probability */}
          {row(tx('growth.aiQueue.ov.reasons'), reco.recommended?.reasons?.length ? reco.recommended.reasons.map(pretty).join(', ') : '—')}
          {row(tx('growth.aiQueue.ov.warnings'), reco.warnings?.length ? reco.warnings.map(pretty).join(', ') : '—')}
          {row(tx('growth.aiQueue.ov.conflicts'), reco.conflicts?.length ? reco.conflicts.map(pretty).join(', ') : '—')}
          {row(tx('growth.aiQueue.ov.generated'), when(reco.generatedAt))}
        </> : <div style={muted}>{tx('growth.aiQueue.ov.noSuggestion')}</div>) : null}
        {tab === 'history' ? (panel?.decisions?.length ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{panel.decisions.map((d) => (
            <li key={d.id} style={{ padding: '6px 0', borderBottom: '1px solid #F1EAE0' }}>{when(d.createdAt)} · <strong>{DECISION_LABEL[d.decision] ?? d.decision}</strong>{d.chosenTechnicianId ? ` · ${techName(d.chosenTechnicianId)}` : ''}{d.reason ? <span style={muted}> — {d.reason}</span> : null}</li>
          ))}</ul>) : <div style={muted}>{tx('growth.aiQueue.ov.noDecisions')}</div>) : null}
        {tab === 'appointments' ? (detail.appointments.length ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{detail.appointments.map((a) => (
            <li key={a.appointmentId} style={{ padding: '6px 0', borderBottom: '1px solid #F1EAE0', display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span>{when(a.startAt)} · {a.technicianName ?? '—'} · {tx('growth.aiQueue.ov.st.' + a.status) !== 'growth.aiQueue.ov.st.' + a.status ? tx('growth.aiQueue.ov.st.' + a.status) : a.status}</span>
              {onViewBooking ? <button style={btnGhost} onClick={() => onViewBooking(a.appointmentId, a.date)}>{tx('growth.aiQueue.ov.viewBooking')}</button> : null}
            </li>
          ))}</ul>) : <div style={muted}>{tx('growth.aiQueue.ov.noAppointments')}</div>) : null}
        {tab === 'audit' ? (detail.events.length ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{detail.events.map((e, i) => (
            <li key={i} style={{ padding: '6px 0', borderBottom: '1px solid #F1EAE0' }}>{when(e.occurredAt)} · <code style={{ fontSize: 12 }}>{statusLabel(['queueAction', 'state'], e.eventType)}</code> · {tx('growth.aiQueue.ov.delivery.' + e.deliveryStatus) !== 'growth.aiQueue.ov.delivery.' + e.deliveryStatus ? tx('growth.aiQueue.ov.delivery.' + e.deliveryStatus) : e.deliveryStatus}{e.attempts > 1 ? <span style={muted}> · {tx('growth.aiQueue.ov.attempts', { n: String(e.attempts) })}</span> : null}</li>
          ))}</ul>) : <div style={muted}>{tx('growth.aiQueue.ov.noEvents')}</div>) : null}
      </div> : null}
    </FitDialog>
  );
}
