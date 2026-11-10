// POSServicesReportScreen.tsx — Reports → Services, the expanded "Revenue by Service" workspace (SUNMI batch 9 guide 2,
// Nov 10 2026). One shared calculation with the Daily Summary card: GET /pos/reports/service-revenue (pos.reports.view).
//  · period = presets + Custom From–To calendar (salon days, branch time zone) — kept in the URL with the category,
//    search and page, so Back / refresh / returning from a ticket restore the view
//  · categories rank by sales (stable); clicking one filters the lines; every other bar stays visible
//  · lines: newest first, server-paged 25/50/100; totals cover EVERY match, never just the page
//  · discounts and refunds are recorded per ticket, so they are shown beside the lines — never spread over services
// Preserved: title, KPIs, the bars, the breakdown table, Full View (iPad) and the empty state.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { posReportsApi } from '../api/posReportsApi';
import { useReportCadence, money, reportError, svcCategoryLabel } from './reportsCommon';
import { useIPadView } from '../components/IPadViewProvider';
import { reportRequest } from '../components/ipad-modules';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { PeriodBar, periodQuery, type PeriodState } from '../components/FinanceKit';
import { Pager } from '../components/FitKit';
import { SystemCheckButton } from '../components/SystemCheck';
import { useCan } from '../components/usePermissions';
import { fmtInTz } from '../i18n/format';
import type { ServiceRevenueReport } from '@aipowersalon/api-contracts/tenant';

const PRESETS = ['today', 'week', 'month', 'year', 'custom'];

