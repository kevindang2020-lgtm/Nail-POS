// POSAIBookingScreen.tsx — A7 AI Booking Assistant guide (Nov 4 2026). /tenant/ai/booking keeps the add-on header (one honest
// package state — price, usage, trial, Cancelled / Off; AiPackagePanel) and adds the operations center below it, read from the
// EXISTING booking records (no second booking system):
//   • header actions: Open POS Booking · Check AI Booking System · Refresh
//   • operations counts for a period (Today · This Week · This Month · This Year · Custom) with their definitions
//   • recovery cases (failed requests, expiring / expired holds, failed codes, AI appointments not yet confirmed): Open POS
//     Booking, Prepare Message (a draft to copy — never sent), View Failure History, Dismiss (reason, audited)
//   • request activity: one search, status / source / technician filters, a date basis, numbered pages (10 / 20 / 50)
//   • the request overlay in tabs: Overview · Customer · Services & technicians · AI recommendation · Execution ·
//     Verification · Communications · Audit — never a verification code, the phone masked.
// "AI said booked", "pending appointment exists" and "confirmed appointment exists" are shown as different statuses.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { AiPackagePanel } from './POSAiPackageScreen';
import { FitDialog, Pager } from '../components/FitKit';
import { RangeCalendar } from '../components/FinanceKit';
import { deviceToday } from '../lib/deviceToday';
import { fmtInZone } from '../i18n/format';
import { money } from './reportsCommon';
import { posAiBookingCenterApi as api, type AibOverview, type AibActivityPage, type AibRequestDetail, type AibRecoveryList, type AibRecoveryCase, type AibAlternatives, type AibHealthRun, type AibHealthCheck, type AibHealthStatus } from '../api/posAiBookingCenterApi';

const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const errOf = (e: unknown) => (e instanceof Error && e.message ? e.message : t('pos.something_went_wrong'));
const word = (prefix: string, code: string | null | undefined) => { if (!code) return '—'; const k = prefix + code; const s = t(k); return s !== k ? s : code; };
const TONE: Record<AibHealthStatus, { bg: string; fg: string }> = { READY: { bg: '#E3F1E7', fg: '#2F6E43' }, ATTENTION_REQUIRED: { bg: '#FBEEDD', fg: '#9B6B1E' }, FAILED: { bg: '#F7DDD3', fg: '#B4451E' },
  DISABLED: { bg: '#EEE9E1', fg: '#6C6965' }, NOT_CONFIGURED: { bg: '#EEE9E1', fg: '#6C6965' }, UNKNOWN: { bg: '#F3ECE1', fg: '#8A6A3A' } };
