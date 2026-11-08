// POSAICalendarScreen.tsx — AI Center → AI Calendar (/tenant/ai/receptionist/calendar). AI Calendar Complete Build Guide.
// NOT a second calendar: every number and row is read from canonical POS Booking through /pos/ai/calendar-center/* (the
// same pos_tech_appointments rows, Booking's own day grid and technician pages, booking_holds). Editing stays in POS
// Booking; the Scheduling Assistant only proposes, and a move is reviewed + confirmed through the Reception Copilot
// (prepare → confirm → verify). Kept from the original: title, the POS Booking source-of-truth line, Previous / Today /
// Next, the single-day picker, Open in POS Booking, the four counters, the day list and its genuine empty state.
// Fixed: literal "‹" / "–" text (double-escaped catalog strings + JSX text escapes), the browser-UTC "today",
// the AI substring heuristic, and counters with no definition.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { posAiCalendarApi, type AicListQuery, type AicView } from '../api/posAiCalendarApi';
import { errorTextOf } from '../i18n/error-text';
import { fmtDateTime, fmtYmd } from '../i18n/format';
import { FitDialog, Pager, Empty, ErrorRetry, useDebounced } from '../components/FitKit';
import { RangeCalendar } from '../components/FinanceKit';
import { useRealtime } from '../realtime/useRealtime';
import { useCopilotAction, PreparedCard, ActionOutcome } from './receptionCopilotCenter';
import { statusLabel } from '../i18n/status-label';   // the code stays the truth; only its label is translated

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const shift = (d: string, k: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const shiftMonth = (d: string, k: number) => { const x = new Date(d.slice(0, 8) + '01T12:00:00Z'); x.setUTCMonth(x.getUTCMonth() + k); return x.toISOString().slice(0, 10); };
const when = (v?: string | null) => (v ? fmtDateTime(v) : '—');
const day = (d?: string | null) => (d && DATE.test(d) ? fmtYmd(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const STATUSES = ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service', 'completed', 'cancelled', 'no_show'];
const SOURCES = ['ai', 'online', 'customer_app', 'phone', 'walk_in', 'manual', 'google'];
const STATE_TONE: Record<string, string> = { READY: 'ok', WARNING: 'warn', FAILED: 'bad', NOT_CONFIGURED: 'bad', DISABLED: 'muted', UNKNOWN: 'muted' };

function Kpi({ label, value, hint, testId }: { label: string; value: string; hint: string; testId: string }) {
  return <div className="aic-kpi" data-testid={testId} title={hint}><span>{label}</span><b>{value}</b><small>{hint}</small></div>;
}
function AiBadge() { return <span className="aic-ai" aria-label={t('aical.aiCreatedA11y')}>{t('aical.aiBadge')}</span>; }

export function POSAICalendarScreen() {
  const nav = useNavigate();
  // '' until the server tells us the salon's today. URL keeps the date + view (refresh / back keep the context; no PII).
  const initial = (() => { try { return new URLSearchParams(window.location.search); } catch { return new URLSearchParams(); } })();
  const [date, setDate] = useState<string>(() => { const d = initial.get('date') ?? ''; return DATE.test(d) ? d : ''; });
  const [view, setView] = useState<AicView>(() => { const v = initial.get('view'); return v === 'week' || v === 'month' || v === 'list' ? v : 'day'; });
  useEffect(() => { try { const u = new URL(window.location.href); if (date) u.searchParams.set('date', date); u.searchParams.set('view', view); window.history.replaceState(window.history.state, '', u.toString()); } catch { /* no history API: the screen still works, only refresh loses the day */ } }, [date, view]);
  const [sum, setSum] = useState<any | null>(null);
  const [sumErr, setSumErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [health, setHealth] = useState<any | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [showAssist, setShowAssist] = useState(false);
  const [showDefs, setShowDefs] = useState(false);

  const loadSummary = useCallback(async () => {
    setSumErr(null);
    try { const s = await posAiCalendarApi.summary(date || undefined); setSum(s); if (!date) setDate(s.date); setAsOf(new Date().toISOString()); }
    catch (e) { setSumErr(errorTextOf(e, t('aical.loadFailed'))); }
  }, [date]);
  useEffect(() => { void loadSummary(); }, [loadSummary, tick]);
  const refresh = useCallback(() => setTick((x) => x + 1), []);
  useRealtime(['booking', 'technicians'], refresh, { intervalMs: 45_000 });

  const runHealth = async () => { setHealthBusy(true); try { setHealth(await posAiCalendarApi.health(date || undefined)); } catch (e) { setHealth({ error: errorTextOf(e, t('aical.loadFailed')) }); } finally { setHealthBusy(false); } };
  const step = (k: number) => setDate((d) => (!d ? d : view === 'month' ? shiftMonth(d, k) : shift(d, view === 'week' ? 7 * k : k)));
  const ns = (v?: number | null) => (v == null ? t('aical.unknown') : String(v));
  const stale = asOf && Date.now() - new Date(asOf).getTime() > 120_000;

  return (
    <div className="work aic" data-testid="aic">
      <div className="vh aic-head">
        <div>
          <h1>{t('aical.title')}</h1>
          <div className="sub">{t('aical.subtitle')}</div>
          <div className="aic-muted" data-testid="aic-scope">{sum ? t('aical.scope', { tz: sum.timeZone, scope: t(`aical.scope.${sum.branchScope}`) }) : ''}{asOf ? ` · ${t('aical.asOf', { when: when(asOf) })}` : ''}{stale ? ` · ${t('aical.staleNote')}` : ''}</div>
        </div>
        <div className="aic-row">
          <button className="btn" onClick={() => nav(date ? `/booking?date=${date}` : '/booking')} data-testid="aic-open-booking">{t('aical.openBooking')}</button>
          <button className="btn ghost" onClick={() => { void runHealth(); }} disabled={healthBusy} data-testid="aic-health-btn">{healthBusy ? t('aical.checking') : t('aical.checkSystem')}</button>
          <button className="btn ghost" onClick={refresh} data-testid="aic-refresh">{t('aical.refresh')}</button>
        </div>
      </div>

      <section className="aic-panel" aria-label={t('aical.navigation')}>
        <div className="aic-row">
          <button className="btn" onClick={() => step(-1)} disabled={!date} data-testid="aic-prev">{t('aical.prev')}</button>
          <button className="btn" onClick={() => setDate(sum?.today ?? '')} data-testid="aic-today">{t('aical.today')}</button>
          <button className="btn" onClick={() => step(1)} disabled={!date} data-testid="aic-next">{t('aical.next')}</button>
          <input type="date" value={date} aria-label={t('aical.pickDay')} onChange={(e) => DATE.test(e.target.value) && setDate(e.target.value)} className="aic-date" data-testid="aic-date" />
          <span className="aic-muted" data-testid="aic-dayname">{day(date)}</span>
          <div className="aic-seg" role="tablist" aria-label={t('aical.views')} data-testid="aic-views">
            {(['day', 'week', 'month', 'list'] as AicView[]).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)} data-testid={`aic-view-${v}`}>{t(`aical.view.${v}`)}</button>
            ))}
          </div>
          <button className="btn ghost" onClick={() => setShowAssist((x) => !x)} data-testid="aic-assist-btn">{t('aical.assistant')}</button>
        </div>
      </section>

      {sumErr ? <ErrorRetry message={sumErr} onRetry={refresh} /> : !sum ? <div className="aic-muted">{t('aical.loading')}</div> : (
        <>
          <div className="aic-kpis">
            <Kpi testId="aic-kpi-appointments" label={t('aical.kpi.appointments')} value={String(sum.appointments)} hint={t('aical.kpi.appointmentsHint', { x: sum.cancelled, ns: sum.noShow })} />
            <Kpi testId="aic-kpi-ai" label={t('aical.kpi.ai')} value={String(sum.aiCreated)} hint={t('aical.kpi.aiHint', { linked: sum.aiLinkedToCall, pending: sum.pendingVerification })} />
            <Kpi testId="aic-kpi-slots" label={t('aical.kpi.slots')} value={ns(sum.openSlots.value)} hint={sum.openSlots.value == null ? t('aical.unknown') : t('aical.kpi.slotsHint', { min: sum.openSlots.serviceMinutes, engine: sum.openSlots.engineValue })} />
            <Kpi testId="aic-kpi-techs" label={t('aical.kpi.techs')} value={ns(sum.technicians.value)} hint={t('aical.kpi.techsHint', { active: ns(sum.technicians.activeRoster), clocked: ns(sum.technicians.clockedIn), free: ns(sum.technicians.freeNow) })} />
          </div>
          <button className="aic-link" onClick={() => setShowDefs((x) => !x)} aria-expanded={showDefs} data-testid="aic-defs-btn">{showDefs ? t('aical.hideDefs') : t('aical.showDefs')}</button>
          {showDefs ? (
            <div className="aic-panel aic-defs" data-testid="aic-defs">
              {(['appointments', 'aiCreated', 'openSlots', 'technicians'] as const).map((k) => <p key={k}><b>{t(`aical.def.${k}`)}</b> {sum.definitions[k]}</p>)}
              <ul>{(sum.openSlots.reconciliation ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
            </div>
          ) : null}
        </>
      )}

      {showAssist && date ? <SchedulingAssistant date={date} onOpen={setOpenId} onDone={refresh} /> : null}
      {date ? (view === 'day' ? <DayView key={date} date={date} tick={tick} onOpen={setOpenId} />
        : view === 'list' ? <ListView tick={tick} today={sum?.today ?? date} onOpen={setOpenId} />
        : <RangeView key={`${view}:${date}`} view={view} date={date} tick={tick} onPick={(d) => { setDate(d); setView('day'); }} />) : null}

      <div className="aic-muted aic-foot">{t('aical.sourceOfTruth')} <button className="aic-link" onClick={() => nav('/booking')}>{t('aical.posBooking')}</button></div>

      {openId ? <AppointmentOverlay id={openId} onClose={() => setOpenId(null)} nav={nav} /> : null}
      {health ? <HealthDialog r={health} onClose={() => setHealth(null)} /> : null}
    </div>
  );
}

// ── Day view: 12 technician columns per page, appointments by service time ─────────────────────────────────────────
function DayView({ date, tick, onOpen }: { date: string; tick: number; onOpen: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const [d, setD] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setPage(1); }, [date]);
  const load = useCallback(async () => { setErr(null); try { setD(await posAiCalendarApi.day(date, page)); } catch (e) { setErr(errorTextOf(e, t('aical.loadFailed'))); } }, [date, page]);
  useEffect(() => { void load(); }, [load, tick]);
  if (err) return <ErrorRetry message={err} onRetry={load} />;
  if (!d) return <div className="aic-muted">{t('aical.loading')}</div>;
  const byTech = (id: string) => d.appointments.filter((a: any) => a.technicianId === id);
  return (
    <section className="aic-panel" data-testid="aic-day">
      <div className="aic-row aic-between">
        <b>{t('aical.dayTitle', { day: day(date) })} · {t('aical.hours', { open: d.hours.open, close: d.hours.close })}</b>
        <div className="aic-row">
          <button className="btn ghost" disabled={d.techPaging.page <= 1} onClick={() => setPage((p) => p - 1)} data-testid="aic-tech-prev">{t('aical.prev12')}</button>
          <span className="aic-muted" data-testid="aic-tech-label">{t('aical.techLabel', { label: d.techPaging.label })}</span>
          <button className="btn ghost" disabled={d.techPaging.page >= d.techPaging.totalPages} onClick={() => setPage((p) => p + 1)} data-testid="aic-tech-next">{t('aical.next12')}</button>
        </div>
      </div>
      {!d.appointments.length ? <div className="aic-empty" data-testid="aic-day-empty">{t('aical.noAppointments')}</div> : null}
      <div className="aic-cols" data-testid="aic-cols">
        {d.technicians.map((tc: any) => (
          <div key={tc.id} className="aic-col" data-testid="aic-col">
            <div className="aic-col-h"><b>{tc.name}</b><small>{tc.workingToday ? tc.windows.map((w: any) => `${w.start}–${w.end}`).join(', ') : t('aical.offToday')}</small></div>
            {byTech(tc.id).map((a: any) => (
              <button key={a.id} className={`aic-appt${a.aiCreated ? ' ai' : ''}`} onClick={() => onOpen(a.id)} data-testid="aic-appt" data-status={a.status}>
                <span className="aic-time">{a.start}–{a.end}</span>
                <span>{a.customerName ?? t('aical.noName')}</span>
                <small>{a.services.join(', ') || '—'} · {t(`aical.status.${a.status}`)}</small>
                {a.aiCreated ? <AiBadge /> : null}
              </button>
            ))}
            {d.holds.filter((h: any) => h.technicianId === tc.id).map((h: any) => (
              <div key={h.id} className="aic-hold" data-testid="aic-hold">{h.start}–{h.end} · {h.pendingVerification ? t('aical.holdPendingCode') : t('aical.hold')}</div>
            ))}
          </div>
        ))}
      </div>
      {d.appointments.some((a: any) => !a.technicianId) ? <div className="aic-muted">{t('aical.unassignedNote')}</div> : null}
    </section>
  );
}

// ── Week / Month: chronological salon-local days with totals; tap a day for Day view ───────────────────────────────
function RangeView({ view, date, tick, onPick }: { view: 'week' | 'month'; date: string; tick: number; onPick: (d: string) => void }) {
  const [r, setR] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { setErr(null); try { setR(await posAiCalendarApi.range(view, date)); } catch (e) { setErr(errorTextOf(e, t('aical.loadFailed'))); } }, [view, date]);
  useEffect(() => { void load(); }, [load, tick]);
  if (err) return <ErrorRetry message={err} onRetry={load} />;
  if (!r) return <div className="aic-muted">{t('aical.loading')}</div>;
  const lead = view === 'month' ? (r.days[0].dow + 6) % 7 : 0;
  return (
    <section className="aic-panel" data-testid={`aic-${view}`}>
      <b>{t('aical.rangeTitle', { from: day(r.from), to: day(r.to), n: r.totals.appointments, ai: r.totals.aiCreated })}</b>
      <div className={view === 'month' ? 'aic-month' : 'aic-week'}>
        {view === 'month' ? ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((w) => <div key={w} className="aic-dow">{t(`aical.dow.${w}`)}</div>) : null}
        {Array.from({ length: lead }, (_, i) => <div key={`pad${i}`} />)}
        {r.days.map((x: any) => (
          <button key={x.date} className={`aic-daycell${x.isToday ? ' today' : ''}${x.date === date ? ' sel' : ''}`} onClick={() => onPick(x.date)} data-testid="aic-daycell" data-date={x.date}>
            <span>{view === 'week' ? day(x.date) : Number(x.date.slice(8))}</span>
            <b>{x.appointments}</b>
            {x.aiCreated ? <small className="aic-ai">{t('aical.aiCount', { n: x.aiCreated })}</small> : null}
            {view === 'week' && x.firstStart ? <small>{t('aical.firstAt', { time: x.firstStart })}</small> : null}
          </button>
        ))}
      </div>
    </section>
  );
}

