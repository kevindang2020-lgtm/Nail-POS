// POSTechniciansReportScreen.tsx — Reports → Technicians (SUNMI batch 9 guide 6, Nov 10 2026). GET /pos/reports/technicians
// (pos.reports.view + financial or technician_view). Preserved: title, Full View, the three KPI cards, Revenue by
// Technician and the Leaderboard (#, Technician, Done, Revenue).
// Fixed: the period tabs did nothing (`period` sent, `preset` read) and attribution was by the ticket's PRIMARY technician
// — a two-technician ticket credited one of them with everything (retail included) and "Done" counted tickets. Now each
// technician owns only their own service lines (the shared line calculation), Done = services, and the lines nobody is
// assigned to stay visible as their own row so the board adds up to Service Sales.
// Added: custom dates (URL), ranked horizontal bars that scale to any team size, a name filter, and a read-only drill-down
// to one technician's service lines (newest first, paged) — no commission, tip or payroll figures are recomputed here.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { posReportsApi } from '../api/posReportsApi';
import { useReportCadence, money, reportError, useUrlPeriod, servicesReportHref } from './reportsCommon';
import { useIPadView } from '../components/IPadViewProvider';
import { reportRequest } from '../components/ipad-modules';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { PeriodBar } from '../components/FinanceKit';
import { Pager } from '../components/FitKit';
import { fmtInTz } from '../i18n/format';
import type { ServiceRevenueReport } from '@aipowersalon/api-contracts/tenant';

type TechRow = { technicianId: string; rank: number; name: string; roleLabel: string; revenueCents: number; completedServices: number; tickets?: number; unattributed?: boolean };
const techName = (r: TechRow) => (r.technicianId === '__no_lines__' ? t('rpt.svc.noLines') : r.technicianId === '__unassigned__' ? t('rpt.tech.unassigned') : r.name);