export function POSServicesReportScreen() {
  const { reloadKey } = useReportCadence();
  const nav = useNavigate();
  const can = useCan();
  const { open: openIPad } = useIPadView();
  const [sp, setSp] = useSearchParams();
  const preset = PRESETS.includes(sp.get('preset') || '') ? (sp.get('preset') as PeriodState['preset']) : 'month';
  const period: PeriodState = preset === 'custom' ? { preset, from: sp.get('from') || undefined, to: sp.get('to') || undefined } : { preset };
  const category = sp.get('category') || '';
  const service = sp.get('service') || '';
  const by: 'category' | 'service' = sp.get('by') === 'service' ? 'service' : 'category';
  const q = sp.get('q') || '';
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const pageSize = [25, 50, 100].includes(Number(sp.get('pageSize'))) ? Number(sp.get('pageSize')) : 25;
  const [draft, setDraft] = useState(q);
  const [r, setR] = useState<ServiceRevenueReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  /** any filter change resets to page 1 (guide §9); the page itself keeps the filters */
  const patch = (next: Record<string, string | undefined>, keepPage = false) => {
    const p = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(next)) { if (v == null || v === '') p.delete(k); else p.set(k, v); }
    if (!keepPage) p.delete('page');
    setSp(p, { replace: false });
  };
  const setPeriod = (v: PeriodState) => patch({ preset: v.preset, from: v.preset === 'custom' ? v.from : undefined, to: v.preset === 'custom' ? v.to : undefined });

  // debounced search (300 ms)
  const first = useRef(true);
  useEffect(() => { setDraft(q); }, [q]);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const h = setTimeout(() => { if (draft.trim() !== q) patch({ q: draft.trim() || undefined }); }, 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const query = useMemo(() => ({ ...periodQuery(period), q: q || undefined, category: category || undefined, service: service || undefined, page, pageSize }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preset, period.from, period.to, q, category, service, page, pageSize]);
  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    (posReportsApi.serviceRevenue(query) as Promise<ServiceRevenueReport>)
      .then((d) => { if (alive) setR(d); })
      // an error never falls back to all records or the last answer: the error is shown, the old figures are cleared
      .catch((e: any) => { if (alive) { setR(null); setError(reportError(e, t('pos.services_report'))); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [query, reloadKey]);

  const doExport = async () => {
    setNote(null); setExporting(true);
    try {
      const x: any = await posReportsApi.exportReport({ type: 'service_lines', format: 'csv', ...periodQuery(period), q: q || undefined, category: category || undefined, service: service || undefined });
      if (x?.disabledReason) setNote(x.disabledReason);
      else if (x?.csv != null) {
        const url = URL.createObjectURL(new Blob([x.csv], { type: 'text/csv;charset=utf-8;' }));
        const a = document.createElement('a'); a.href = url; a.download = x.filename || 'service-lines.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
        setNote(t('rpt.svc.exported'));
      }
    } catch (e: any) { setNote(reportError(e, t('pos.services_report'))); } finally { setExporting(false); }
  };

  const cats = (by === 'service' ? r?.services : r?.categories) ?? [];
  const maxRev = Math.max(1, ...cats.map((c) => c.grossCents));
  const tz = r?.period.timezone ?? null;
  const server = r ? { preset, from: r.period.from, to: r.period.to, tz: tz ?? '', today: r.period.to } : null;
  const filtered = !!(q || category || service);
  const totals = r?.totals;
  const label = (k: string, n: string) => svcCategoryLabel(k, n);
  const selKey = by === 'service' ? service : category;
  const pick = (k: string) => (by === 'service' ? patch({ service: k === service ? undefined : k }) : patch({ category: k === category ? undefined : k }));

  return (
    <div className="work">
      <div className="vh "><h1>{t('pos.services_report')}</h1><div className="sub mb-3">{t('pos.revenue_and_volume_by_service')}</div></div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn ghost" data-testid="svc-back" onClick={() => nav('/reports')}>{t('rpt.svc.back')}</button>
          <SystemCheckButton domain="reports" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can('pos.reports.export') ? <button className="btn ghost" data-testid="svc-export" disabled={exporting || !r} onClick={doExport}>{exporting ? t('pos.exporting') : t('rpt.svc.export')}</button> : null}
          <button className="btn ghost w-fit whitespace-nowrap" title={t('pos.open_full_ipad_view')} disabled={!r} onClick={() => r && openIPad(reportRequest(t('pos.services_report'), { kpis: [{ label: t('pos.total_revenue'), value: money(r.totals.grossCents) }, { label: t('pos.services'), value: r.totals.units }], columns: [t('glossary.term.service'), t('pos.revenue'), t('pos.count')], rows: cats.map((c) => [label(c.key, c.name), money(c.grossCents), c.units]), periodLabel: `${r.period.from} – ${r.period.to}` }))}>{t('pos.full_view')}</button>
        </div>
      </div>
      <PeriodBar value={period} onChange={setPeriod} server={server} basis="paid" basisOptions={[{ value: 'paid', label: t('rpt.basisPaid') }]} />
      <div className="flex flex-wrap items-center gap-2 my-2">
        <input className="input" style={{ minWidth: 300, minHeight: 44 }} data-testid="svc-search" maxLength={80} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('rpt.svc.search')} aria-label={t('rpt.svc.search')} />
        {category ? <span className="chip" data-testid="svc-chip-category">{label(category, cats.find((c) => c.key === category)?.name ?? category)} <button className="btn ghost sm" aria-label={t('rpt.tx.clear')} onClick={() => patch({ category: undefined })}>×</button></span> : null}
        {service ? <span className="chip" data-testid="svc-chip-service">{(r?.services ?? []).find((c) => c.key === service)?.name || t('pos.service_3')} <button className="btn ghost sm" aria-label={t('rpt.tx.clear')} onClick={() => patch({ service: undefined })}>×</button></span> : null}
        {q ? <span className="chip" data-testid="svc-chip-q">“{q}” <button className="btn ghost sm" aria-label={t('rpt.tx.clear')} onClick={() => { setDraft(''); patch({ q: undefined }); }}>×</button></span> : null}
        {filtered ? <button className="btn ghost sm" data-testid="svc-clear-all" onClick={() => { setDraft(''); patch({ q: undefined, category: undefined, service: undefined }); }}>{t('rpt.svc.clearAll')}</button> : null}
        {r ? <span className="s" data-testid="svc-count">{t('rpt.svc.count', { n: String(r.history.total) })}</span> : null}
        {r ? <span className="s">{t('rpt.svc.asOf', { at: fmtInTz(r.asOf, tz, { hour: 'numeric', minute: '2-digit' }) })}</span> : null}
      </div>
      {note ? <div className="note mb-2" role="status">{note}</div> : null}
      {error ? <div className="err mb-2" role="alert" data-testid="svc-error">{error}</div> : null}
      {loading && !r ? <div className="state">{t('pos.loading_services_report')}</div> : null}

      {r ? (<>
        <div className="kpis">
          <div className="kpi"><div className="l">{t('pos.service_revenue')}</div><div className="v" data-testid="svc-kpi-sales">{money(totals!.grossCents)}</div><div className="d">{t('rpt.svc.beforeDiscounts')}</div></div>
          <div className="kpi"><div className="l">{t('pos.services_sold')}</div><div className="v">{totals!.units}</div></div>
          <div className="kpi"><div className="l">{t('rpt.svc.avg')}</div><div className="v">{totals!.averageCents == null ? t('rpt.na') : money(totals!.averageCents)}</div></div>
          <div className="kpi"><div className="l">{t('pos.unique_services')}</div><div className="v" data-testid="svc-kpi-unique">{totals!.uniqueServices ?? (r.services ?? []).filter((c) => !c.unmapped).length}</div></div>
          <div className="kpi"><div className="l">{t('rpt.svc.discounts')}</div><div className="v">{money(totals!.ticketDiscountCents)}</div><div className="d">{t('rpt.svc.ticketLevel')}</div></div>
          <div className="kpi"><div className="l">{t('rpt.svc.refunds')}</div><div className="v">{money(totals!.refundedCents)}</div><div className="d">{t('rpt.svc.ticketLevel')}</div></div>
        </div>
        <div className="s mb-2" data-testid="svc-basis">{t('rpt.svc.definition')}</div>
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 mb-3">
          <section className="panel" style={{ minWidth: 0 }}>
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="p-h">{t('pos.top_services_by_revenue')}</div>
              <div className="fk-seg" role="group" aria-label={t('rpt.svc.groupBy')}>{(['category', 'service'] as const).map((g) => <button key={g} type="button" className={by === g ? 'on' : ''} aria-pressed={by === g} style={{ minHeight: 44 }} data-testid={`svc-by-${g}`} onClick={() => patch({ by: g === 'category' ? undefined : g }, true)}>{t('rpt.svc.by.' + g)}</button>)}</div></div>
            {cats.length === 0 ? <div className="state" data-testid="svc-empty">{t('rpt.svc.empty', { from: r.period.from, to: r.period.to })}</div> : (
              <div className="list" role="list" aria-label={t('pos.revenue_by_service_2')}>
                {cats.map((c) => {
                  const nm = label(c.key, c.name); const on = c.key === selKey;
                  const tip = t('rpt.svc.tip', { name: nm, units: String(c.units), amount: money(c.grossCents) });
                  return (
                    <button key={c.key} role="listitem" type="button" aria-pressed={on} title={tip} aria-label={tip} className="w-full text-left" data-testid={`svc-bar-${c.key}`}
                      style={{ padding: '6px 4px', minHeight: 44, background: on ? 'var(--panel-2, rgba(0,0,0,.04))' : 'none', border: 0, borderRadius: 6, cursor: 'pointer' }}
                      onClick={() => pick(c.key)}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: on ? 700 : 400 }}>{nm} <span className="s">· {c.units}</span></span><span className="num">{money(c.grossCents)}</span></div>
                      <div style={{ height: 6, background: 'var(--line)', borderRadius: 4, marginTop: 3 }}><div style={{ height: 6, width: `${Math.round((c.grossCents / maxRev) * 100)}%`, background: c.unmapped ? 'var(--aps-orange)' : 'var(--gold)', borderRadius: 4 }} /></div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
          <section className="panel" style={{ minWidth: 0 }}>
            <div className="p-h">{t('pos.breakdown')}</div>
            {cats.length === 0 ? <div className="state">{t('pos.no_data')}</div> : (
              <div className="overflow-x-auto w-full"><table className="tbl w-full">
                <thead><tr><th>{t('pos.service_3')}</th><th style={{ textAlign: 'right' }}>{t('pos.count')}</th><th style={{ textAlign: 'right' }}>{t('pos.revenue')}</th><th style={{ textAlign: 'right' }}>%</th></tr></thead>
                <tbody>{cats.map((c) => (
                  <tr key={c.key}><td>{label(c.key, c.name)}</td><td style={{ textAlign: 'right' }}>{c.units}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(c.grossCents)}</td><td style={{ textAlign: 'right' }}>{c.percentOfTop}%</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        </div>

        <section className="panel">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="p-h">{t('rpt.svc.lines')}</div>
            <label className="s">{t('rpt.tx.perPage')}{' '}<select className="input" style={{ minHeight: 44 }} data-testid="svc-size" value={pageSize} onChange={(e) => patch({ pageSize: e.target.value })}>{[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select></label></div>
          {r.history.items.length === 0 ? <div className="state" data-testid="svc-nomatch">{filtered ? t('rpt.tx.noMatch') : t('rpt.svc.empty', { from: r.period.from, to: r.period.to })}</div> : (
            <div className="overflow-x-auto w-full"><table className="tbl w-full" data-testid="svc-lines">
              <thead><tr><th>{t('rpt.svc.paidAt')}</th><th>{t('rpt.svc.ticket')}</th><th>{t('pos.service_3')}</th><th>{t('rpt.svc.category')}</th><th>{t('rpt.svc.tech')}</th>{r.customersVisible ? <th>{t('rpt.svc.customer')}</th> : null}<th style={{ textAlign: 'right' }}>{t('pos.count')}</th><th style={{ textAlign: 'right' }}>{t('rpt.svc.amount')}</th></tr></thead>
              <tbody>{r.history.items.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap">{fmtInTz(l.occurredAt, tz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                  <td>{l.ticketNumber ? `#${l.ticketNumber}` : '—'}</td>
                  <td>{l.noLines ? t('rpt.svc.noLines') : l.serviceName || '—'}</td>
                  <td>{l.noLines ? '—' : l.unmapped ? t('rpt.svc.unmapped') : l.category}</td>
                  <td>{l.technician || '—'}</td>
                  {r.customersVisible ? <td>{l.customer || t('rpt.tx.walkIn')}</td> : null}
                  <td style={{ textAlign: 'right' }}>{l.units}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(l.grossCents)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <Pager info={{ page: r.history.page, pageSize: r.history.pageSize, totalItems: r.history.total, totalPages: Math.max(1, Math.ceil(r.history.total / r.history.pageSize)) }} onPage={(p) => patch({ page: String(p) }, true)} label={t('rpt.svc.pager')} />
          {!r.customersVisible ? <div className="s mt-1">{t('rpt.svc.noCustomers')}</div> : null}
        </section>
      </>) : null}
    </div>
  );
}
