// POSRemindersScreen.tsx — Communications → Appointment Reminders (/tenant/communications/reminders), rebuilt in place
// (Appointment Reminders Complete Build & Repair Guide, Oct 30 2026). KEEPS the existing settings exactly — the enable
// checkbox, Lead Time (hours), Send Window (minutes), Channel and Save Reminders on GET/PATCH /pos/reminders — and adds:
// six counters on written bases, scheduler / Twilio / email / booking-sync / delivery-report health, the reminder queue
// and history (Upcoming earliest-due first; history newest first) with server search, channel / branch filters, an
// explicit date basis with a month From/To calendar, numbered pages 10/20/50, Reminder Details (rule, template, attempts,
// provider events) with Open Customer / Open Booking, staff Cancel Pending and the guarded Safe Retry. A saved toggle is
// not proof of sending: the health panel reads the recorded runs and provider evidence.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { posRemindersApi, type ReminderConfig } from '../api/posRemindersApi';
import { posReminderCenterApi as rc, type RcKpis, type RcPage, type RcDetails, type RcHealth, type ReminderRcQuery } from '../api/posReminderCenterApi';
import { authApi } from '../api/authApi';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry, useDebounced, requestId } from '../components/FitKit';
import { RangeCalendar } from '../components/FinanceKit';
import { readSession } from '../components/useSessionState';
import { reportError } from './reportsCommon';
import { errorTextOf } from '../i18n/error-text';
import { useRealtime } from '../realtime/useRealtime';