const STATUS_TONE: Record<string, string> = { confirmed: '#2F6E43', pending_confirmation: '#9B6B1E', pending_verification: '#9B6B1E', failed: '#B4451E', cancelled: '#6C6965', abandoned: '#6C6965', handed_off: '#3C7FB6', prepared: '#6E59C7', requested: '#6C6965' };
const pill = (bg: string, fg: string): React.CSSProperties => ({ background: bg, color: fg, fontSize: 11.5, fontWeight: 700, padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap' });
const STATUSES = ['requested', 'prepared', 'pending_verification', 'pending_confirmation', 'confirmed', 'failed', 'cancelled', 'abandoned', 'handed_off'];
const SOURCES = ['AI_PHONE_RECEPTIONIST', 'FRONT_DESK_POS', 'CUSTOMER_MOBILE_APP', 'ONLINE_BOOKING', 'PARTNER_BOOKING_LINK', 'WALK_IN_CONVERSION'];
const PRESETS = ['today', 'week', 'month', 'year'] as const;

function StatusPill({ s }: { s: AibHealthStatus }) { const c = TONE[s] ?? TONE.UNKNOWN; return <span style={pill(c.bg, c.fg)} data-testid={'bkh-status-' + s}>{t('growth.aiBooking.h.status.' + s)}</span>; }
function healthText(c: AibHealthCheck, part: 'evidence' | 'failure' | 'fix'): string | null {
  const facts = Object.fromEntries(Object.entries(c.facts ?? {}).map(([k, v]) => [k, String(v)]));
  if (c.status === 'UNKNOWN') return part === 'evidence' ? t('growth.aiBooking.h.unknown.evidence') : part === 'fix' ? t('growth.aiBooking.h.unknown.fix') : null;
  const k1 = `growth.aiBooking.h.${c.key}.${part}.${c.status}`; const s1 = t(k1, facts); if (s1 !== k1) return s1;
  if (part === 'evidence') { const k2 = `growth.aiBooking.h.${c.key}.evidence`; const s2 = t(k2, facts); return s2 !== k2 ? s2 : c.evidence; }
  return null;
}

export function POSAIBookingScreen() {
  const nav = useNavigate();
  const [tick, setTick] = useState(0);
  const [health, setHealth] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const bump = () => setTick((x) => x + 1);
  const toBooking = (date?: string | null) => nav('/booking' + (date ? '?date=' + encodeURIComponent(date) : ''));
  return (
    <AiPackagePanel code="ai_booking_assistant" title={t('pos.ai_booking_assistant')} actionsSlot={<>
      <button type="button" className="btn ghost" onClick={() => toBooking()} data-testid="bk-open-booking">{t('growth.aiBooking.openBooking')}</button>
      <button type="button" className="btn ghost" onClick={() => setHealth(true)} data-testid="bk-check">{t('growth.aiBooking.h.title')}</button>
      <button type="button" className="btn ghost" onClick={bump} data-testid="bk-refresh">{t('pos.refresh')}</button>
    </>}>
      <BookingOps tick={tick} />
      <RecoveryCard tick={tick} onOpen={setOpen} onBooking={toBooking} onChanged={bump} />
      <ActivityCard tick={tick} onOpen={setOpen} />
      {health ? <HealthDialog onClose={() => setHealth(false)} /> : null}
      {open ? <RequestOverlay requestId={open} onClose={() => setOpen(null)} onBooking={toBooking} onCustomer={(id) => nav('/customers?customerId=' + encodeURIComponent(id))} /> : null}
    </AiPackagePanel>
  );
}

function BookingOps({ tick }: { tick: number }) {
  const [preset, setPreset] = useState<string>('month');
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [cal, setCal] = useState(false);
  const [o, setO] = useState<AibOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let live = true; api.overview({ preset, from: preset === 'custom' ? range.from : undefined, to: preset === 'custom' ? range.to : undefined }).then((d) => { if (live) { setO(d); setErr(null); } }).catch((e) => { if (live) setErr(errOf(e)); }); return () => { live = false; }; }, [preset, range.from, range.to, tick]);
  const k = (label: string, v: number | undefined, hint?: string) => <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{label}</div><div className="v">{o ? String(v ?? 0) : '—'}</div>{hint ? <div className="sub">{hint}</div> : null}</div>;
  return (
    <section className="panel" style={{ marginTop: 16 }} aria-label={t('growth.aiBooking.ops.title')} data-testid="bk-ops">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', position: 'relative' }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>{t('growth.aiBooking.ops.title')}</h2>
        <div className="fk-seg" role="group" aria-label={t('growth.aiBooking.period')}>
          {PRESETS.map((p) => <button key={p} type="button" className={preset === p ? 'on' : ''} aria-pressed={preset === p} onClick={() => { setPreset(p); setCal(false); }} data-testid={'bk-preset-' + p}>{t('finance.period.' + p)}</button>)}
          <button type="button" className={preset === 'custom' ? 'on' : ''} aria-pressed={preset === 'custom'} onClick={() => setCal((x) => !x)} data-testid="bk-preset-custom">{t('finance.period.custom')} ▾</button>
        </div>
        {cal ? <div style={{ position: 'absolute', right: 0, top: 40, zIndex: 20 }}><RangeCalendar initial={range} today={o?.period.today ?? deviceToday()} onApply={(r) => { setRange(r); setPreset('custom'); setCal(false); }} onCancel={() => setCal(false)} onClear={() => setRange({})} /></div> : null}
      </div>
      {o?.period.from ? <div className="sub" style={{ marginTop: 4 }} data-testid="bk-period">{o.period.from === o.period.to ? o.period.from : `${o.period.from} → ${o.period.to}`}</div> : null}
      {err ? <div className="err" style={{ marginTop: 8 }}>{err}</div> : null}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2.5 mt-3">
        {k(t('growth.aiBooking.ops.requests'), o?.requests, t('growth.aiBooking.ops.requestsHint'))}
        {k(t('growth.aiBooking.ops.prepared'), o?.prepared)}
        {k(t('growth.aiBooking.ops.pendingVerification'), o?.pendingVerification)}
        {k(t('growth.aiBooking.ops.pendingConfirmation'), o?.pendingConfirmation, t('growth.aiBooking.ops.pendingConfirmationHint'))}
        {k(t('growth.aiBooking.ops.confirmed'), o?.confirmed, t('growth.aiBooking.ops.confirmedHint'))}
        {k(t('growth.aiBooking.ops.failed'), o?.failed)}
        {k(t('growth.aiBooking.ops.liveHolds'), o?.liveHolds, t('growth.aiBooking.ops.holdsHint'))}
        {k(t('growth.aiBooking.ops.expiredHolds'), o?.expiredHolds, t('growth.aiBooking.ops.holdsHint'))}
      </div>
    </section>
  );
}

