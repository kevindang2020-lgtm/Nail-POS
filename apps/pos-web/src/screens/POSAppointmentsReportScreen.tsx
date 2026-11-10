// POSAppointmentsReportScreen.tsx — Reports → Appointments (SUNMI batch 9 guide 5, Nov 10 2026). GET /pos/reports/booking
// (pos.reports.view). Preserved: title + subtitle, the four KPI cards, the Outcomes chart and the Breakdown table.
// Fixed: the period tabs did nothing (the screen sent `period`, the API reads `preset`), and the outcomes were not
// appointments at all — Total was the payment-row count, Completed the paid-ticket count (always 100%), Cancelled /
// No-Show a constant 0. They are now the salon's appointments by SCHEDULED day, every status once, all shares of one
// Total (N/A when nothing was booked), with Open / Other rows so the partition adds up.
// The appointment list reuses Appointment History (/pos/appointment-history — the one appointments workspace; it needs the
// customers permission) for the same period, newest first, searchable, paged; a bar filters it.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { posReportsApi } from '../api/posReportsApi';
import { api } from '../api/client';
import { useReportCadence, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { PeriodBar, periodQuery, type PeriodState } from '../components/FinanceKit';
import { Pager } from '../components/FitKit';
import { useCan } from '../components/usePermissions';
import { fmtInTz } from '../i18n/format';
import type { AhListResponse } from '@aipowersalon/api-contracts/tenant';

type BookingsOverview = {
  totalBookings: number; basis?: string;
  completed: number; completedPercent: number | null; cancelled: number; cancelledPercent: number | null;
  noShow: number; noShowPercent: number | null; open?: number; openPercent?: number | null; other?: number; otherPercent?: number | null;
};
type Outcome = { key: string; ahStatus: string; label: string; count: number; share: number | null; extra?: boolean };
const pct = (n: number | null | undefined) => (n == null ? t('rpt.na') : `${n.toFixed(1)}%`);
const PRESETS = ['today', 'week', 'month', 'year', 'custom'];
const APPT_STATUSES = ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service', 'completed', 'cancelled', 'no_show'];

export function POSAppointmentsReportScreen() {
  const { reloadKey } = useReportCadence();
  const [sp, setSp] = useSearchParams();
  const preset = PRESETS.includes(sp.get('preset') || '') ? (sp.get('preset') as PeriodState['preset']) : 'month';
  const period: PeriodState = preset === 'custom' ? { preset, from: sp.get('from') || undefined, to: sp.get('to') || undefined } : { preset };
  const status = sp.get('status') || 'all';
  const setPeriod = (v: PeriodState) => { const p = new URLSearchParams(); p.set('preset', v.preset); if (v.preset === 'custom') { if (v.from) p.set('from', v.from); if (v.to) p.set('to', v.to); } setSp(p); };
  const setStatus = (st: string) => { const p = new URLSearchParams(sp); if (st === 'all') p.delete('status'); else p.set('status', st); setSp(p); };
  const [b, setB] = useState<BookingsOverview | null>(null);
  const [range, setRange] = useState<{ from: string; to: string; timezone?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const can = useCan();
  const nav = useNavigate();
  const pq = periodQuery(period);
  const key = JSON.stringify(pq);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    Promise.all([posReportsApi.booking(pq), Promise.resolve(posReportsApi.state(pq)).catch(() => null)])
      .then(([d, st]: any[]) => { if (alive) { setB(d as BookingsOverview); setRange(st?.dateRange ?? null); } })
      .catch((e: any) => { if (alive) { setB(null); setError(reportError(e, t('admin.reports.noun.appointments'))); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloadKey]);

  const server = range ? { preset, from: range.from, to: range.to, tz: range.timezone ?? '', today: range.to } : null;
  const outcomes: Outcome[] = b ? [
    { key: 'completed', ahStatus: 'completed', label: t('pos.completed_2'), count: b.completed || 0, share: b.completedPercent },
    { key: 'cancelled', ahStatus: 'canceled', label: t('pos.cancelled'), count: b.cancelled || 0, share: b.cancelledPercent },
    { key: 'no_show', ahStatus: 'no_show', label: t('pos.no_show'), count: b.noShow || 0, share: b.noShowPercent },
    ...((b.open ?? 0) > 0 ? [{ key: 'open', ahStatus: 'upcoming', label: t('rpt.appt.open'), count: b.open ?? 0, share: b.openPercent ?? null, extra: true }] : []),
    ...((b.other ?? 0) > 0 ? [{ key: 'other', ahStatus: 'all', label: t('rpt.appt.other'), count: b.other ?? 0, share: b.otherPercent ?? null, extra: true }] : []),
  ] : [];
  const max = Math.max(1, ...outcomes.map((o) => o.count));
  const fromAppointments = b?.basis === 'scheduled_date';

  return (
    <div className="work">
      <div className="vh "><h1>{t('pos.appointments_report')}</h1><div className="sub mb-3">{t('pos.booking_outcomes_for_the_selected_period')}</div></div>
      <PeriodBar value={period} onChange={setPeriod} server={server} basis="scheduled" basisOptions={[{ value: 'scheduled', label: t('rpt.appt.basisScheduled') }]} />
      {loading && !b ? <div className="state">{t('pos.loading_appointments_report')}</div> : null}
      {error ? <div className="err" role="alert" style={{ marginTop: 12 }}>{error}</div> : null}
      {b ? (<>
        {!fromAppointments ? <div className="note mb-2" role="status" data-testid="appt-unavailable">{t('rpt.appt.unavailable')}</div> : null}
        <div className="kpis">
          <div className="kpi"><div className="l">{t('pos.total_bookings')}</div><div className="v">{b.totalBookings ?? 0}</div><div className="d flat">{t('rpt.appt.eachOnce')}</div></div>
          <div className="kpi"><div className="l">{t('pos.completed_2')}</div><div className="v">{b.completed ?? 0}</div><div className="d">{pct(b.completedPercent)}</div></div>
          <div className="kpi"><div className="l">{t('pos.cancelled')}</div><div className="v">{b.cancelled ?? 0}</div><div className="d flat">{pct(b.cancelledPercent)}</div></div>
          <div className="kpi"><div className="l">{t('pos.no_show')}</div><div className="v">{b.noShow ?? 0}</div><div className="d flat">{pct(b.noShowPercent)}</div></div>
        </div>
        <div className="s mb-2" data-testid="appt-basis">{t('rpt.appt.basis')}</div>
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] gap-3 mb-3">
          <section className="panel" style={{ minWidth: 0 }}>
            <div className="p-h">{t('pos.outcomes')}</div>
            {b.totalBookings === 0 ? <div className="state" data-testid="appt-empty">{t('rpt.appt.empty', { from: range?.from ?? '', to: range?.to ?? '' })}</div> : (
              <div role="list" aria-label={t('pos.booking_outcomes')}>
                {outcomes.map((o) => {
                  const tip = t('rpt.appt.tip', { label: o.label, n: String(o.count), share: pct(o.share) });
                  return (
                    <button key={o.key} role="listitem" type="button" title={tip} aria-label={tip} aria-pressed={status === o.ahStatus && o.ahStatus !== 'all'} data-testid={`appt-bar-${o.key}`} className="w-full text-left"
                      style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 160px) minmax(0, 1fr) auto', gap: 10, alignItems: 'center', minHeight: 44, background: 'none', border: 0, cursor: 'pointer', padding: '2px 0' }}
                      onClick={() => setStatus(status === o.ahStatus ? 'all' : o.ahStatus)}>
                      <span style={{ fontWeight: status === o.ahStatus ? 700 : 400 }}>{o.label}</span>
                      <span style={{ height: 14, background: 'var(--line)', borderRadius: 6 }}><span style={{ display: 'block', height: 14, width: `${Math.round((o.count / max) * 100)}%`, minWidth: o.count ? 3 : 0, background: o.key === 'completed' ? 'var(--gold)' : o.extra ? '#9AA5B1' : '#C97B63', borderRadius: 6 }} /></span>
                      <span className="num" style={{ whiteSpace: 'nowrap' }}>{o.count} · {pct(o.share)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
          <section className="panel" style={{ minWidth: 0 }}>
            <div className="p-h">{t('pos.breakdown')}</div>
            <div className="overflow-x-auto w-full"><table className="tbl w-full" data-testid="appt-breakdown">
              <thead><tr><th>{t('pos.outcome')}</th><th style={{ textAlign: 'right' }}>{t('pos.count')}</th><th style={{ textAlign: 'right' }}>{t('pos.share')}</th></tr></thead>
              <tbody>{outcomes.map((o) => (
                <tr key={o.key}><td>{o.label}</td><td style={{ textAlign: 'right' }}>{o.count}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{pct(o.share)}</td></tr>
              ))}
              <tr><td style={{ fontWeight: 700 }}>{t('pos.total_bookings')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{b.totalBookings}</td><td style={{ textAlign: 'right' }}>{b.totalBookings ? '100.0%' : t('rpt.na')}</td></tr></tbody>
            </table></div>
          </section>
        </div>

        <section className="panel mb-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="p-h">{t('rpt.appt.list')}</div>
            {can('pos.customers.view') ? <button className="btn ghost sm" onClick={() => { const p = new URLSearchParams({ ...Object.fromEntries(Object.entries(pq).map(([k, v]) => [k, String(v)])), ...(status !== 'all' ? { status } : {}) }); nav('/tenant/customers/appointment-history?' + p.toString()); }}>{t('rpt.appt.openHistory')}</button> : null}</div>
          {can('pos.customers.view') ? <AppointmentList period={pq} status={status} onClearStatus={() => setStatus('all')} /> : <div className="s" data-testid="appt-list-restricted">{t('rpt.appt.listRestricted')}</div>}
        </section>
      </>) : null}
    </div>
  );
}

/** the period's appointments from Appointment History (one appointments workspace): newest first, searchable, paged. */
export function AppointmentList({ period, status, onClearStatus }: { period: Record<string, unknown>; status: string; onClearStatus: () => void }) {
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [d, setD] = useState<AhListResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = JSON.stringify(period);
  const first = useRef(true);
  useEffect(() => { setPage(1); }, [key, q, size, status]);
  useEffect(() => { if (first.current) { first.current = false; return; } const h = setTimeout(() => setQ(draft.trim()), 300); return () => clearTimeout(h); }, [draft]);
  useEffect(() => {
    let alive = true; setErr(null);
    (api.get('/pos/appointment-history/appointments', { ...period, dateField: 'scheduled', status, sort: 'newest', q: q || undefined, page, pageSize: size }) as Promise<AhListResponse>)
      .then((r) => { if (!alive) return; if (Array.isArray(r?.items)) setD(r); else { setD(null); setErr(t('rpt.appt.listFailed')); } })
      .catch((e: any) => { if (alive) { setD(null); setErr(reportError(e, t('rpt.appt.list'))); } });
    return () => { alive = false; };
  }, [key, q, page, size, status]);   // eslint-disable-line react-hooks/exhaustive-deps -- period keyed by its JSON
  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-2">
        <input className="input" style={{ minWidth: 300, minHeight: 44 }} data-testid="appt-search" maxLength={80} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('rpt.appt.search')} aria-label={t('rpt.appt.search')} />
        {draft ? <button className="btn ghost sm" onClick={() => { setDraft(''); setQ(''); }}>{t('rpt.tx.clear')}</button> : null}
        {status !== 'all' ? <span className="chip" data-testid="appt-chip">{t('rpt.appt.st.' + status)} <button className="btn ghost sm" aria-label={t('rpt.tx.clear')} onClick={onClearStatus}>×</button></span> : null}
        <label className="s">{t('rpt.tx.perPage')}{' '}<select className="input" style={{ minHeight: 44 }} value={size} onChange={(e) => setSize(Number(e.target.value))}>{[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        {d ? <span className="s" data-testid="appt-count">{t('rpt.appt.count', { n: String(d.total) })}</span> : null}
      </div>
      {err ? <div className="err" role="alert">{err}</div> : !d ? <div className="muted">{t('pos.loading_reports')}</div> : d.items.length === 0 ? (
        <div className="muted" data-testid="appt-nomatch">{q || status !== 'all' ? t('rpt.tx.noMatch') : t('rpt.appt.none')}</div>
      ) : (
        <div className="overflow-x-auto w-full"><table className="tbl w-full" data-testid="appt-table">
          <thead><tr><th>{t('rpt.appt.when')}</th><th>{t('rpt.svc.customer')}</th><th>{t('rpt.appt.services')}</th><th>{t('rpt.svc.tech')}</th><th>{t('rpt.sales.status')}</th><th>{t('rpt.appt.source')}</th><th>{t('rpt.appt.booked')}</th></tr></thead>
          <tbody>{d.items.map((a) => (
            <tr key={a.id}>
              <td className="whitespace-nowrap">{a.date}{a.startTime ? ' · ' + a.startTime.slice(0, 5) : ''}</td>
              <td>{a.customer || t('rpt.tx.walkIn')}{a.phone ? <div className="s">{a.phone}</div> : null}</td>
              <td style={{ minWidth: 160 }}>{a.services || '—'}</td>
              <td>{a.technician || (a.anyTechnician ? t('rpt.appt.anyTech') : '—')}</td>
              <td>{APPT_STATUSES.includes(a.status) ? t('rpt.appt.status.' + a.status) : t('rpt.appt.other')}</td>
              <td>{a.source || '—'}</td>
              <td className="whitespace-nowrap">{a.createdAt ? fmtInTz(a.createdAt, d.period?.timeZone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {d ? <Pager info={{ page: d.page, pageSize: d.pageSize, totalItems: d.total, totalPages: d.totalPages }} onPage={setPage} label={t('rpt.appt.pager')} /> : null}
    </div>
  );
}