// the success note is a sentinel, worded at render in the cashier's language (Vietnamese POS mandate §59)
const NOTE_OK = '\u0000ok';
const hoursFromMin = (m: number) => Math.round((m / 60) * 10) / 10;
const TABS = ['upcoming', 'sent', 'delivered', 'failed', 'cancelled', 'skipped', 'all'] as const;
const BASES = ['created', 'scheduled', 'sent', 'delivered', 'appointment'] as const;
const at = (iso: string | null | undefined, tz?: string) => (iso ? new Date(iso).toLocaleString(undefined, { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const stText = (s: string) => t(`rmc.st.${s}`);
const errText = (e: unknown) => errorTextOf(e, t('rmc.loadError'));
function ymdAdd(ymd: string, days: number) { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function presetRange(p: string, today: string): { from: string; to: string } {
  if (p === 'week') { const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); return { from: ymdAdd(today, -((dow + 6) % 7)), to: today }; }
  if (p === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (p === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return { from: today, to: today };
}
const tone = (s: string): 'ok' | 'warn' | 'bad' | undefined => (s === 'ready' || s === 'delivered' ? 'ok' : s === 'failed' || s === 'undelivered' ? 'bad' : s === 'attention_required' || s === 'missed_window' || s === 'unknown' ? 'warn' : undefined);
type Filters = { tab: (typeof TABS)[number]; channel: string; branchId: string; basis: string; from?: string; to?: string; page: number; pageSize: number };
const DEFAULTS: Filters = { tab: 'upcoming', channel: '', branchId: '', basis: '', page: 1, pageSize: 20 };
// non-sensitive view state only (guide §5.3): never a phone, an email or the search text
function readUrl(): Partial<Filters> {
  try {
    const u = new URLSearchParams(window.location.search); const o: Partial<Filters> = {};
    const tab = u.get('tab'); if (tab && (TABS as readonly string[]).includes(tab)) o.tab = tab as Filters['tab'];
    for (const k of ['channel', 'branchId', 'basis', 'from', 'to'] as const) { const v = u.get(k); if (v) (o as Record<string, string>)[k] = v; }
    const p = Number(u.get('page')); if (p > 1) o.page = p;
    const ps = Number(u.get('pageSize')); if ([10, 20, 50].includes(ps)) o.pageSize = ps;
    return o;
  } catch { return {}; }
}

export function POSRemindersScreen() {
  const nav = useNavigate();
  // ── settings (unchanged behaviour) ──
  const [cfg, setCfg] = useState<ReminderConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [leadHours, setLeadHours] = useState('24');
  const [windowMinutes, setWindowMinutes] = useState('60');
  const [channel, setChannel] = useState<'sms' | 'email'>('sms');
  const load = useCallback(async () => {
    setError(null);
    try {
      const c = await posRemindersApi.get();
      setCfg(c); setEnabled(!!c.enabled); setLeadHours(String(hoursFromMin(c.leadMinutes ?? 1440)));
      setWindowMinutes(String(c.windowMinutes ?? 60)); setChannel(c.channel === 'email' ? 'email' : 'sms');
    } catch (e: any) { setError(reportError(e, 'reminders')); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    setSaving(true); setNote(null);
    try {
      const leadMinutes = Math.max(0, Math.round(parseFloat(leadHours || '0') * 60));
      const win = Math.max(0, parseInt(windowMinutes, 10) || 0);
      const c = await posRemindersApi.update({ enabled, leadMinutes, windowMinutes: win, channel });
      setCfg(c); setNote(NOTE_OK); setTick((x) => x + 1);
    } catch (e: any) { setNote(errorTextOf(e, e?.message || t('pos.could_not_save_2'))); }
    finally { setSaving(false); }
  };

  // ── center ──
  const [tick, setTick] = useState(0);
  // C2 gap (Nov 5 2026): a delivery report (sent / delivered / failed) refreshes the counts and lists live; a 60 s safety sync otherwise
  useRealtime(['reminders'], () => setTick((x) => x + 1), { intervalMs: 60_000 });
  const [kpiPreset, setKpiPreset] = useState<'today' | 'week' | 'month' | 'year'>('today');
  const [kpis, setKpis] = useState<RcKpis | null>(null);
  const [health, setHealth] = useState<RcHealth | null>(null);
  // last tab + non-sensitive filters are remembered for this browser tab (sessionStorage) so leaving and coming back keeps
  // them; a link with its own ?tab=… still wins. Never a phone, an email or the search text.
  const [filters, setFilters] = useState<Filters>(() => {
    const f: Filters = { ...DEFAULTS, ...readSession<Partial<Filters>>('aps.rmc.filters', {}), page: 1, ...readUrl() };
    return (TABS as readonly string[]).includes(f.tab) ? f : { ...f, tab: 'upcoming' };
  });
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 300);
  const [page, setPage] = useState<RcPage | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const today = useMemo(() => new Date().toLocaleDateString('en-CA', { timeZone: kpis?.timezone || undefined }), [kpis?.timezone]);
  const setF = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p, page: p.page ?? 1 }));

  useEffect(() => {
    try {
      const u = new URLSearchParams(window.location.search);
      for (const k of ['tab', 'channel', 'branchId', 'basis', 'from', 'to', 'page', 'pageSize']) u.delete(k);
      if (filters.tab !== 'upcoming') u.set('tab', filters.tab);
      for (const k of ['channel', 'branchId', 'basis', 'from', 'to'] as const) if (filters[k]) u.set(k, String(filters[k]));
      if (filters.page > 1) u.set('page', String(filters.page)); if (filters.pageSize !== 20) u.set('pageSize', String(filters.pageSize));
      const s = u.toString(); window.history.replaceState(null, '', `${window.location.pathname}${s ? `?${s}` : ''}`);
    } catch { /* URL state is a convenience */ }
    try { const { tab, channel, branchId, basis, from, to, pageSize } = filters; sessionStorage.setItem('aps.rmc.filters', JSON.stringify({ tab, channel, branchId, basis, from, to, pageSize })); } catch { /* best effort */ }
  }, [filters]);
  useEffect(() => { authApi.branches().then((r) => setBranches((r?.branches ?? []).filter((b) => !!b.id).map((b) => ({ id: b.id, name: b.name ?? '' })))).catch(() => setBranches([])); }, []);
  useEffect(() => { rc.kpis({ preset: kpiPreset, branchId: filters.branchId || undefined }).then(setKpis).catch(() => setKpis(null)); }, [kpiPreset, filters.branchId, tick]);
  useEffect(() => { rc.health().then(setHealth).catch(() => setHealth(null)); }, [tick]);
  const loadList = useCallback(async () => {
    setLoading(true); setListErr(null);
    const query: ReminderRcQuery = { tab: filters.tab, q: q || undefined, channel: filters.channel || undefined, branchId: filters.branchId || undefined, basis: filters.basis || undefined,
      preset: filters.from || filters.to ? 'custom' : 'all', from: filters.from, to: filters.to, page: filters.page, pageSize: filters.pageSize };
    try { setPage(await rc.list(query)); } catch (e) { setListErr(errText(e)); } finally { setLoading(false); }
  }, [filters, q]);
  useEffect(() => { loadList(); }, [loadList, tick]);
  useEffect(() => { setFilters((f) => (f.page === 1 ? f : { ...f, page: 1 })); }, [q]);
  const anyFilter = !!(search || filters.channel || filters.branchId || filters.basis || filters.from || filters.to);
  const clearAll = () => { setSearch(''); setFilters((f) => ({ ...DEFAULTS, tab: f.tab, pageSize: f.pageSize })); };
  const tz = page?.timezone || kpis?.timezone;

  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!cfg) return <div className="work"><div className="state">{t('pos.loading_reminders')}</div></div>;

  const kv = (k: { value: number | null; known?: boolean } | undefined) => (k == null ? '—' : k.value == null ? t('rmc.unknown') : String(k.value));
  return (
    <div className="work rmc" data-testid="rmc-screen">
      <div className="rmc-head">
        <div className="vh"><h1>{t('pos.appointment_reminders')}</h1><div className="sub">{t('pos.automatically_remind_customers_before_their_visit_1sgr')}</div></div>
        <div className="rmc-head-actions">
          <button type="button" className="btn ghost" onClick={() => setTick((x) => x + 1)} data-testid="rmc-refresh">{t('rmc.refresh')}</button>
          <button type="button" className="btn ghost" onClick={() => setF({ tab: 'all' })} data-testid="rmc-history">{t('rmc.viewHistory')}</button>
          <button type="button" className="btn ghost" onClick={() => nav('/tenant/communications/messaging-setup')} data-testid="rmc-test">{t('rmc.testReminder')}</button>
        </div>
      </div>

      <div className="rmc-period">
        <span className="sub">{t('rmc.kpiPeriod')}</span>
        {(['today', 'week', 'month', 'year'] as const).map((p) => <button key={p} type="button" className={'btn sm' + (kpiPreset === p ? '' : ' ghost')} onClick={() => setKpiPreset(p)} data-testid={`rmc-kp-${p}`}>{t(`rmc.preset.${p}`)}</button>)}
        {tz ? <span className="sub">{t('rmc.tz', { tz })}</span> : null}
      </div>
      <div className="rmc-kpis" data-testid="rmc-kpis">
        <KpiCard label={t('rmc.k.scheduled')} value={kv(kpis?.scheduled)} sub={t('rmc.kb.scheduled')} testId="rmc-k-scheduled" onClick={() => setF({ tab: 'upcoming' })} />
        <KpiCard label={t('rmc.k.sent')} value={kv(kpis?.sent)} sub={t('rmc.kb.sent')} testId="rmc-k-sent" onClick={() => setF({ tab: 'sent' })} />
        <KpiCard label={t('rmc.k.delivered')} value={kv(kpis?.delivered)} tone={kpis && !kpis.delivered.known ? 'warn' : 'ok'} sub={kpis && !kpis.delivered.known ? t('rmc.kb.deliveredUnknown') : t('rmc.kb.delivered')} testId="rmc-k-delivered" onClick={() => setF({ tab: 'delivered' })} />
        <KpiCard label={t('rmc.k.failed')} value={kv(kpis?.failed)} tone={kpis?.failed.value ? 'bad' : undefined} sub={t('rmc.kb.recorded')} testId="rmc-k-failed" onClick={() => setF({ tab: 'failed' })} />
        <KpiCard label={t('rmc.k.cancelled')} value={kv(kpis?.cancelled)} sub={t('rmc.kb.recorded')} testId="rmc-k-cancelled" onClick={() => setF({ tab: 'cancelled' })} />
        <KpiCard label={t('rmc.k.upcomingToday')} value={kv(kpis?.upcomingToday)} sub={t('rmc.kb.upcomingToday')} testId="rmc-k-today" onClick={() => setF({ tab: 'upcoming' })} />
      </div>

      <div className="rmc-grid">
        <section className="panel rmc-settings" data-testid="rmc-settings">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--line)' }} onClick={() => setEnabled(!enabled)}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 18, height: 18 }} data-testid="rmc-enabled" />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{t('pos.send_appointment_reminders')}</div>
              <div className="sub" style={{ fontSize: 12, marginTop: 2 }}>{t('pos.turn_on_automated_sms_or_email_d1ny')}</div>
            </div>
          </div>
          <div style={{ opacity: enabled ? 1 : 0.55, pointerEvents: enabled ? 'auto' : 'none' }}>
            <div className="lf">
              <label>{t('pos.lead_time_2')}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" min="0" step="0.5" value={leadHours} onChange={(e) => setLeadHours(e.target.value)} style={{ width: 120 }} data-testid="rmc-lead" />
                <span className="sub">{t('pos.hours_before_the_appointment')}</span>
              </div>
            </div>
            <div className="lf">
              <label>{t('pos.send_window')}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" min="0" value={windowMinutes} onChange={(e) => setWindowMinutes(e.target.value)} style={{ width: 120 }} data-testid="rmc-window" />
                <span className="sub">{t('pos.minutes_window_width_to_check')}</span>
              </div>
            </div>
            <div className="lf">
              <label>{t('pos.channel')}</label>
              <select value={channel} onChange={(e) => setChannel(e.target.value as 'sms' | 'email')} style={{ width: '100%', maxWidth: 200 }} data-testid="rmc-channel">
                <option value="sms">SMS</option>
                <option value="email">{t('pos.email')}</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
            <button className="btn" disabled={saving} onClick={save} data-testid="rmc-save">{saving ? t('pos.saving_2') : t('pos.save_reminders')}</button>
            {note ? <span className="sub" role="status" style={{ color: note === NOTE_OK ? '#2E9E54' : '#C0392B', fontSize: 13 }} data-testid="rmc-save-note">{note === NOTE_OK ? t('pos.saved_2') : note}</span> : null}
          </div>
          <div className="sub rmc-semantics" data-testid="rmc-semantics">{t('rmc.semantics', { lead: leadHours || '0', win: windowMinutes || '0' })}</div>
        </section>

        <section className="panel rmc-health" data-testid="rmc-health">
          <div className="rmc-health-head"><b>{t('rmc.health')}</b>{health ? <span className={'rmc-pill ' + (tone(health.overall) ?? '')} data-testid="rmc-health-overall">{t(`rmc.hs.${health.overall}`)}</span> : null}</div>
          {!health ? <div className="sub">{t('rmc.healthLoading')}</div> : (
            <ul className="rmc-hl">
              {health.items.map((i) => (
                <li key={i.key} data-testid={`rmc-h-${i.key}`}>
                  <div className="rmc-hl-top"><b>{t(`rmc.h.${i.key}`)}</b><span className={'rmc-pill ' + (tone(i.state) ?? '')}>{t(`rmc.hs.${i.state}`)}</span></div>
                  <div className="sub">{i.summary}</div>
                  {i.nextAction ? <div className="rmc-next">{t('rmc.next')}: {i.nextAction}</div> : null}
                  {i.checkedAt ? <div className="sub rmc-small">{t('rmc.lastVerified', { at: at(i.checkedAt, tz) })}</div> : null}
                </li>
              ))}
            </ul>
          )}
          {health && !health.schedulerEnabledHere ? <div className="rmc-warn" data-testid="rmc-cron-off">{t('rmc.cronOff')}</div> : null}
        </section>
      </div>

      <section className="panel rmc-list" data-testid="rmc-list">
        <div className="rmc-tabs" role="tablist">
          {TABS.map((k) => <button key={k} type="button" role="tab" aria-selected={filters.tab === k} className={'btn sm' + (filters.tab === k ? '' : ' ghost')} onClick={() => setF({ tab: k, basis: '' })} data-testid={`rmc-tab-${k}`}>{t(`rmc.tab.${k}`)}</button>)}
        </div>
        <div className="rmc-filters">
          <input className="fk-search rmc-search" placeholder={t('rmc.searchPh')} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t('rmc.searchPh')} data-testid="rmc-search" />
          <select className="fk-select" aria-label={t('rmc.f.channel')} value={filters.channel} onChange={(e) => setF({ channel: e.target.value })} data-testid="rmc-f-channel">
            <option value="">{t('rmc.f.anyChannel')}</option><option value="sms">SMS</option><option value="email">{t('pos.email')}</option>
          </select>
          {branches.length > 1 ? (
            <select className="fk-select" aria-label={t('rmc.f.branch')} value={filters.branchId} onChange={(e) => setF({ branchId: e.target.value })} data-testid="rmc-f-branch">
              <option value="">{t('rmc.f.anyBranch')}</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          ) : null}
          <select className="fk-select" aria-label={t('rmc.f.basis')} value={filters.basis} onChange={(e) => setF({ basis: e.target.value })} data-testid="rmc-f-basis">
            <option value="">{t(filters.tab === 'upcoming' ? 'rmc.b.scheduled' : 'rmc.b.created')}</option>
            {(filters.tab === 'upcoming' ? ['appointment'] : BASES.filter((b) => b !== 'created')).map((b) => <option key={b} value={b}>{t(`rmc.b.${b}`)}</option>)}
          </select>
          <div className="fuq-presets">
            {(['today', 'week', 'month', 'year'] as const).map((p) => <button key={p} type="button" className="btn ghost sm" onClick={() => setF(presetRange(p, today))} data-testid={`rmc-preset-${p}`}>{t(`rmc.preset.${p}`)}</button>)}
            <span className="fuq-dates">
              <button type="button" className="btn ghost sm" aria-expanded={calOpen} onClick={() => setCalOpen((o) => !o)} data-testid="rmc-f-dates">{filters.from && filters.to ? `${filters.from} – ${filters.to}` : t('rmc.preset.custom')}</button>
              {calOpen ? (
                <span data-testid="rmc-cal">
                  <RangeCalendar initial={{ from: filters.from, to: filters.to }} today={today}
                    onApply={(r) => { setF({ from: r.from, to: r.to }); setCalOpen(false); }} onCancel={() => setCalOpen(false)} onClear={() => { setF({ from: undefined, to: undefined }); setCalOpen(false); }} />
                </span>
              ) : null}
            </span>
          </div>
          {anyFilter ? <button type="button" className="btn ghost" onClick={clearAll} data-testid="rmc-clear">{t('rmc.clear')}</button> : null}
        </div>
        <div className="sub rmc-basis" data-testid="rmc-basis">{t('rmc.basisNote', { basis: t(`rmc.b.${page?.basis ?? (filters.tab === 'upcoming' ? 'scheduled' : 'created')}`), order: t(filters.tab === 'upcoming' ? 'rmc.order.due' : 'rmc.order.newest') })}{page ? ` · ${t('rmc.total', { n: page.totalItems })}` : ''}</div>
        {listErr ? <ErrorRetry message={listErr} onRetry={loadList} /> : loading && !page ? <div className="state">{t('rmc.loading')}</div> : !page || page.items.length === 0 ? (
          <Empty title={t(anyFilter ? 'rmc.emptyFiltered' : `rmc.empty.${filters.tab}`)}>{anyFilter ? <button type="button" className="btn ghost sm" onClick={clearAll}>{t('rmc.clear')}</button> : null}</Empty>
        ) : (
          <div className="rmc-table-wrap">
            <table className="tbl rmc-table" data-testid="rmc-table">
              <thead><tr><th>{t('rmc.c.customer')}</th><th>{t('rmc.c.booking')}</th><th>{t('rmc.c.start')}</th><th>{t('rmc.c.due')}</th><th>{t('rmc.c.channel')}</th><th>{t('rmc.c.state')}</th><th>{t('rmc.c.actions')}</th></tr></thead>
              <tbody>{page.items.map((r) => (
                <tr key={r.id} data-testid="rmc-row">
                  <td><div className="rmc-name">{r.customerName || t('rmc.walkIn')}</div><div className="sub">{r.channel === 'email' ? r.emailMasked ?? t('rmc.noEmail') : r.phoneLast4 ? `••• ${r.phoneLast4}` : t('rmc.noPhone')}</div></td>
                  <td><div>{r.technicianName ?? '—'}</div><div className="sub">{r.branchName ?? ''}</div></td>
                  <td>{at(r.appointmentStartAt, tz)}</td>
                  <td><div>{at(r.intendedSendAt, tz)}</div>{r.sentAt ? <div className="sub">{t('rmc.sentAt', { at: at(r.sentAt, tz) })}</div> : null}</td>
                  <td>{r.channel === 'email' ? t('pos.email') : 'SMS'}{r.leadMinutes ? <div className="sub">{t('rmc.lead', { h: hoursFromMin(r.leadMinutes) })}</div> : null}</td>
                  <td><span className={'rmc-pill ' + (tone(r.state) ?? '')} data-testid="rmc-state">{stText(r.state)}</span>{r.superseded ? <div className="sub rmc-small">{t('rmc.superseded')}</div> : null}{r.reason ? <div className="sub rmc-small">{t(`rmc.r.${r.reason}`)}</div> : null}</td>
                  <td className="rmc-actions">
                    <button type="button" className="btn ghost sm" onClick={() => setOpen(r.id)} data-testid="rmc-view">{t('rmc.a.view')}</button>
                    {r.customerId ? <button type="button" className="btn ghost sm" onClick={() => nav(`/tenant/customers/profiles?customerId=${encodeURIComponent(r.customerId!)}`)}>{t('rmc.a.customer')}</button> : null}
                    <button type="button" className="btn ghost sm" onClick={() => nav('/booking')}>{t('rmc.a.booking')}</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <div className="rmc-pagerow">
          <select className="fk-select" aria-label={t('rmc.pageSize')} value={filters.pageSize} onChange={(e) => setF({ pageSize: Number(e.target.value) })} data-testid="rmc-pagesize">
            {[10, 20, 50].map((n) => <option key={n} value={n}>{t('rmc.perPage', { n })}</option>)}
          </select>
          <Pager info={page ? { page: page.page, pageSize: page.pageSize, totalItems: page.totalItems, totalPages: page.totalPages } : null} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} />
        </div>
      </section>

      <section className="panel rmc-bottom">
        <b>{t('rmc.related')}</b>
        <div className="rmc-links">
          <button type="button" className="btn ghost sm" onClick={() => nav('/tenant/communications/templates')}>{t('rmc.l.templates')}</button>
          <button type="button" className="btn ghost sm" onClick={() => setF({ tab: 'failed' })}>{t('rmc.l.exceptions')}</button>
          <button type="button" className="btn ghost sm" onClick={() => nav('/tenant/communications/notifications')}>{t('rmc.l.notifications')}</button>
          <button type="button" className="btn ghost sm" onClick={() => nav('/tenant/communications/messaging-setup')}>{t('rmc.l.sms')}</button>
        </div>
      </section>

      {open ? <ReminderDetails id={open} tz={tz} onClose={() => setOpen(null)} onChanged={() => { setTick((x) => x + 1); }} nav={nav} /> : null}
    </div>
  );
}

function ReminderDetails({ id: openedId, tz, onClose, onChanged, nav }: { id: string; tz?: string; onClose: () => void; onChanged: () => void; nav: (p: string) => void }) {
  // an upcoming reminder (u:…) becomes a recorded one when it is cancelled: the dialog follows the new record
  const [id, setId] = useState(openedId);
  const [d, setD] = useState<RcDetails | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'none' | 'cancel' | 'retry'>('none');
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [key, setKey] = useState(() => requestId());
  const load = useCallback(() => { setErr(null); rc.details(id).then(setD).catch((e) => setErr(errText(e))); }, [id]);
  useEffect(() => { load(); }, [load]);
  const it = d?.item;
  const cancellable = !!it && (it.kind === 'upcoming' ? it.state === 'scheduled' : it.engineState === 'deferred' || it.engineState === 'failed');
  const retryable = !!it && it.kind === 'dispatch' && !!it.retryable;
  const unknown = it?.reason === 'interrupted_unknown';
  const act = async () => {
    setBusy(true); setMsg(null);
    try {
      let moved = false;
      if (mode === 'cancel') { const r = await rc.cancel(id, reason.trim()); if (r?.id && r.id !== id) { moved = true; setId(r.id); } }
      else { const r = await rc.retry(id, { idempotencyKey: key, reason: reason.trim(), confirm: true, acknowledgeDuplicateRisk: unknown ? ack : undefined }); setMsg(t('rmc.retryDone', { state: stText(r.state) })); setKey(requestId()); }
      setMode('none'); setReason(''); onChanged(); if (!moved) load();   // a moved dialog loads the new record itself
    } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };
  return (
    <FitDialog title={t('rmc.details')} subtitle={it ? `${it.customerName || t('rmc.walkIn')} · ${at(it.appointmentStartAt, tz)}` : undefined} onClose={onClose} busy={busy} wide testId="rmc-details"
      footer={<div className="rmc-dfoot">
        {it?.customerId ? <button type="button" className="btn ghost" onClick={() => nav(`/tenant/customers/profiles?customerId=${encodeURIComponent(it.customerId!)}`)}>{t('rmc.a.customer')}</button> : null}
        <button type="button" className="btn ghost" onClick={() => nav('/booking')}>{t('rmc.a.booking')}</button>
        {cancellable ? <button type="button" className="btn ghost" onClick={() => { setMode('cancel'); setMsg(null); }} data-testid="rmc-cancel">{t('rmc.a.cancel')}</button> : null}
        {retryable ? <button type="button" className="btn" onClick={() => { setMode('retry'); setMsg(null); }} data-testid="rmc-retry">{t('rmc.a.retry')}</button> : null}
        <button type="button" className="btn ghost" onClick={onClose} data-testid="rmc-close">{t('rmc.close')}</button>
      </div>}>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !d || !it ? <div className="state">{t('rmc.loading')}</div> : (
        <div className="rmc-detail">
          <dl className="rmc-dl">
            <dt>{t('rmc.c.state')}</dt><dd><span className={'rmc-pill ' + (tone(it.state) ?? '')} data-testid="rmc-d-state">{stText(it.state)}</span>{it.superseded ? ` · ${t('rmc.superseded')}` : ''}</dd>
            {it.reasonText || it.reason ? <><dt>{t('rmc.why')}</dt><dd data-testid="rmc-d-reason">{it.reason ? t(`rmc.r.${it.reason}`) : t(`rmc.r.${it.state}`)}</dd></> : it.kind === 'upcoming' && it.state !== 'scheduled' ? <><dt>{t('rmc.why')}</dt><dd data-testid="rmc-d-reason">{t(`rmc.r.${it.state}`)}</dd></> : null}
            <dt>{t('rmc.c.channel')}</dt><dd>{it.channel === 'email' ? `${t('pos.email')} · ${it.emailMasked ?? t('rmc.noEmail')}` : t('px.ch.smsTo', { to: it.phoneLast4 ? `••• ${it.phoneLast4}` : t('rmc.noPhone') })}</dd>
            <dt>{t('rmc.c.booking')}</dt><dd>{it.technicianName ?? '—'} · {it.branchName ?? '—'} · {at(it.appointmentStartAt, tz)}{tz ? ` (${tz})` : ''}</dd>
            <dt>{t('rmc.c.due')}</dt><dd>{at(it.intendedSendAt, tz)}{it.sentAt ? ` · ${t('rmc.sentAt', { at: at(it.sentAt, tz) })}` : ''}{it.deliveredAt ? ` · ${t('rmc.deliveredAt', { at: at(it.deliveredAt, tz) })}` : ''}</dd>
            <dt>{t('rmc.rule')}</dt><dd>{t('rmc.ruleText', { lead: hoursFromMin(it.leadMinutes || d.rule.leadMinutes), win: d.rule.windowMinutes, ch: d.rule.channel === 'email' ? t('pos.email') : 'SMS' })}</dd>
            <dt>{t('rmc.template')}</dt><dd>{d.template.source === 'salon_template' ? t('rmc.tplSalon', { v: d.template.version ?? '?' }) : t('rmc.tplBuiltIn')}</dd>
            {it.providerStatus ? <><dt>{t('rmc.provider')}</dt><dd>{it.providerStatus}{it.providerErrorCode ? ` · ${it.providerErrorCode}` : ''}{it.providerReference ? ` · ${it.providerReference}` : ''}</dd></> : null}
          </dl>
          {d.attempts.length ? <><b>{t('rmc.attempts')}</b><ol className="rmc-timeline" data-testid="rmc-d-attempts">{d.attempts.map((a) => <li key={a.id}>{at(a.at, tz)} — {t(`rmc.ev.${a.status}`)}{a.reason ? ` (${t(`rmc.r.${a.reason}`)})` : ''}{a.byStaff ? ` · ${t('rmc.byStaff')}` : ''}{a.note ? ` · “${a.note}”` : ''}</li>)}</ol></> : null}
          {d.deliveryEvents.length ? <><b>{t('rmc.events')}</b><ol className="rmc-timeline">{d.deliveryEvents.map((e, i) => <li key={i}>{at(e.at, tz)} — {e.providerStatus}{e.errorCode ? ` · ${e.errorCode}` : ''}{e.signatureVerified ? '' : ` · ${t('rmc.unverified')}`}</li>)}</ol></> : null}
          {mode !== 'none' ? (
            <div className="rmc-confirm" data-testid="rmc-confirm">
              <div className="rmc-warn">{mode === 'cancel' ? t('rmc.cancelWarn') : t('rmc.retryWarn', { ch: it.channel === 'email' ? t('pos.email') : 'SMS', to: it.channel === 'email' ? it.emailMasked ?? '' : `••• ${it.phoneLast4 ?? ''}` })}</div>
              {mode === 'retry' && unknown ? <label className="rmc-ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="rmc-ack" /> {t('rmc.ackDup')}</label> : null}
              <label className="eod-field">{t('rmc.reason')}<input className="fk-search" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="rmc-reason" /></label>
              <div className="rmc-dfoot">
                <button type="button" className="btn ghost" onClick={() => { setMode('none'); setReason(''); }}>{t('rmc.back')}</button>
                <button type="button" className="btn" disabled={busy || reason.trim().length < 3 || (mode === 'retry' && unknown && !ack)} onClick={act} data-testid="rmc-confirm-go">{mode === 'cancel' ? t('rmc.a.cancel') : t('rmc.a.retryNow')}</button>
              </div>
            </div>
          ) : null}
          {msg ? <div className="rmc-msg" role="status" data-testid="rmc-msg">{msg}</div> : null}
        </div>
      )}
    </FitDialog>
  );
}

/** Customer Profile → Reminder History (guide §10 / §4.3): the customer's reminders newest first, each with its event trail */
export function CustomerReminderHistory({ customerId }: { customerId: string }) {
  const [p, setP] = useState(1);
  const [data, setData] = useState<Awaited<ReturnType<typeof rc.customerHistory>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setErr(null); rc.customerHistory(customerId, p, 10).then(setData).catch((e) => setErr(errText(e))); }, [customerId, p]);
  if (err) return <div className="sub" data-testid="rmc-cust-err">{err}</div>;
  if (!data) return <div className="state">{t('rmc.loading')}</div>;
  return (
    <div className="rmc-cust" data-testid="rmc-cust">
      {data.items.length === 0 ? <div className="sub">{t('rmc.custEmpty')}</div> : (
        <ul className="rmc-cust-list">{data.items.map((r) => (
          <li key={r.id} data-testid="rmc-cust-row">
            <div className="rmc-hl-top"><b>{at(r.appointmentStartAt)}</b><span className={'rmc-pill ' + (tone(r.state) ?? '')}>{stText(r.state)}</span></div>
            <div className="sub">{r.channel === 'email' ? t('pos.email') : 'SMS'} · {t('rmc.c.due')}: {at(r.intendedSendAt)}{r.superseded ? ` · ${t('rmc.superseded')}` : ''}</div>
            {r.reason ? <div className="sub">{t(`rmc.r.${r.reason}`)}</div> : null}
            <ol className="rmc-timeline">{r.events.map((e, i) => <li key={i}>{at(e.at)} — {t(`rmc.ev.${e.status}`)}{e.reason ? ` (${t(`rmc.r.${e.reason}`)})` : ''}</li>)}</ol>
          </li>
        ))}</ul>
      )}
      <Pager compact info={{ page: data.page, pageSize: data.pageSize, totalItems: data.totalItems, totalPages: data.totalPages }} onPage={setP} />
    </div>
  );
}