/** a draft for staff to copy — the assistant never sends it */
function draftFor(c: AibRecoveryCase): string {
  const name = c.customerName ? c.customerName.split(' ')[0] : '';
  return t('growth.aiBooking.rec.draft.' + (c.type.startsWith('hold') ? 'hold' : c.type === 'unconfirmed_appointment' ? 'confirm' : 'failed'), { name, date: c.date ?? '' });
}

function RecoveryCard({ tick, onOpen, onBooking, onChanged }: { tick: number; onOpen: (id: string) => void; onBooking: (date?: string | null) => void; onChanged: () => void }) {
  const [d, setD] = useState<AibRecoveryList | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ key: string; text: string } | null>(null);
  const [dismiss, setDismiss] = useState<{ key: string; reason: string } | null>(null);
  const [alt, setAlt] = useState<{ key: string; data: AibAlternatives | null; err: string | null } | null>(null);
  const [ask, setAsk] = useState<{ key: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  // guide §10 Review Alternative: POS Booking's own open times for the case day — suggestions only
  const review = (key: string) => { setAlt({ key, data: null, err: null }); api.alternatives(key).then((x) => setAlt({ key, data: x, err: null })).catch((e) => setAlt({ key, data: null, err: errOf(e) })); };
  const doAsk = async () => {
    if (!ask || ask.reason.trim().length < 3) return;
    setBusy(true);
    try { await api.requestApproval(ask.key, ask.reason.trim()); setAsk(null); setSent(ask.key); onChanged(); } catch (e) { setErr(errOf(e)); } finally { setBusy(false); }
  };
  useEffect(() => { api.recovery().then((x) => { setD(x); setErr(null); }).catch((e) => setErr(errOf(e))); }, [tick]);
  const doDismiss = async () => {
    if (!dismiss?.reason.trim()) return;
    setBusy(true);
    try { await api.dismiss(dismiss.key, dismiss.reason.trim()); setDismiss(null); onChanged(); } catch (e) { setErr(errOf(e)); } finally { setBusy(false); }
  };
  return (
    <section className="panel" style={{ marginTop: 14 }} aria-label={t('growth.aiBooking.rec.title')} data-testid="bk-recovery">
      <h2 style={{ fontSize: 15, margin: '0 0 4px' }}>{t('growth.aiBooking.rec.title')}</h2>
      <div className="sub">{t('growth.aiBooking.rec.note')}</div>
      {err ? <div className="err" style={{ marginTop: 8 }}>{err}</div> : null}
      {d && !d.cases.length ? <div className="sub" style={{ marginTop: 8 }} data-testid="bk-rec-empty">{t('growth.aiBooking.rec.none')}</div> : null}
      <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: 8 }}>
        {(d?.cases ?? []).map((c) => (
          <li key={c.key} data-testid="bk-rec-case" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={pill(c.urgency === 'high' ? '#F7DDD3' : '#FBEEDD', c.urgency === 'high' ? '#B4451E' : '#9B6B1E')}>{t('growth.aiBooking.rec.urgency.' + c.urgency)}</span>
              <strong>{word('growth.aiBooking.rec.type.', c.type)}</strong>
              <span className="sub">{c.customerName ?? ''}{c.maskedPhone ? ` · ${c.maskedPhone}` : ''}{c.date ? ` · ${c.date}` : ''} · {when(c.at)}</span>
            </div>
            {c.reason ? <div className="sub" style={{ marginTop: 4 }}>{t('growth.aiBooking.rec.why')}: {word('growth.aiBooking.reason.', c.reason)}</div> : null}
            <div className="sub" style={{ marginTop: 4 }}>{t('growth.aiBooking.rec.next.' + (c.type.startsWith('hold') ? 'hold' : c.type === 'unconfirmed_appointment' ? 'confirm' : c.type.startsWith('verification') ? 'verify' : 'failed'))}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              <button type="button" className="btn ghost" onClick={() => onBooking(c.date)}>{t('growth.aiBooking.openBooking')}</button>
              <button type="button" className="btn ghost" onClick={() => setDraft({ key: c.key, text: draftFor(c) })} data-testid="bk-rec-draft">{t('growth.aiBooking.rec.prepare')}</button>
              {c.requestId ? <button type="button" className="btn ghost" onClick={() => onOpen(c.requestId!)}>{t('growth.aiBooking.rec.history')}</button> : null}
              <button type="button" className="btn ghost" onClick={() => review(c.key)} data-testid="bk-rec-alternatives">{t('growth.aiBooking.rec.review')}</button>
              {c.approval && (c.approval.status === 'pending' || c.approval.status === 'approved') ? null
                : <button type="button" className="btn ghost" onClick={() => setAsk({ key: c.key, reason: '' })} data-testid="bk-rec-approval">{t('growth.aiBooking.rec.askManager')}</button>}
              <button type="button" className="btn ghost" onClick={() => setDismiss({ key: c.key, reason: '' })} data-testid="bk-rec-dismiss">{t('growth.aiBooking.rec.dismiss')}</button>
            </div>
            {c.approval ? <div className="sub" style={{ marginTop: 6 }} data-testid="bk-rec-approval-state">{t('growth.aiBooking.rec.approvalState', { s: word('growth.aiBooking.rec.approvalStatus.', c.approval.status) })}</div>
              : sent === c.key ? <div className="sub" style={{ marginTop: 6 }}>{t('growth.aiBooking.rec.approvalSent')}</div> : null}
            {alt?.key === c.key ? <div style={{ marginTop: 8, border: '1px dashed var(--line)', borderRadius: 8, padding: 8 }} data-testid="bk-rec-alt">
              {alt.err ? <div className="err">{alt.err}</div> : !alt.data ? <div className="sub">{t('pos.loading')}</div> : <>
                <div className="sub">{t('growth.aiBooking.rec.altFor', { date: alt.data.date })}</div>
                {alt.data.alternatives.length ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {alt.data.alternatives.map((x) => <button key={x.technicianId + x.start} type="button" className="btn ghost" onClick={() => onBooking(alt.data!.date)} data-testid="bk-rec-alt-slot" title={t('growth.aiBooking.rec.altOpen')}>
                    {x.start} · {x.technicianName}{x.preferred ? ` · ${t('growth.aiBooking.rec.altSameTech')}` : ''}</button>)}
                </div> : null}
                {alt.data.note ? <div className="sub" style={{ marginTop: 6 }}>{word('growth.aiBooking.rec.altNote.', alt.data.alternatives.length ? 'default_length' : 'none')}</div> : null}
                <div className="sub" style={{ marginTop: 6 }}>{t('growth.aiBooking.rec.altSafety')}</div>
              </>}
            </div> : null}
            {ask?.key === c.key ? <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <input value={ask.reason} onChange={(e) => setAsk({ key: c.key, reason: e.target.value })} placeholder={t('growth.aiBooking.rec.askWhat')} aria-label={t('growth.aiBooking.rec.askWhat')} style={{ flex: '1 1 260px', height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px' }} data-testid="bk-rec-approval-why" />
              <button type="button" className="btn" disabled={busy || ask.reason.trim().length < 3} onClick={() => void doAsk()} data-testid="bk-rec-approval-go">{t('growth.aiBooking.rec.askManager')}</button>
              <button type="button" className="btn ghost" onClick={() => setAsk(null)}>{t('pos.cancel')}</button>
            </div> : null}
            {draft?.key === c.key ? <div style={{ marginTop: 8 }}>
              <textarea aria-label={t('growth.aiBooking.rec.prepare')} value={draft.text} onChange={(e) => setDraft({ key: c.key, text: e.target.value })} rows={3} style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: 8, fontFamily: 'inherit' }} data-testid="bk-rec-draft-text" />
              <div className="sub">{t('growth.aiBooking.rec.draftNote')}</div>
            </div> : null}
            {dismiss?.key === c.key ? <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <input value={dismiss.reason} onChange={(e) => setDismiss({ key: c.key, reason: e.target.value })} placeholder={t('growth.aiBooking.rec.dismissWhy')} aria-label={t('growth.aiBooking.rec.dismissWhy')} style={{ flex: '1 1 260px', height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px' }} data-testid="bk-rec-dismiss-why" />
              <button type="button" className="btn" disabled={busy || !dismiss.reason.trim()} onClick={() => void doDismiss()} data-testid="bk-rec-dismiss-go">{t('growth.aiBooking.rec.dismiss')}</button>
              <button type="button" className="btn ghost" onClick={() => setDismiss(null)}>{t('pos.cancel')}</button>
            </div> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActivityCard({ tick, onOpen }: { tick: number; onOpen: (id: string) => void }) {
  const [typed, setTyped] = useState(''); const [q, setQ] = useState('');
  const [status, setStatus] = useState(''); const [source, setSource] = useState(''); const [basis, setBasis] = useState('requested');
  const [preset, setPreset] = useState('all'); const [range, setRange] = useState<{ from?: string; to?: string }>({}); const [cal, setCal] = useState(false);
  const [page, setPage] = useState(1); const [size, setSize] = useState(20);
  const [d, setD] = useState<AibActivityPage | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const h = setTimeout(() => { setQ(typed.trim()); setPage(1); }, 300); return () => clearTimeout(h); }, [typed]);
  useEffect(() => {
    let live = true;
    api.activity({ q: q || undefined, status: status || undefined, source: source || undefined, basis, preset, from: preset === 'custom' ? range.from : undefined, to: preset === 'custom' ? range.to : undefined, page, pageSize: size })
      .then((x) => { if (live) { setD(x && Array.isArray(x.items) ? x : null); setErr(null); } }).catch((e) => { if (live) setErr(errOf(e)); });
    return () => { live = false; };
  }, [q, status, source, basis, preset, range.from, range.to, page, size, tick]);
  const filtered = !!(q || status || source || preset !== 'all');
  const sel = (label: string, value: string, set: (v: string) => void, options: ReactNode, testId: string) => <select aria-label={label} value={value} onChange={(e) => { set(e.target.value); setPage(1); }} style={{ height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', background: '#fff' }} data-testid={testId}>{options}</select>;
  return (
    <section className="panel" style={{ marginTop: 14 }} aria-label={t('growth.aiBooking.act.title')} data-testid="bk-activity">
      <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>{t('growth.aiBooking.act.title')} <span className="sub" style={{ fontWeight: 400 }}>· {t('growth.aiBooking.act.newestFirst')}</span></h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t('growth.aiBooking.act.search')} aria-label={t('growth.aiBooking.act.search')} style={{ flex: '1 1 320px', height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px' }} data-testid="bk-search" />
        {sel(t('growth.aiBooking.act.status'), status, setStatus, <><option value="">{t('growth.aiBooking.act.allStatuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{t('growth.aiBooking.status.' + s)}</option>)}</>, 'bk-status')}
        {sel(t('growth.aiBooking.act.source'), source, setSource, <><option value="">{t('growth.aiBooking.act.allSources')}</option>{SOURCES.map((s) => <option key={s} value={s}>{t('growth.aiBooking.source.' + s)}</option>)}</>, 'bk-source')}
        {sel(t('finance.period.dateField'), basis, setBasis, <>{['requested', 'appointment', 'updated'].map((b) => <option key={b} value={b}>{t('growth.aiBooking.basis.' + b)}</option>)}</>, 'bk-basis')}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8, position: 'relative' }} className="fk-seg" role="group" aria-label={t('growth.aiBooking.period')}>
        {(['all', ...PRESETS] as string[]).map((p) => <button key={p} type="button" className={preset === p ? 'on' : ''} aria-pressed={preset === p} onClick={() => { setPreset(p); setCal(false); setPage(1); }}>{t('finance.period.' + p)}</button>)}
        <button type="button" className={preset === 'custom' ? 'on' : ''} aria-pressed={preset === 'custom'} onClick={() => setCal((x) => !x)}>{t('finance.period.custom')} ▾</button>
        {cal ? <div style={{ position: 'absolute', left: 0, top: 40, zIndex: 20 }}><RangeCalendar initial={range} today={d?.period.today ?? deviceToday()} onApply={(r) => { setRange(r); setPreset('custom'); setCal(false); setPage(1); }} onCancel={() => setCal(false)} onClear={() => setRange({})} /></div> : null}
      </div>
      {err ? <div className="err" style={{ marginTop: 8 }}>{err}</div> : null}
      {d && !d.items.length ? <div className="sub" style={{ marginTop: 10 }} data-testid="bk-act-empty">{filtered ? t('growth.aiBooking.act.noneFiltered') : t('growth.aiBooking.act.none')}</div> : null}
      {d && d.items.length ? <div style={{ overflowX: 'auto', marginTop: 10 }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} data-testid="bk-table">
        <thead><tr style={{ textAlign: 'left', color: '#8A857E', fontSize: 12 }}>{['customer', 'services', 'appointment', 'status', 'source', 'created'].map((h) => <th key={h} style={{ padding: '6px 8px' }}>{t('growth.aiBooking.act.col.' + h)}</th>)}</tr></thead>
        <tbody>{d.items.map((r) => (
          <tr key={r.requestId} tabIndex={0} onClick={() => onOpen(r.requestId)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r.requestId); }} style={{ borderTop: '1px solid var(--line)', cursor: 'pointer' }} data-testid="bk-row">
            <td style={{ padding: '7px 8px' }}>{r.customerName ?? '—'}{r.maskedPhone ? <span className="sub"> · {r.maskedPhone}</span> : null}</td>
            <td style={{ padding: '7px 8px' }}>{r.services.join(', ') || '—'}{r.technicianName ? <span className="sub"> · {r.technicianName}</span> : null}</td>
            <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>{r.appointmentDate ? `${r.appointmentDate} ${r.appointmentTime ?? ''}` : '—'}</td>
            <td style={{ padding: '7px 8px' }}><span style={{ color: STATUS_TONE[r.status] ?? '#4A4744', fontWeight: 700 }}>{t('growth.aiBooking.status.' + r.status)}</span>{r.failureReason ? <span className="sub"> · {word('growth.aiBooking.reason.', r.failureReason)}</span> : null}</td>
            <td style={{ padding: '7px 8px' }}>{word('growth.aiBooking.source.', r.source)}</td>
            <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>{when(r.createdAt)}</td>
          </tr>
        ))}</tbody></table></div> : null}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
        <Pager info={d} onPage={setPage} label={t('growth.aiBooking.act.title')} />
        <label className="sub">{t('growth.aiQueue.hist.rows')}{' '}<select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(1); }} data-testid="bk-size">{[10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      </div>
    </section>
  );
}

// Extras (AI Booking Assistant 10): the booked lines beside the salon's current catalog (fields optional — older servers
// send name / price / duration only, and then nothing claims a catalog price)
type BookedLine = AibRequestDetail['serviceLines'][number] & { isAddon?: boolean; manualOverride?: boolean; overrideReason?: string | null; catalogPriceCents?: number | null; catalogDurationMinutes?: number | null; inCatalog?: boolean };
type BookedServicesView = Omit<AibRequestDetail, 'serviceLines'> & { serviceLines: BookedLine[];
  serviceSummary?: { lines: number; addOns: number; totalPriceCents: number | null; totalDurationMinutes: number | null; catalogTotalCents: number | null; overrides: number; notInCatalog: number } };
function ServiceBreakdown({ d, list }: { d: BookedServicesView; list: (items: ReactNode[], empty: string) => ReactNode }) {
  const sm = d.serviceSummary;
  const known = d.serviceLines.some((s) => s.inCatalog !== undefined);
  return <>
    {list(d.serviceLines.map((s) => <span data-testid="bko-svc-line" style={s.isAddon ? { paddingLeft: 18, display: 'block' } : { display: 'block' }}>
      {s.isAddon ? <span className="fk-chip" data-testid="bko-svc-addon">{t('growth.aiBooking.svc.addon')}</span> : null} {s.name ?? '—'}
      {s.durationMinutes ? ` · ${t('pos.n_min', { n: String(s.durationMinutes) })}` : ''}{s.priceCents != null ? ` · ${money(s.priceCents)}` : ''}
      {s.manualOverride ? <span className="fk-chip warn" data-testid="bko-svc-manual">{t('growth.aiBooking.svc.manual')}</span>
        : s.inCatalog && s.catalogPriceCents === s.priceCents ? <span className="fk-chip ok" data-testid="bko-svc-catalog">{t('growth.aiBooking.svc.catalog')}</span> : null}
      {s.inCatalog && s.catalogPriceCents != null && s.catalogPriceCents !== s.priceCents ? <span className="sub" data-testid="bko-svc-catalog-now"> · {t('growth.aiBooking.svc.catalogNow', { p: money(s.catalogPriceCents) })}</span> : null}
      {s.inCatalog && s.catalogDurationMinutes != null && s.durationMinutes != null && s.catalogDurationMinutes !== s.durationMinutes ? <span className="sub"> · {t('growth.aiBooking.svc.durDiff', { n: String(s.catalogDurationMinutes) })}</span> : null}
      {s.manualOverride && s.overrideReason ? <span className="sub" style={{ display: 'block' }}>{t('growth.aiBooking.svc.manualReason', { r: s.overrideReason })}</span> : null}
      {known && s.inCatalog === false ? <span className="sub" style={{ display: 'block' }} data-testid="bko-svc-gone">{t('growth.aiBooking.svc.notInCatalog')}</span> : null}
    </span>), t('growth.aiBooking.ov.noServices'))}
    {sm && sm.lines ? <div className="fk-note info" data-testid="bko-svc-summary" style={{ marginTop: 8 }}><span>
      {sm.totalPriceCents != null && sm.totalDurationMinutes != null ? <b data-testid="bko-svc-total">{t('growth.aiBooking.svc.total', { p: money(sm.totalPriceCents), n: String(sm.totalDurationMinutes) })}</b> : null}
      {sm.catalogTotalCents != null && sm.catalogTotalCents !== sm.totalPriceCents ? <span data-testid="bko-svc-catalog-total"> · {t('growth.aiBooking.svc.catalogTotal', { p: money(sm.catalogTotalCents) })}</span> : null}
      {sm.overrides ? <span style={{ display: 'block' }} data-testid="bko-svc-overrides">{t('growth.aiBooking.svc.overrides', { n: String(sm.overrides) })}</span> : null}
      <span className="sub" style={{ display: 'block' }}>{t('growth.aiBooking.svc.note')}</span></span></div> : null}
  </>;
}

const TABS = ['overview', 'customer', 'services', 'ai', 'execution', 'verification', 'communications', 'audit'] as const;
function RequestOverlay({ requestId, onClose, onBooking, onCustomer }: { requestId: string; onClose: () => void; onBooking: (date?: string | null) => void; onCustomer: (id: string) => void }) {
  const [tab, setTab] = useState<typeof TABS[number]>('overview');
  const [d, setD] = useState<AibRequestDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.detail(requestId).then(setD).catch((e) => setErr(errOf(e))); }, [requestId]);
  const row = (l: string, v: ReactNode) => <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 32%) 1fr', gap: 8, padding: '5px 0', borderBottom: '1px solid #F1EAE0' }}><span className="sub">{l}</span><span>{v ?? '—'}</span></div>;
  const list = (items: ReactNode[], empty: string) => (items.length ? <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{items.map((x, i) => <li key={i} style={{ padding: '6px 0', borderBottom: '1px solid #F1EAE0' }}>{x}</li>)}</ul> : <div className="sub">{empty}</div>);
  const proposals = d?.timeline.filter((x) => ['AVAILABILITY_SEARCHED', 'OPTIONS_PRESENTED', 'OPTION_SELECTED', 'HUMAN_HANDOFF'].includes(x.stage)) ?? [];
  return (
    <FitDialog title={d?.customerName ?? t('growth.aiBooking.ov.request')} subtitle={d ? <span style={{ color: STATUS_TONE[d.status] ?? '#4A4744', fontWeight: 700 }}>{t('growth.aiBooking.status.' + d.status)}</span> : null} onClose={onClose} wide testId="bk-overlay"
      footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {d?.customerId ? <button className="btn ghost" onClick={() => onCustomer(d.customerId!)} data-testid="bko-customer">{t('growth.aiBooking.ov.viewCustomer')}</button> : null}
        <button className="btn ghost" onClick={() => onBooking(d?.appointmentDate)} data-testid="bko-booking">{t('growth.aiBooking.openBooking')}</button>
        <button className="btn ghost" onClick={() => setTab('audit')}>{t('growth.aiQueue.ov.reviewHistory')}</button>
        <button className="btn" onClick={onClose}>{t('pos.close')}</button>
      </div>}>
      <div role="tablist" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }} className="fk-seg">
        {TABS.map((k) => <button key={k} role="tab" aria-selected={tab === k} type="button" className={tab === k ? 'on' : ''} onClick={() => setTab(k)} data-testid={'bko-tab-' + k}>{t('growth.aiBooking.ov.tab.' + k)}</button>)}
      </div>
      {err ? <div className="err">{err}</div> : null}
      {!d && !err ? <div className="sub">{t('pos.loading')}</div> : null}
      {d ? <div role="tabpanel" data-testid={'bko-panel-' + tab}>
        {tab === 'overview' ? <>{row(t('growth.aiBooking.ov.requestId'), <code>{d.requestId.slice(0, 12)}</code>)}{row(t('growth.aiBooking.act.col.source'), word('growth.aiBooking.source.', d.source))}
          {row(t('growth.aiBooking.act.col.created'), when(d.createdAt))}{row(t('growth.aiBooking.ov.updated'), when(d.updatedAt))}
          {row(t('growth.aiBooking.act.col.status'), t('growth.aiBooking.status.' + d.status))}
          {row(t('growth.aiBooking.ov.appointment'), d.appointmentId ? `${d.appointmentDate ?? ''} ${d.appointmentTime ?? ''} · ${word('growth.aiQueue.ov.st.', d.appointmentStatus)}` : t('growth.aiBooking.ov.noAppointment'))}</> : null}
        {tab === 'customer' ? <>{row(t('growth.aiQueue.ov.name'), d.customer.name)}{row(t('growth.aiQueue.ov.phone'), d.customer.maskedPhone)}
          {row(t('growth.aiBooking.ov.verified'), d.customer.verified ? t('pos.yes') : t('pos.no'))}
          <div className="sub" style={{ margin: '10px 0 4px' }}>{t('growth.aiBooking.ov.otherAppointments')}</div>
          {list(d.customer.appointments.map((a) => `${a.date ?? ''} ${a.time ?? ''} · ${word('growth.aiQueue.ov.st.', a.status)}`), t('growth.aiQueue.ov.noAppointments'))}</> : null}
        {tab === 'services' ? <><ServiceBreakdown d={d as BookedServicesView} list={list} />
          {row(t('glossary.people.technician'), d.technicianName)}</> : null}
        {tab === 'ai' ? <><div className="sub" style={{ marginBottom: 6 }}>{t('growth.aiBooking.ov.aiNote')}</div>{list(proposals.map((x) => `${when(x.at)} · ${word('growth.aiBooking.stage.', x.stage)}`), t('growth.aiBooking.ov.noProposals'))}</> : null}
        {tab === 'execution' ? <>{row(t('growth.aiBooking.ov.attempts'), String(d.attempts))}
          {list(d.tools.map((x) => <span><code>{x.tool}</code> · {word('growth.aiBooking.tool.', x.status)}{x.result ? ` · ${x.result}` : ''}{x.error ? <span className="err"> · {x.error}</span> : null} · {when(x.at)}</span>), t('growth.aiBooking.ov.noTools'))}</> : null}
        {tab === 'verification' ? <><div className="sub" style={{ marginBottom: 6 }}>{t('growth.aiBooking.ov.noCode')}</div>
          {list(d.verification.map((v) => `${word('growth.aiBooking.verify.', v.status)} · ${v.maskedPhone} · ${t('growth.aiBooking.ov.tries', { n: String(v.attempts), r: String(v.resends) })} · ${t('growth.aiBooking.ov.expires', { at: when(v.expiresAt) })}`), t('growth.aiBooking.ov.noVerification'))}
          {d.holds.length ? <><div className="sub" style={{ margin: '10px 0 4px' }}>{t('growth.aiBooking.ov.holds')}</div>{list(d.holds.map((h) => `${word('growth.aiBooking.hold.', h.status)} · ${when(h.startAt)} · ${t('growth.aiBooking.ov.expires', { at: when(h.expiresAt) })}`), '')}</> : null}</> : null}
        {tab === 'communications' ? list(d.communications.map((c) => `${t('growth.aiBooking.ov.codeSent')} · ${when(c.sentAt)} · ${c.providerReference ?? ''} · ${word('growth.aiBooking.verify.', c.status)}`), t('growth.aiBooking.ov.noMessages')) : null}
        {tab === 'audit' ? list(d.timeline.map((x) => <span>{when(x.at)} · <strong>{word('growth.aiBooking.stage.', x.stage)}</strong>{x.failureReason ? <span className="err"> · {word('growth.aiBooking.reason.', x.failureReason)}</span> : null}</span>), t('growth.aiBooking.ov.noEvents')) : null}
      </div> : null}
    </FitDialog>
  );
}

function HealthDialog({ onClose }: { onClose: () => void }) {
  const [run, setRun] = useState<AibHealthRun | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.lastHealth().then((r) => setRun(r.run)).catch(() => setRun(null)); }, []);
  const go = useCallback(async () => { setBusy(true); setErr(null); try { setRun(await api.runHealth()); } catch (e) { setErr(errOf(e)); } finally { setBusy(false); } }, []);
  return (
    <FitDialog title={t('growth.aiBooking.h.title')} subtitle={run ? <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><StatusPill s={run.overall} /><span className="sub">{t('growth.aiQueue.h.lastChecked', { at: when(run.checkedAt) })}</span></span> : null} onClose={onClose} busy={busy} wide testId="bk-health"
      footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button className="btn" onClick={() => void go()} disabled={busy} data-testid="bkh-run">{busy ? t('growth.aiQueue.h.checking') : run ? t('growth.aiQueue.h.runAgain') : t('growth.aiQueue.h.run')}</button><button className="btn ghost" onClick={onClose}>{t('pos.close')}</button></div>}>
      <p className="sub">{t('growth.aiBooking.h.readOnly')}</p>
      {err ? <div className="err">{err}</div> : null}
      {!run && !busy ? <div className="sub">{t('growth.aiQueue.h.never')}</div> : null}
      {run ? <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: 8 }}>{run.checks.map((c) => { const f = healthText(c, 'failure'), x = healthText(c, 'fix'); return (
        <li key={c.key} data-testid={'bkh-' + c.key} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}><strong>{t('growth.aiBooking.h.' + c.key + '.label')}</strong><StatusPill s={c.status} /></div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{healthText(c, 'evidence')}</div>
          {f ? <div className="err" style={{ marginTop: 4 }}>{f}</div> : null}
          {x ? <div className="sub" style={{ marginTop: 4 }}>{t('growth.aiQueue.h.fix')}: {x} <span>· {t('growth.aiBooking.h.who', { who: word('growth.aiBooking.owner.', c.owner) })}</span></div> : null}
        </li>); })}</ul> : null}
    </FitDialog>
  );
}