export function POSTechniciansReportScreen() {
  const { reloadKey } = useReportCadence();
  const { period, setPeriod, query, sp, setParam } = useUrlPeriod('month', ['page', 'tech']);
  const [rows, setRows] = useState<TechRow[] | null>(null);
  const [range, setRange] = useState<{ from: string; to: string; timezone?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const { open: openIPad } = useIPadView();
  const nav = useNavigate();
  const selected = sp.get('tech');
  const key = JSON.stringify(query);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    Promise.all([posReportsApi.technicians(query), Promise.resolve(posReportsApi.state(query)).catch(() => null)])
      .then(([d, st]: any[]) => { if (alive) { setRows(Array.isArray(d) ? d : (d?.rows ?? d?.technicians ?? [])); setRange(st?.dateRange ?? null); } })
      .catch((e: any) => { if (alive) { setRows(null); setError(reportError(e, t('pos.technicians_report'))); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloadKey]);

  const all = useMemo(() => (rows || []).slice().sort((a, b) => Number(!!a.unattributed) - Number(!!b.unattributed) || (a.rank || 0) - (b.rank || 0)), [rows]);
  const named = all.filter((r) => !r.unattributed);
  const fold = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const list = filter ? all.filter((r) => fold(techName(r)).includes(fold(filter))) : all;
  const totalRevenue = named.reduce((a, r) => a + (r.revenueCents || 0), 0);
  const totalCompleted = named.reduce((a, r) => a + (r.completedServices || 0), 0);
  const unattributed = all.filter((r) => r.unattributed).reduce((a, r) => a + r.revenueCents, 0);
  const maxRev = Math.max(1, ...all.map((r) => r.revenueCents));
  const server = range ? { preset: period.preset, from: range.from, to: range.to, tz: range.timezone ?? '', today: range.to } : null;
  const sel = all.find((r) => r.technicianId === selected) ?? null;

  return (
    <div className="work">
      <div className="vh "><h1>{t('pos.technicians_report')}</h1><div className="sub mb-3">{t('pos.revenue_and_services_completed_by_technician')}</div></div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <PeriodBar value={period} onChange={setPeriod} server={server} basis="paid" basisOptions={[{ value: 'paid', label: t('rpt.basisPaid') }]} />
        <button className="btn ghost w-fit whitespace-nowrap" disabled={!rows} title={t('pos.open_full_ipad_view')} onClick={() => openIPad(reportRequest(t('pos.technicians_report'), { kpis: [{ label: t('pos.total_revenue'), value: money(totalRevenue) }, { label: t('pos.technicians'), value: named.length }], columns: ['#', t('pos.technician'), t('pos.services'), t('pos.revenue')], rows: all.map((r) => [r.rank || '—', techName(r), r.completedServices, money(r.revenueCents)]), periodLabel: range ? `${range.from} – ${range.to}` : undefined }))}>{t('pos.full_view')}</button>
      </div>
      {loading && !rows ? <div className="state">{t('pos.loading_technicians_report')}</div> : null}
      {error ? <div className="err" role="alert" style={{ marginTop: 12 }}>{error}</div> : null}
      {rows ? (<>
        <div className="kpis">
          <div className="kpi"><div className="l">{t('pos.technician_revenue')}</div><div className="v" data-testid="tech-kpi-rev">{money(totalRevenue)}</div><div className="d flat">{t('rpt.svc.beforeDiscounts')}</div></div>
          <div className="kpi"><div className="l">{t('pos.services_completed')}</div><div className="v">{totalCompleted}</div></div>
          <div className="kpi"><div className="l">{t('pos.technicians')}</div><div className="v">{named.length}</div></div>
        </div>
        <div className="s mb-2" data-testid="tech-basis">{t('rpt.tech.basis')}{unattributed > 0 ? ' ' + t('rpt.tech.unattributedNote', { amount: money(unattributed) }) : ''}</div>
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-3 mb-3">
          <section className="panel" style={{ minWidth: 0 }}>
            <div className="p-h">{t('pos.revenue_by_technician')}</div>
            {all.length === 0 ? <div className="state" data-testid="tech-empty">{t('rpt.tech.empty', { from: range?.from ?? '', to: range?.to ?? '' })}</div> : (
              <div role="list" aria-label={t('pos.revenue_by_technician_2')} style={{ maxHeight: 420, overflowY: 'auto' }}>
                {all.map((r) => {
                  const tip = t('rpt.tech.tip', { name: techName(r), amount: money(r.revenueCents), n: String(r.completedServices) });
                  return (
                    <button key={r.technicianId} role="listitem" type="button" title={tip} aria-label={tip} aria-pressed={selected === r.technicianId} data-testid={`tech-bar-${r.technicianId}`} className="w-full text-left"
                      style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 180px) minmax(0, 1fr) auto', gap: 10, alignItems: 'center', minHeight: 44, background: 'none', border: 0, cursor: 'pointer' }}
                      onClick={() => setParam('tech', selected === r.technicianId ? null : r.technicianId)}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: selected === r.technicianId ? 700 : 400 }}>{techName(r)}</span>
                      <span style={{ height: 14, background: 'var(--line)', borderRadius: 6 }}><span style={{ display: 'block', height: 14, width: `${Math.round((r.revenueCents / maxRev) * 100)}%`, minWidth: r.revenueCents ? 3 : 0, background: r.unattributed ? '#9AA5B1' : 'var(--gold)', borderRadius: 6 }} /></span>
                      <span className="num">{money(r.revenueCents)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
          <section className="panel" style={{ minWidth: 0 }}>
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="p-h">{t('pos.leaderboard')}</div><span className="s">{t('rpt.tech.rankedBy')}</span></div>
            <input className="input mb-2" style={{ minHeight: 44, width: '100%' }} data-testid="tech-filter" value={filter} maxLength={60} onChange={(e) => setFilter(e.target.value)} placeholder={t('rpt.tech.filter')} aria-label={t('rpt.tech.filter')} />
            {list.length === 0 ? <div className="state">{filter ? t('rpt.tx.noMatch') : t('pos.no_data')}</div> : (
              <div className="overflow-x-auto w-full"><table className="tbl w-full">
                <thead><tr><th>#</th><th>{t('pos.technician')}</th><th style={{ textAlign: 'right' }}>{t('pos.done')}</th><th style={{ textAlign: 'right' }}>{t('rpt.tech.tickets')}</th><th style={{ textAlign: 'right' }}>{t('pos.revenue')}</th></tr></thead>
                <tbody>{list.map((r) => (
                  <tr key={r.technicianId} onClick={() => setParam('tech', r.technicianId)} style={{ cursor: 'pointer' }}>
                    <td>{r.rank || '—'}</td><td>{techName(r)}{!r.unattributed ? <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('pos.technician')}</div> : null}</td>
                    <td style={{ textAlign: 'right' }}>{r.completedServices}</td><td style={{ textAlign: 'right' }}>{r.tickets ?? '—'}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.revenueCents)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        </div>
        {sel ? (
          <section className="panel mb-3" data-testid="tech-detail">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="p-h">{t('rpt.tech.detail', { name: techName(sel) })}</div>
              <div className="flex gap-2">
                <button className="btn ghost sm" onClick={() => nav('/tenant/reports/commission?' + new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString())}>{t('rpt.tech.commission')}</button>
                <button className="btn ghost sm" onClick={() => nav(servicesReportHref(query))}>{t('rpt.tech.services')}</button>
                <button className="btn ghost sm" aria-label={t('rpt.tx.clear')} onClick={() => setParam('tech', null)}>×</button>
              </div>
            </div>
            <TechLines period={query} technician={sel.technicianId} />
          </section>
        ) : null}
      </>) : null}
    </div>
  );
}

/** one technician's service lines — the shared service-revenue calculation filtered to them; newest first; paged. */
export function TechLines({ period, technician }: { period: Record<string, unknown>; technician: string }) {
  const [page, setPage] = useState(1);
  const [d, setD] = useState<ServiceRevenueReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = JSON.stringify(period) + technician;
  useEffect(() => { setPage(1); }, [key]);
  useEffect(() => {
    let alive = true; setErr(null);
    (posReportsApi.serviceRevenue({ ...period, technician, page, pageSize: 25 }) as Promise<ServiceRevenueReport>)
      .then((r) => { if (alive) setD(r); })
      .catch((e: any) => { if (alive) { setD(null); setErr(reportError(e, t('rpt.svc.lines'))); } });
    return () => { alive = false; };
  }, [key, page]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="err" role="alert">{err}</div>;
  if (!d) return <div className="muted">{t('pos.loading_reports')}</div>;
  return (
    <div>
      <div className="s mb-1" data-testid="tech-detail-totals">{t('rpt.tech.detailTotals', { amount: money(d.totals.grossCents), n: String(d.totals.units), tickets: String(d.totals.tickets) })}</div>
      {d.history.items.length === 0 ? <div className="muted">{t('rpt.tx.noMatch')}</div> : (
        <div className="overflow-x-auto w-full"><table className="tbl w-full">
          <thead><tr><th>{t('rpt.svc.paidAt')}</th><th>{t('rpt.svc.ticket')}</th><th>{t('pos.service_3')}</th>{d.customersVisible ? <th>{t('rpt.svc.customer')}</th> : null}<th style={{ textAlign: 'right' }}>{t('pos.count')}</th><th style={{ textAlign: 'right' }}>{t('rpt.svc.amount')}</th></tr></thead>
          <tbody>{d.history.items.map((l) => (
            <tr key={l.id}><td className="whitespace-nowrap">{fmtInTz(l.occurredAt, d.period.timezone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
              <td>{l.ticketNumber ? `#${l.ticketNumber}` : '—'}</td><td>{l.noLines ? t('rpt.svc.noLines') : l.serviceName || '—'}</td>
              {d.customersVisible ? <td>{l.customer || t('rpt.tx.walkIn')}</td> : null}
              <td style={{ textAlign: 'right' }}>{l.units}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(l.grossCents)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      <Pager info={{ page: d.history.page, pageSize: d.history.pageSize, totalItems: d.history.total, totalPages: Math.max(1, Math.ceil(d.history.total / d.history.pageSize)) }} onPage={setPage} label={t('rpt.svc.pager')} />
    </div>
  );
}