// ── List view: server search, filters, date basis + From/To month calendar, pages 10/20/50 ─────────────────────────
function ListView({ tick, today, onOpen }: { tick: number; today: string; onOpen: (id: string) => void }) {
  const [f, setF] = useState<AicListQuery>({ period: 'month', basis: 'service', sort: 'created', page: 1, pageSize: 20 });
  const [qText, setQText] = useState('');
  const q = useDebounced(qText, 300);
  const [r, setR] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cal, setCal] = useState(false);
  const set = (p: Partial<AicListQuery>) => setF((x) => ({ ...x, ...p, page: 1 }));   // any filter change → page 1
  useEffect(() => { setF((x) => ({ ...x, q: q || undefined, page: 1 })); }, [q]);
  const load = useCallback(async () => { setErr(null); try { setR(await posAiCalendarApi.list(f)); } catch (e) { setErr(errorTextOf(e, t('aical.loadFailed'))); } }, [f]);
  useEffect(() => { void load(); }, [load, tick]);
  const filtered = !!(f.q || f.status || f.source || f.aiOnly);
  return (
    <section className="aic-panel" data-testid="aic-list">
      <div className="aic-row">
        <input className="aic-grow" placeholder={t('aical.searchPh')} aria-label={t('aical.search')} value={qText} onChange={(e) => setQText(e.target.value)} data-testid="aic-search" />
        <select aria-label={t('aical.status')} value={f.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })} data-testid="aic-f-status">
          <option value="">{t('aical.allStatuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{t(`aical.status.${s}`)}</option>)}
        </select>
        <select aria-label={t('aical.source')} value={f.source ?? ''} onChange={(e) => set({ source: e.target.value || undefined })} data-testid="aic-f-source">
          <option value="">{t('aical.allSources')}</option>{SOURCES.map((s) => <option key={s} value={s}>{t(`aical.source.${s}`)}</option>)}
        </select>
        <label className="aic-check"><input type="checkbox" checked={!!f.aiOnly} onChange={(e) => set({ aiOnly: e.target.checked || undefined })} data-testid="aic-f-ai" />{t('aical.aiOnly')}</label>
      </div>
      <div className="aic-row">
        <select aria-label={t('aical.basis')} value={f.basis} onChange={(e) => set({ basis: e.target.value })} data-testid="aic-f-basis">
          {['service', 'created', 'updated', 'cancelled', 'ai_created'].map((b) => <option key={b} value={b}>{t(`aical.basis.${b}`)}</option>)}
        </select>
        {['today', 'week', 'month', 'year'].map((p) => <button key={p} className={`btn ghost${f.period === p ? ' on' : ''}`} onClick={() => set({ period: p, from: undefined, to: undefined })} data-testid={`aic-p-${p}`}>{t(`aical.period.${p}`)}</button>)}
        <button className={`btn ghost${f.period === 'custom' ? ' on' : ''}`} onClick={() => setCal(true)} data-testid="aic-p-custom">{f.period === 'custom' ? `${day(f.from)} – ${day(f.to)}` : t('aical.period.custom')}</button>
        <select aria-label={t('aical.sort')} value={f.sort} onChange={(e) => set({ sort: e.target.value })} data-testid="aic-f-sort">
          {['created', 'scheduled', 'updated'].map((s) => <option key={s} value={s}>{t(`aical.sort.${s}`)}</option>)}
        </select>
        <select aria-label={t('aical.pageSize')} value={f.pageSize} onChange={(e) => set({ pageSize: Number(e.target.value) })} data-testid="aic-f-size">
          {[10, 20, 50].map((n) => <option key={n} value={n}>{t('aical.perPage', { n })}</option>)}
        </select>
        {filtered ? <button className="aic-link" onClick={() => { setQText(''); set({ q: undefined, status: undefined, source: undefined, aiOnly: undefined }); }} data-testid="aic-clear">{t('aical.clearAll')}</button> : null}
      </div>
      <div className="aic-muted" data-testid="aic-list-window">{r ? t('aical.listWindow', { basis: t(`aical.basis.${r.basis}`), from: day(r.from), to: day(r.to), tz: r.timeZone, n: r.total }) : ''}</div>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !r ? <div className="aic-muted">{t('aical.loading')}</div> : !r.items.length ? <Empty title={t('aical.noMatches')}>{filtered ? t('aical.filtersHide') : t('aical.noneInRange')}</Empty> : (
        <div className="aic-scroll"><table className="aic-table" data-testid="aic-table">
          <thead><tr><th>{t('aical.col.created')}</th><th>{t('aical.col.scheduled')}</th><th>{t('aical.col.customer')}</th><th>{t('aical.col.technician')}</th><th>{t('aical.col.services')}</th><th>{t('aical.col.source')}</th><th>{t('aical.col.verification')}</th><th>{t('aical.col.status')}</th></tr></thead>
          <tbody>{r.items.map((x: any) => (
            <tr key={x.id} onClick={() => onOpen(x.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(x.id); }} data-testid="aic-row">
              <td>{when(x.createdAt)}</td><td>{day(x.date)} {x.start}–{x.end}</td><td>{x.customerName ?? '—'}<div className="aic-muted">{x.phone ?? ''}</div></td>
              <td>{x.technicianName ?? '—'}</td><td>{x.services.join(', ') || '—'}</td><td>{x.aiCreated ? <AiBadge /> : t(`aical.source.${x.source}`)}</td>
              <td>{t(`aical.verify.${x.verification}`)}</td><td>{t(`aical.status.${x.status}`)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {r ? <Pager info={{ page: r.page, pageSize: r.pageSize, totalItems: r.total, totalPages: r.totalPages }} onPage={(p) => setF((x) => ({ ...x, page: p }))} /> : null}
      {cal ? (
        <FitDialog title={t('aical.fromTo')} onClose={() => setCal(false)} testId="aic-calendar">
          <RangeCalendar today={today} initial={{ from: f.from, to: f.to }} onApply={(x) => { set({ period: 'custom', from: x.from, to: x.to }); setCal(false); }}
            onCancel={() => setCal(false)} onClear={() => { set({ period: 'month', from: undefined, to: undefined }); setCal(false); }} />
        </FitDialog>
      ) : null}
    </section>
  );
}

// ── Appointment & Customer History overlay ─────────────────────────────────────────────────────────────────────────
const TABS = ['overview', 'customer', 'services', 'history', 'ai', 'holds', 'comms', 'audit'] as const;
function AppointmentOverlay({ id, onClose, nav }: { id: string; onClose: () => void; nav: (to: string) => void }) {
  const [d, setD] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('overview');
  const load = useCallback(async () => { setErr(null); try { setD(await posAiCalendarApi.detail(id)); } catch (e) { setErr(errorTextOf(e, t('aical.loadFailed'))); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  const o = d?.overview;
  const footer = d ? (
    <div className="aic-row">
      <button className="btn" onClick={() => nav(d.links.openBooking)} data-testid="aic-ov-booking">{t('aical.openBooking')}</button>
      {d.links.customer ? <button className="btn ghost" onClick={() => nav(d.links.customer)}>{t('aical.viewCustomer')}</button> : null}
      {d.links.technicianSchedule ? <button className="btn ghost" onClick={() => nav(d.links.technicianSchedule)}>{t('aical.viewTechSchedule')}</button> : null}
      <button className="btn ghost" onClick={onClose} data-testid="aic-ov-close">{t('aical.close')}</button>
    </div>
  ) : <button className="btn ghost" onClick={onClose} data-testid="aic-ov-close">{t('aical.close')}</button>;
  return (
    <FitDialog title={t('aical.ovTitle')} subtitle={o ? `${day(o.date)} ${o.start}–${o.end}` : undefined} onClose={onClose} wide footer={footer} testId="aic-overlay">
      {err ? <ErrorRetry message={err} onRetry={load} /> : !d ? <div className="aic-muted">{t('aical.loading')}</div> : (
        <>
          <div className="aic-seg" role="tablist">{TABS.map((x) => <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)} data-testid={`aic-tab-${x}`}>{t(`aical.tab.${x}`)}</button>)}</div>
          {d.unreadable?.length ? <div className="aic-muted" role="status" data-testid="aic-ov-unreadable">{t('aical.unreadable', { parts: d.unreadable.map((x: string) => t('aical.part.' + x)).join(', ') })}</div> : null}
          <div className="aic-ov-body" data-testid={`aic-ov-${tab}`}>
            {tab === 'overview' ? <KV rows={[[t('aical.f.id'), <code key="id">{o.id}</code>], [t('aical.f.status'), t(`aical.status.${o.status}`)], [t('aical.f.source'), o.aiCreated ? <AiBadge key="ai" /> : t(`aical.source.${o.source}`)],
              [t('aical.f.aiEvidence'), o.aiEvidence], [t('aical.f.verification'), t(`aical.verify.${o.verification}`)], [t('aical.f.timeZone'), o.timeZone], [t('aical.f.created'), when(o.createdAt)], [t('aical.f.updated'), when(o.updatedAt)]]} /> : null}
            {tab === 'customer' ? <KV rows={[[t('aical.f.name'), d.customer.name ?? '—'], [t('aical.f.phone'), d.customer.phone ?? '—'], [t('aical.f.email'), d.customer.email ?? '—'], [t('aical.f.phoneVerified'), d.customer.phoneVerified ? t('aical.yes') : t('aical.no')],
              ...(d.customer.contactMasked ? [[t('aical.f.privacy'), t('aical.masked')] as [string, string]] : [])]} /> : null}
            {tab === 'services' ? <ul>{d.services.map((s: any, i: number) => <li key={i}>{s.name ?? '—'}{s.minutes ? ` · ${t('aical.minutes', { n: s.minutes })}` : ''}</li>)}<li>{t('aical.f.technician')}: {d.technician?.name ?? t('aical.unassigned')}</li></ul> : null}
            {tab === 'history' ? (d.bookingHistory.length ? <ul>{d.bookingHistory.map((h: any) => <li key={h.id}>{day(h.date)} {h.start} · {t(`aical.status.${h.status}`)} · {t(`aical.source.${h.source}`)}</li>)}</ul> : <div className="aic-muted">{t('aical.none')}</div>) : null}
            {tab === 'ai' ? (d.aiActivity.toolResults.length || d.aiActivity.copilotActions.length ? <ul>
              {d.aiActivity.toolResults.map((x: any, i: number) => <li key={`t${i}`}>{x.tool} · {statusLabel('state', x.status)}{x.callRef ? ` · ${t('aical.callRef', { ref: x.callRef })}` : ''} · {when(x.at)}</li>)}
              {d.aiActivity.copilotActions.map((x: any, i: number) => <li key={`c${i}`}>{x.summary ?? x.type} · {statusLabel('state', x.state)} · {when(x.at)}</li>)}</ul> : <div className="aic-muted">{t('aical.noAi')}</div>) : null}
            {tab === 'holds' ? (d.verificationAndHolds.length ? <ul>{d.verificationAndHolds.map((h: any) => <li key={h.id}>{statusLabel('state', h.status)} · {h.channel ?? '—'}{h.codeWasRequired ? ` · ${t('aical.codeRequired')}` : ''}{h.releasedAt ? ` · ${t('aical.released', { when: when(h.releasedAt) })}` : ''}</li>)}</ul> : <div className="aic-muted">{t('aical.noHolds')}</div>) : null}
            {tab === 'comms' ? (d.communications.reminders.length || d.communications.messages.length ? <ul>
              {d.communications.reminders.map((r: any, i: number) => <li key={`r${i}`}>{t('aical.reminder')} · {statusLabel('channel', r.channel)} · {statusLabel('state', r.state)} · {when(r.intendedAt)}</li>)}
              {d.communications.messages.map((m: any, i: number) => <li key={`m${i}`}>{statusLabel('channel', m.channel)} · {m.purpose ?? '—'} · {t(`aical.msg.${m.state}`)} · {when(m.at)}</li>)}</ul> : <div className="aic-muted">{t('aical.none')}</div>) : null}
            {tab === 'audit' ? (d.auditTrail.length ? <ul>{d.auditTrail.map((a: any, i: number) => <li key={i}>{when(a.at)} · {a.summary ?? a.action}</li>)}</ul> : <div className="aic-muted">{t('aical.none')}</div>) : null}
          </div>
        </>
      )}
    </FitDialog>
  );
}
function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return <dl className="aic-kv">{rows.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

// ── Check Calendar System results ──────────────────────────────────────────────────────────────────────────────────
function HealthDialog({ r, onClose }: { r: any; onClose: () => void }) {
  return (
    <FitDialog title={t('aical.healthTitle')} subtitle={r.checkedAt ? `${t('aical.asOf', { when: when(r.checkedAt) })}${r.rateLimited ? ` · ${t('aical.rateLimited')}` : ''}` : undefined} onClose={onClose} wide testId="aic-health"
      footer={<button className="btn ghost" onClick={onClose} data-testid="aic-health-close">{t('aical.close')}</button>}>
      {r.error ? <div className="aic-err" role="alert">{r.error}</div> : (
        <>
          <div className="aic-row"><b>{t('aical.overall')}</b><span className={`aic-state aic-${STATE_TONE[r.overall] ?? 'muted'}`} data-testid="aic-health-overall">{t(`aical.state.${r.overall}`)}</span></div>
          <div className="aic-muted">{t('aical.healthNote')}</div>
          {r.checks.map((c: any) => (
            <div key={c.id} className="aic-check-row" data-testid="aic-check" data-state={c.state}>
              <div className="aic-row aic-between"><b>{c.group} · {c.label}</b><span className={`aic-state aic-${STATE_TONE[c.state] ?? 'muted'}`}>{t(`aical.state.${c.state}`)}</span></div>
              <div>{c.detail}</div><div className="aic-muted">{t('aical.evidence')}: {c.evidence} · {t('aical.sourceLbl')}: {statusLabel(['source', 'state'], c.source)}</div>
              {c.remedy ? <div className="aic-note">{t('aical.nextStep')}: {c.remedy}</div> : null}
            </div>
          ))}
        </>
      )}
    </FitDialog>
  );
}

// ── Smart Scheduling & Availability Assistant (proposals; moves go through Review → Confirm) ───────────────────────
function SchedulingAssistant({ date, onOpen, onDone }: { date: string; onOpen: (id: string) => void; onDone: () => void }) {
  const nav = useNavigate();
  const [r, setR] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [move, setMove] = useState<{ appointmentId: string; date: string; startTime: string } | null>(null);
  const h = useCopilotAction();
  const load = useCallback(async () => { setErr(null); try { setR(await posAiCalendarApi.assistant(date)); } catch (e) { setErr(errorTextOf(e, t('aical.loadFailed'))); } }, [date]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (h.result?.ok) { onDone(); void load(); } }, [h.result, onDone, load]);
  const openings = useMemo(() => (r?.cards ?? []).find((c: any) => c.kind === 'verified_openings'), [r]);
  return (
    <section className="aic-panel" data-testid="aic-assistant">
      <div className="aic-row aic-between"><b>{t('aical.assistant')}</b><span className="aic-muted">{r ? t('aical.checkedAt', { when: when(r.checkedAt) }) : ''}</span></div>
      <div className="aic-muted">{t('aical.assistantGuarantee')}</div>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !r ? <div className="aic-muted">{t('aical.loading')}</div> : !r.cards.length ? <div className="aic-muted" data-testid="aic-assist-empty">{t('aical.noSuggestions')}</div> : r.cards.map((c: any, i: number) => (
        <div key={i} className={`aic-card aic-${c.severity}`} data-testid="aic-card" data-kind={c.kind}>
          <b>{c.title}</b>
          <ul>{c.evidence.map((e: string, j: number) => <li key={j}>{e}</li>)}</ul>
          <div className="aic-muted">{c.note}</div>
          {c.proposal?.type === 'open_booking' ? <button className="btn ghost" onClick={() => nav(`/booking?date=${c.proposal.date}&technicianId=${c.proposal.technicianId}`)} data-testid="aic-card-booking">{t('aical.openBooking')}</button> : null}
          {c.proposal?.type === 'reschedule_review' ? (
            <div className="aic-row">
              <button className="btn ghost" onClick={() => onOpen(c.proposal.appointmentId)} data-testid="aic-card-inspect">{t('aical.inspect')}</button>
              <input type="time" step={900} aria-label={t('aical.newTime')} value={move?.appointmentId === c.proposal.appointmentId ? (move?.startTime ?? '') : ''} onChange={(e) => setMove({ appointmentId: c.proposal.appointmentId, date: c.proposal.date, startTime: e.target.value })} data-testid="aic-move-time" />
              <button className="btn" disabled={!move || move.appointmentId !== c.proposal.appointmentId || !move.startTime || !!h.busy}
                onClick={() => move && h.prepare({ type: 'reschedule_appointment', appointmentId: move.appointmentId, date: move.date, startTime: move.startTime, reason: 'AI Calendar: resolve staff conflict' })} data-testid="aic-move-review">{t('aical.reviewMove')}</button>
            </div>
          ) : null}
        </div>
      ))}
      {openings ? <div className="aic-muted">{t('aical.openingsHint')}</div> : null}
      <PreparedCard h={h} confirmLabel={t('aical.confirmMove')} testId="aic-move" />
      <ActionOutcome h={h} testId="aic-move-outcome" />
    </section>
  );
}
