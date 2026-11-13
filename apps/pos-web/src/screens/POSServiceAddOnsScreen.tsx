// POSServiceAddOnsScreen.tsx — Services → Add-Ons (/tenant/services/add-ons). Rebuild (Oct 30 2026), one vertical scroll:
//   + New Add-On · the four cards (Total Add-Ons · Active · Services Offering · Avg Price) — counted in OFFERINGS (one
//   add-on on one service, the rows of the table), the definitions they share are said under the first card · ONE search
//   box (add-on · service · category · "$10" price) · All statuses · Today / Week / Month / Year / Custom with its date
//   field · tabs Add-Ons | Customer Add-On History (paid ticket add-on lines, by customer · phone · #ticket), server-paged,
//   newest first · the eight columns (ADD-ON · SERVICE · CATEGORY · PRICE · + TIME · TAXABLE · STATUS · ACTIONS) with Edit /
//   Archive / Restore · Add-On details (Overview · Assignments · Pricing · Usage · Audit) · Back to Services / Categories /
//   Pricing.
// One definition offered on several services (French tips on Gel Manicure, Classic Pedicure, Haircut and Hair Coloring) is
// ONE add-on: an edit says whether it changes the shared definition or this one service's offering. A nail add-on on a hair
// service is FLAGGED for review — never removed. A new add-on is offered only on the services you choose (never all).
import { useEffect, useState } from 'react';
import { SystemCheckButton } from '../components/SystemCheck';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posCatalogApi } from '../api/posCatalogApi';
import { useCan } from '../components/usePermissions';
import { AddOnProfitPanel } from './AddOnProfitPanel';
import { errorTextOf } from '../i18n/error-text';
import { fmtMoney } from '../i18n/format';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useDebounced } from '../components/FitKit';
import { PeriodBar, periodQuery, useLoad, StateBlock, isForbidden, centsFromText, textFromCents, useFreshAt, FreshnessLine, type PeriodState } from '../components/FinanceKit';
import { nf, money, mins, day, whenTime, pageOf, ChangeHistoryTable } from './catalogShared';

type Tab = 'catalog' | 'usage';
const PAGE = 10;
const plusMin = (m: number) => (m ? `+${tx('cg.min', { n: nf(m) })}` : '—');

export function POSServiceAddOnsScreen() {
  const nav = useNavigate(); const can = useCan(); const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>('catalog');
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [status, setStatus] = useState('all'); const [taxable, setTaxable] = useState(''); const [sort, setSort] = useState('newest');
  const [periods, setPeriods] = useState<Record<Tab, PeriodState>>({ catalog: { preset: 'all' }, usage: { preset: 'month' } });
  const period = periods[tab]; const setPeriod = (p: PeriodState) => setPeriods((x) => ({ ...x, [tab]: p }));
  const [dateField, setDateField] = useState('created'); const [usageField, setUsageField] = useState('paid');
  const [pages, setPages] = useState<Record<Tab, number>>({ catalog: 1, usage: 1 }); const setPg = (t: Tab) => (n: number) => setPages((x) => ({ ...x, [t]: n }));
  const [tick, setTick] = useState(0); const reload = () => setTick((n) => n + 1);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [detail, setDetail] = useState<{ key: string; tab?: DTab } | null>(null);
  const [editing, setEditing] = useState<{ key: string; row?: any } | null>(null);
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [archiving, setArchiving] = useState<{ row: any; restore: boolean } | null>(null);

  const scope = { q: q || undefined, status, taxable: taxable || undefined, sort, dateField, ...periodQuery(periods.catalog) };
  const uscope = { q: q || undefined, dateField: usageField, ...periodQuery(periods.usage) };
  const keys = { catalog: JSON.stringify(scope), usage: JSON.stringify(uscope) };
  useEffect(() => setPg('catalog')(1), [keys.catalog]);    
  useEffect(() => setPg('usage')(1), [keys.usage]);    
  const sum = useLoad(() => posCatalogApi.addOnSummary(), [tick]);
  const freshAt = useFreshAt(sum.data);   // data freshness: only after a successful read
  const list = useLoad(() => (tab === 'catalog' ? posCatalogApi.addOns({ ...scope, page: pages.catalog, pageSize: PAGE }) : Promise.resolve(null)), [tab, keys.catalog, pages.catalog, tick]);
  const usage = useLoad(() => (tab === 'usage' ? posCatalogApi.addOnUsage({ ...uscope, page: pages.usage, pageSize: PAGE }) : Promise.resolve(null)), [tab, keys.usage, pages.usage, tick]);

  const k = sum.data;
  const filtered = tab === 'catalog' ? !!(q || status !== 'all' || taxable || sort !== 'newest' || periods.catalog.preset !== 'all') : !!(q || periods.usage.preset !== 'month');
  const clearAll = () => { setSearch(''); setStatus('all'); setTaxable(''); setSort('newest'); setPeriods({ catalog: { preset: 'all' }, usage: { preset: 'month' } }); };
  const done = (msg: string) => { setEditing(null); setCreating(false); setArchiving(null); setNote({ tone: 'ok', text: msg }); reload(); };
  const canEdit = can('services.edit');
  const basis = tab === 'catalog' ? { basis: dateField, basisOptions: ['created', 'updated'].map((f) => ({ value: f, label: tx('cg.df.' + f) })), onBasis: setDateField }
    : { basis: usageField, basisOptions: ['paid', 'added'].map((f) => ({ value: f, label: tx('cg.df.' + f) })), onBasis: setUsageField };

  if (isForbidden(sum.error)) return <div className="work mos cga" data-testid="add-ons-screen"><h1>{tx('pos.add_ons_2')}</h1><StateBlock error={sum.error} onRetry={sum.reload} /></div>;
  return (
    <div className="work mos cga" data-testid="add-ons-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.add_ons_2')}</h1><div className="sub">{tx('pos.manage_add_on_services_across_your_1vxj')}</div></div>
        <div className="fk-head-actions">
          <SystemCheckButton domain="catalog" />
          <button type="button" className="fk-btn" onClick={reload} data-testid="refresh">{tx('finance.refresh')}</button>
          {canEdit ? <button type="button" className="fk-btn primary" onClick={() => setCreating(true)} data-testid="new-add-on">{tx('pos.new_add_on')}</button> : null}
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}

      <FreshnessLine at={freshAt} error={sum.error} testId="addons-fresh" />
      <div className="fk-kpis four cg-kpis" data-testid="kpis">
        {sum.error ? <StateBlock error={sum.error} onRetry={sum.reload} /> : <>
          <KpiCard testId="kpi-total" label={tx('pos.total_add_ons')} loading={!k} value={k ? nf(k.offerings) : ''} sub={k ? tx('cg.ao.kpiTotalSub', { d: nf(k.definitions) }) : ''} onClick={() => { setTab('catalog'); clearAll(); }} />
          <KpiCard testId="kpi-active" tone="ok" label={tx('pos.active_3')} loading={!k} value={k ? nf(k.activeOfferings) : ''} sub={k ? (k.offeringsOnArchivedServices ? tx('cg.ao.kpiArchivedSvc', { n: nf(k.offeringsOnArchivedServices) }) : tx('cg.ao.kpiActiveSub')) : ''} onClick={() => { setTab('catalog'); setStatus('active'); }} />
          <KpiCard testId="kpi-services" label={tx('pos.services_offering')} loading={!k} value={k ? nf(k.servicesOffering) : ''} sub={k ? (k.categoryAddOnServices ? tx('cg.ao.kpiCatSvc', { n: nf(k.categoryAddOnServices) }) : tx('cg.ao.kpiServicesSub')) : ''} />
          <KpiCard testId="kpi-avg" tone="gold" label={tx('pos.avg_price')} loading={!k} value={k ? money(k.averagePriceCents) : ''} sub={tx('cg.ao.kpiAvgSub')} />
        </>}
      </div>

      <div className="mos-tools" data-testid="toolbar">
        <div className="fn-search mos-search"><input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx(tab === 'usage' ? 'cg.ao.usageSearchPh' : 'cg.ao.searchPh')} aria-label={tx('cg.search')} data-testid="search" onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')} data-testid="search-clear">✕</button> : null}</div>
        {tab === 'catalog' ? <>
          <select className="fk-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('pos.status')} data-testid="status"><option value="all">{tx('pos.all_statuses')}</option><option value="active">{tx('pos.active_only')}</option><option value="inactive">{tx('pos.inactive_only')}</option></select>
          <select className="fk-select" value={taxable} onChange={(e) => setTaxable(e.target.value)} aria-label={tx('pos.taxable')} data-testid="taxable"><option value="">{tx('cg.ao.taxAll')}</option><option value="true">{tx('cg.ao.taxYes')}</option><option value="false">{tx('cg.ao.taxNo')}</option></select>
          <select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tx('cg.sort')} data-testid="sort">{['newest', 'name', 'service', 'price_desc', 'price_asc', 'updated'].map((x) => <option key={x} value={x}>{tx('cg.sort.' + x)}</option>)}</select>
        </> : null}
      </div>
      <div className="fn-tabsrow dsc-periodrow">
        <PeriodBar value={period} onChange={setPeriod} server={(tab === 'catalog' ? list.data : usage.data)?.period} allowAll compact {...basis} />
        {filtered ? <button type="button" className="fk-link" onClick={clearAll} data-testid="clear-all">{tx('finance.clearFilters')}</button> : null}
      </div>
      <div className="inv2-tabs mos-tabs">
        <div className="fk-seg inv2-tabseg" role="tablist" aria-label={tx('cg.ao.tabs')}>
          {(['catalog', 'usage'] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-testid={'tab-' + t}>{tx('cg.ao.tab.' + t)}</button>)}
        </div>
      </div>

      {tab === 'catalog' ? <FitPanel testId="add-ons-list" title={<>{tx('cg.ao.listTitle')}{list.data ? <span className="fk-muted"> · {tx('cg.matching', { n: nf(list.data.totalItems) })}</span> : null}</>} footer={<Pager info={pageOf(list.data)} onPage={setPg('catalog')} label={tx('pos.add_ons_2')} />}>
        {list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !list.data ? <div className="fk-loading">{tx('pos.loading_add_ons')}</div>
          : list.data.items.length === 0 ? (filtered ? <Empty title={q ? tx('cg.noMatchSearch', { q }) : tx('pos.no_add_ons_match_your_filters')}><button type="button" className="fk-btn" onClick={clearAll} data-testid="empty-clear">{tx('finance.clearFilters')}</button></Empty>
            : <Empty title={tx('cg.ao.none')}>{canEdit ? <button type="button" className="fk-btn primary" onClick={() => setCreating(true)}>{tx('pos.create_one')}</button> : null}</Empty>)
          : <table className="fk-table fn-table cg-table" data-testid="add-ons-table">
            <thead><tr><th>{tx('pos.add_on_2')}</th><th>{tx('pos.service_3')}</th><th>{tx('pos.category')}</th><th className="num">{tx('pos.price')}</th><th className="num">{tx('cg.ao.plusTime')}</th><th>{tx('pos.taxable')}</th><th>{tx('pos.status')}</th><th>{tx('pos.actions')}</th></tr></thead>
            <tbody>{list.data.items.map((a: any) => <tr key={a.offeringId} data-testid="add-on-row" className={'inv2-click' + (a.active ? '' : ' cg-off')} onClick={() => setDetail({ key: a.key })}>
              <td><span className="fk-li-t">{a.name}</span><span className="fk-li-s">{a.sharedWith > 1 ? tx('cg.ao.shared', { n: nf(a.sharedWith) }) : tx('cg.ao.single')}</span>
                {a.reviewFlag ? <span className="fk-chip warn" title={tx('cg.ao.flag.' + a.reviewFlag + '.hint')} data-testid="review-flag">{tx('cg.ao.flag.' + a.reviewFlag)}</span> : null}</td>
              <td>{a.serviceName}{a.serviceStatus !== 'active' ? <span className="fk-li-s">{tx('cg.status.' + (a.serviceStatus === 'archived' ? 'archived' : 'inactive'))}</span> : null}</td>
              <td>{a.categoryName ?? '—'}</td>
              <td className="num"><b>{fmtMoney(a.priceCents)}</b></td><td className="num">{plusMin(a.durationMinutes)}</td>
              <td>{a.taxable ? tx('pos.yes') : tx('pos.no')}</td>
              <td><span className={'fk-chip ' + (a.active ? 'ok' : 'mut')}>{a.active ? tx('pos.active_3') : tx('pos.inactive_2')}</span></td>
              <td className="fn-acts" onClick={(e) => e.stopPropagation()}>
                {canEdit ? <button type="button" className="fk-btn ghost sm" onClick={() => setEditing({ key: a.key, row: a })} data-testid="row-edit">{tx('pos.edit')}</button> : null}
                {canEdit ? (a.active ? <button type="button" className="fk-btn ghost sm" onClick={() => setArchiving({ row: a, restore: false })} data-testid="row-archive">{tx('pos.archive')}</button>
                  : <button type="button" className="fk-btn ghost sm" onClick={() => setArchiving({ row: a, restore: true })} data-testid="row-restore">{tx('pos.restore')}</button>) : null}
                {!canEdit ? <button type="button" className="fk-btn ghost sm" onClick={() => setDetail({ key: a.key })}>{tx('pos.details')}</button> : null}
              </td>
            </tr>)}</tbody>
          </table>}
        {k && k.categoryAddOnServices ? <div className="fk-hint" data-testid="category-add-ons-note">{tx('cg.ao.categoryNote', { n: nf(k.categoryAddOnServices) })}</div> : null}
      </FitPanel> : <FitPanel testId="add-on-usage" title={<>{tx('cg.ao.tab.usage')}{usage.data ? <span className="fk-muted"> · {tx('cg.matching', { n: nf(usage.data.totalItems) })}</span> : null}</>} footer={<Pager info={pageOf(usage.data)} onPage={setPg('usage')} label={tx('cg.ao.tab.usage')} />}>
        {usage.data ? <div className="mos-totals" data-testid="usage-totals"><div><span>{tx('cg.ao.paidLines')}</span><b>{nf(usage.data.totals.paidLines)}</b></div><div><span>{tx('cg.ao.paidValue')}</span><b>{fmtMoney(usage.data.totals.paidCents)}</b></div><span className="fk-hint">{tx('cg.ao.usageRule')}</span></div> : null}
        {usage.error ? <StateBlock error={usage.error} onRetry={usage.reload} /> : !usage.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : usage.data.items.length === 0 ? <Empty title={q ? tx('cg.noMatchSearch', { q }) : tx('cg.ao.noUsage')} /> : <UsageTable rows={usage.data.items} />}
      </FitPanel>}
      {tab === 'usage' && can('inventory.cost.view') ? <AddOnProfitPanel /> : null}

      <div className="cg-links" data-testid="nav-links">
        <button type="button" className="fk-btn ghost" onClick={() => nav('/services')} data-testid="link-services">{tx('pos.back_to_services')}</button>
        <button type="button" className="fk-btn ghost" onClick={() => nav('/tenant/services/categories')} data-testid="link-categories">{tx('pos.categories')}</button>
        <button type="button" className="fk-btn ghost" onClick={() => nav('/tenant/services/pricing')} data-testid="link-pricing">{tx('pos.pricing')}</button>
      </div>

      {detail ? <AddOnDetails addOnKey={detail.key} initialTab={detail.tab} canEdit={canEdit} onClose={() => setDetail(null)} onEdit={(row) => { setDetail(null); setEditing({ key: detail.key, row }); }} /> : null}
      {editing ? <AddOnEditor addOnKey={editing.key} row={editing.row} onClose={() => setEditing(null)} onSaved={done} /> : null}
      {creating ? <AddOnCreate onClose={() => setCreating(false)} onSaved={done} /> : null}
      {archiving ? <ArchiveAddOn row={archiving.row} restore={archiving.restore} onClose={() => setArchiving(null)} onDone={done} /> : null}
    </div>
  );
}

/** ADD-ONS 14: why the charged amount differs from the default price — the server's reason codes, each explained; the
 *  quoted price the line was added at is shown when it differs from what was charged. Nothing is recalculated here. */
const PRICE_REASONS = ['quantity', 'line_reduced', 'line_increased', 'menu_price_changed', 'price_varies_by_service', 'no_active_menu_price', 'tax_on_ticket'] as const;
function PriceReasons({ row }: { row: { chargedCents?: number; quotedCents?: number | null; menuPriceCents?: number | null; quantity?: number; priceReasons?: string[] } }) {
  const codes = (row.priceReasons ?? []).filter((c) => (PRICE_REASONS as readonly string[]).includes(c));
  if (!codes.length) return null;
  const vars = { q: row.quotedCents == null ? '—' : fmtMoney(row.quotedCents), m: row.menuPriceCents == null ? '—' : fmtMoney(row.menuPriceCents), n: nf(row.quantity ?? 1) };
  return <span className="fk-li-s" data-testid="price-reasons" title={codes.map((c) => tx('cg.ao.why.' + c, vars)).join(' · ')}>{codes.map((c) => tx('cg.ao.why.' + c, vars)).join(' · ')}</span>;
}

/** ADD-ONS 07: booking impact preview — the upcoming appointments that booked this add-on (from the add-on detail). For an
 *  edit it says how many would run longer at the new +time; for an archive, who still has it booked. Read only: booked
 *  appointments keep the add-on, price and minutes they were quoted. */
type AddOnUpcoming = { appointments: number; items: { appointmentId: string; day: string; time: string; customer: string | null; serviceId: string | null; serviceName: string | null; bookedMinutes: number; quotedCents: number }[] };
function AddOnBookingImpact({ upcoming, serviceId, newMinutes, archiving }: { upcoming?: AddOnUpcoming | null; serviceId?: string | null; newMinutes?: number | null; archiving?: boolean }) {
  if (!upcoming) return null;
  const items = serviceId ? upcoming.items.filter((a) => a.serviceId === serviceId) : upcoming.items;
  const total = serviceId ? items.length : upcoming.appointments;
  if (!total) return <p className="fk-hint" data-testid="add-on-impact-none">{tx('cg.ao.impact.none')}</p>;
  const longer = newMinutes == null ? 0 : items.filter((a) => newMinutes > a.bookedMinutes).length;
  return (
    <div className="fk-note warn" data-testid="add-on-impact">
      <span>{tx(archiving ? 'cg.ao.impact.archive' : 'cg.ao.impact.some', { n: nf(total) })}{!archiving && longer ? ' ' + tx('cg.ao.impact.longer', { n: nf(longer) }) : ''} {tx('cg.ao.impact.kept')}</span>
      <ul className="fn-notes" data-testid="add-on-impact-list">{items.slice(0, 5).map((a) => <li key={a.appointmentId + (a.serviceId ?? '')}>{a.day} {a.time} · {a.customer ?? tx('cg.impact.customerHidden')} · {a.serviceName ?? '—'} · {fmtMoney(a.quotedCents)} · {plusMin(a.bookedMinutes)}</li>)}</ul>
    </div>
  );
}

function UsageTable({ rows }: { rows: any[] }) {
  return (
    <table className="fk-table fn-table cg-table" data-testid="usage-table">
      <thead><tr><th>{tx('cg.col.when')}</th><th>{tx('cg.col.customer')}</th><th>{tx('pos.add_on_2')}</th><th className="t-opt">{tx('cg.ao.withService')}</th><th className="num">{tx('cg.col.charged')}</th><th className="t-opt">{tx('cg.col.technician')}</th><th>{tx('cg.col.ticket')}</th></tr></thead>
      <tbody>{rows.map((r: any) => <tr key={r.lineId} data-testid="usage-row">
        <td>{whenTime(r.at)}{!r.paid ? <span className="fk-li-s">{tx('cg.notPaid')}</span> : null}</td>
        <td>{r.customerName ?? tx('cg.walkIn')}<span className="fk-li-s">{r.maskedPhone ?? ''}</span></td>
        <td>{r.addOn}{r.minutes ? <span className="fk-li-s">{plusMin(r.minutes)}</span> : null}</td>
        <td className="t-opt">{r.mainServices ?? '—'}</td>
        <td className="num"><b>{fmtMoney(r.chargedCents)}</b><PriceReasons row={r} /></td>
        <td className="t-opt">{r.technician ?? '—'}</td>
        <td>{r.ticketNumber ? `#${r.ticketNumber}` : '—'}</td>
      </tr>)}</tbody>
    </table>
  );
}

/** pick services by search (active catalog services); never "all" by default */
function ServicePicker({ picked, onChange, exclude = [] }: { picked: { serviceId: string; name: string }[]; onChange: (x: { serviceId: string; name: string }[]) => void; exclude?: string[] }) {
  const [find, setFind] = useState(''); const fq = useDebounced(find.trim(), 250);
  const svc = useLoad(() => posCatalogApi.services({ q: fq || undefined, status: 'active', sort: 'name', pageSize: 8 }), [fq]);
  const ids = new Set(picked.map((p) => p.serviceId));
  return (
    <div className="cg-picker">
      <label className="fk-field wide">{tx('cg.ao.findService')}<input type="search" value={find} onChange={(e) => setFind(e.target.value)} data-testid="svc-find" /></label>
      <div className="cg-pick">{(svc.data?.items ?? []).filter((s: any) => !s.isAddOnService && !exclude.includes(s.serviceId)).map((s: any) =>
        <button key={s.serviceId} type="button" className={'fk-btn sm ' + (ids.has(s.serviceId) ? 'primary' : 'ghost')} aria-pressed={ids.has(s.serviceId)} data-testid="svc-pick"
          onClick={() => onChange(ids.has(s.serviceId) ? picked.filter((p) => p.serviceId !== s.serviceId) : [...picked, { serviceId: s.serviceId, name: s.name }])}>{ids.has(s.serviceId) ? '✓ ' : '+ '}{s.name}</button>)}</div>
      {picked.length ? <div className="cg-chips" data-testid="svc-picked">{picked.map((p) => <span key={p.serviceId} className="fk-chip info">{p.name}</span>)}</div> : <div className="fk-hint">{tx('cg.ao.pickRule')}</div>}
    </div>
  );
}

function AddOnCreate({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [name, setName] = useState(''); const [price, setPrice] = useState(''); const [dur, setDur] = useState(''); const [taxable, setTaxable] = useState(false);
  const [picked, setPicked] = useState<{ serviceId: string; name: string }[]>([]);
  const [dup, setDup] = useState<any[] | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const save = async (confirmDuplicate = false) => {
    const cents = centsFromText(price || '0'); const m = Number(dur || '0');
    if (!name.trim()) { setErr(tx('pos.add_on_name_is_required')); return; }
    if (cents == null) { setErr(tx('pos.enter_a_valid_price_dollars_and_1qkm')); return; }
    if (!Number.isInteger(m) || m < 0) { setErr(tx('pos.duration_must_be_zero_or_positive')); return; }
    if (!picked.length) { setErr(tx('cg.ao.pickRule')); return; }
    setBusy(true); setErr(null);
    try { const r: any = await posCatalogApi.createAddOn({ name: name.trim(), priceCents: cents, durationMinutes: m, taxable, serviceIds: picked.map((p) => p.serviceId), confirmDuplicate }); onSaved(tx('cg.ao.created', { name: name.trim(), n: nf(r?.offerings) })); }
    catch (e: any) {
      const code = e?.code ?? e?.details?.code;
      if (code === 'ADD_ON_DUPLICATE') setDup(Array.isArray(e?.details?.existing) ? e.details.existing : []); else setErr(errorTextOf(e, tx('pos.create_failed')));
    } finally { setBusy(false); }
  };
  return (
    <FitDialog wide title={tx('pos.create_new_add_on')} subtitle={tx('cg.ao.createSub')} onClose={onClose} busy={busy} testId="dlg-add-on-create"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>{dup ? <button type="button" className="fk-btn" onClick={() => save(true)} disabled={busy} data-testid="create-anyway">{tx('cg.ao.createAnyway')}</button> : null}
        <button type="button" className="fk-btn primary" onClick={() => save(false)} disabled={busy || !!dup} data-testid="add-on-save">{busy ? tx('pos.creating') : tx('pos.create_add_on')}</button></>}>
      <div className="cg-form">
        <label className="fk-field wide">{tx('pos.name_2')}<input value={name} maxLength={200} placeholder={tx('pos.e_g_french_tips')} onChange={(e) => { setName(e.target.value); setDup(null); }} data-testid="add-on-name" /></label>
        <label className="fk-field">{tx('pos.price_2')}<input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="add-on-price" /></label>
        <label className="fk-field">{tx('pos.extra_duration_min')}<input inputMode="numeric" value={dur} onChange={(e) => setDur(e.target.value.replace(/\D/g, ''))} data-testid="add-on-minutes" /></label>
        <label className="cg-chk"><input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} /> {tx('pos.taxable')}</label>
      </div>
      <ServicePicker picked={picked} onChange={setPicked} />
      {dup ? <div className="fk-note warn" data-testid="duplicate-warning"><span>{tx('cg.ao.duplicate', { n: nf(dup.reduce((a: number, x: any) => a + (x.offerings ?? x.n ?? 0), 0)) })}</span></div> : null}
      {err ? <div className="fk-note bad" role="alert" data-testid="add-on-error"><span>{err}</span></div> : null}
    </FitDialog>
  );
}

function AddOnEditor({ addOnKey, row, onClose, onSaved }: { addOnKey: string; row?: any; onClose: () => void; onSaved: (m: string) => void }) {
  const d = useLoad(() => posCatalogApi.addOn(addOnKey), [addOnKey]);
  const x = d.data;
  const shared = (x?.offerings?.length ?? row?.sharedWith ?? 1) > 1;
  const [scope, setScope] = useState<'definition' | 'offering'>(row && shared ? 'offering' : 'definition');
  const base = scope === 'offering' && row ? row : x?.offerings?.[0] ?? row;
  const [name, setName] = useState(''); const [price, setPrice] = useState(''); const [dur, setDur] = useState(''); const [taxable, setTaxable] = useState(false); const [reason, setReason] = useState('');
  const [adds, setAdds] = useState<{ serviceId: string; name: string }[]>([]); const [removes, setRemoves] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  // extras ADD-ONS 08 — a change to the shared definition touches several services at once: the server evaluates it first
  // (dryRun, nothing written) and the editor shows every offering's old → new value before the real save.
  const [preview, setPreview] = useState<{ key: string; changes: MassEditChangeRow[] } | null>(null);
  useEffect(() => { if (base) { setName(x?.name ?? base.name ?? ''); setPrice(textFromCents(base.priceCents)); setDur(String(base.durationMinutes ?? 0)); setTaxable(!!base.taxable); } }, [x, scope]);   // eslint-disable-line react-hooks/exhaustive-deps
  const bodyOf = (): Record<string, unknown> | null => {
    const cents = centsFromText(price || '0'); const m = Number(dur || '0');
    if (cents == null || !Number.isInteger(m) || m < 0) return null;
    const body: Record<string, unknown> = { scope, priceCents: cents, durationMinutes: m, taxable, reason: reason.trim() };
    if (scope === 'definition') { body.name = name.trim(); if (adds.length) body.addServiceIds = adds.map((a) => a.serviceId); if (removes.length) body.removeServiceIds = removes; }
    else body.serviceId = row?.serviceId;
    return body;
  };
  const mass = scope === 'definition' && (x?.offerings?.length ?? 0) > 1;
  const cur = bodyOf(); const curKey = cur ? JSON.stringify(cur) : '';
  const previewFresh = !!preview && preview.key === curKey;
  const save = async () => {
    const cents = centsFromText(price || '0'); const m = Number(dur || '0');
    if (cents == null) { setErr(tx('pos.enter_a_valid_price_dollars_and_1qkm')); return; }
    if (!Number.isInteger(m) || m < 0) { setErr(tx('pos.duration_must_be_zero_or_positive')); return; }
    if (!reason.trim()) { setErr(tx('cg.reasonRequired')); return; }
    const body = bodyOf(); if (!body) return;
    setBusy(true); setErr(null);
    try {
      if (mass && !previewFresh) {   // first press: review (nothing saved); the next press saves exactly what was reviewed
        const r: any = await posCatalogApi.updateAddOn(addOnKey, { ...body, dryRun: true });
        setPreview({ key: JSON.stringify(body), changes: Array.isArray(r?.changes) ? r.changes : [] });
        return;
      }
      const r: any = await posCatalogApi.updateAddOn(addOnKey, body);
      onSaved(tx('cg.ao.saved', { name: name.trim() || x?.name || '', n: nf(r?.changed) }));
    } catch (e) { setErr(errorTextOf(e, tx('pos.save_failed'))); } finally { setBusy(false); }
  };
  const svcName = (id: string | null) => x?.offerings?.find((o: any) => o.serviceId === id)?.serviceName ?? adds.find((a) => a.serviceId === id)?.name ?? '—';
  return (
    <FitDialog wide title={tx('cg.ao.editTitle', { name: x?.name ?? row?.name ?? '' })} onClose={onClose} busy={busy} testId="dlg-add-on-edit"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" onClick={save} disabled={busy || !x} data-testid="add-on-edit-save">{busy ? tx('pos.saving_2') : mass && !previewFresh ? tx('cg.ao.mp.review') : tx('pos.save_changes_2')}</button></>}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !x ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        {row && shared ? <div className="fk-seg mos-dtabs" role="radiogroup" aria-label={tx('cg.ao.scope')} data-testid="edit-scope">
          <button type="button" role="radio" aria-checked={scope === 'offering'} className={scope === 'offering' ? 'on' : ''} onClick={() => setScope('offering')} data-testid="scope-offering">{tx('cg.ao.scopeOffering', { s: row.serviceName })}</button>
          <button type="button" role="radio" aria-checked={scope === 'definition'} className={scope === 'definition' ? 'on' : ''} onClick={() => setScope('definition')} data-testid="scope-definition">{tx('cg.ao.scopeDefinition', { n: nf(x.offerings.length) })}</button>
        </div> : null}
        <p className="fk-hint" data-testid="scope-note">{scope === 'offering' ? tx('cg.ao.scopeOfferingRule') : tx('cg.ao.scopeDefinitionRule', { n: nf(x.offerings.length) })}{x.differsByService && scope === 'definition' ? ' ' + tx('cg.ao.differsWarn') : ''}</p>
        <div className="cg-form">
          {scope === 'definition' ? <label className="fk-field wide">{tx('pos.name_2')}<input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid="edit-name" /></label> : null}
          <label className="fk-field">{tx('pos.price_2')}<input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="edit-price" /></label>
          <label className="fk-field">{tx('pos.extra_duration_min')}<input inputMode="numeric" value={dur} onChange={(e) => setDur(e.target.value.replace(/\D/g, ''))} data-testid="edit-minutes" /></label>
          <label className="cg-chk"><input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} /> {tx('pos.taxable')}</label>
          <label className="fk-field wide">{tx('cg.f.reason')}<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder={tx('cg.f.reasonPh')} data-testid="edit-reason" /></label>
        </div>
        {scope === 'definition' ? <>
          <h3 className="fk-h3">{tx('cg.ao.assignments')}</h3>
          <ul className="fk-list dense" data-testid="edit-offerings">{x.offerings.map((o: any) => <li key={o.offeringId} className="fk-li"><label className="cg-chk"><input type="checkbox" checked={!removes.includes(o.serviceId) && o.active} disabled={!o.active}
            onChange={(e) => setRemoves((r) => e.target.checked ? r.filter((y) => y !== o.serviceId) : [...r, o.serviceId])} /> {o.serviceName}</label><span className="fk-muted">{fmtMoney(o.priceCents)} · {plusMin(o.durationMinutes)}{o.active ? '' : ` · ${tx('pos.inactive_2')}`}</span></li>)}</ul>
          {removes.length ? <div className="fk-note warn"><span>{tx('cg.ao.removeRule', { n: nf(removes.length) })}</span></div> : null}
          <ServicePicker picked={adds} onChange={setAdds} exclude={x.offerings.filter((o: any) => o.active).map((o: any) => o.serviceId)} />
        </> : null}
        <AddOnBookingImpact upcoming={x.upcoming} serviceId={scope === 'offering' && row ? row.serviceId : null} newMinutes={/^\d+$/.test(dur) ? Number(dur) : null} />
        {mass && previewFresh && preview ? <MassEditPreview changes={preview.changes} svcName={svcName} /> : null}
        {err ? <div className="fk-note bad" role="alert" data-testid="edit-error"><span>{err}</span></div> : null}
      </>}
    </FitDialog>
  );
}

/** one field one offering would change — from the server's dryRun (local name: not an API type) */
type MassEditChangeRow = { serviceId: string | null; field: string; oldValue: unknown; newValue: unknown };
const MASS_FIELD: Record<string, string> = { price_cents: 'pos.price', duration_delta_minutes: 'cg.ao.plusTime', is_taxable: 'pos.taxable', name: 'cg.ao.mp.name', is_active: 'pos.status', offering: 'cg.ao.assignments' };
function massValue(field: string, v: unknown): string {
  if (v == null || v === '') return '—';
  if (field === 'price_cents') return fmtMoney(Number(v));
  if (field === 'duration_delta_minutes') return plusMin(Number(v));
  if (field === 'is_taxable') return v === true ? tx('pos.yes') : tx('pos.no');
  if (field === 'is_active') return v === true ? tx('pos.active_3') : tx('pos.inactive_2');
  if (field === 'offering') return v === 'added' ? tx('cg.ao.mp.added') : '—';
  return String(v);
}
/** extras ADD-ONS 08: the affected count and every offering's old → new value BEFORE the shared definition is saved; the old
 *  values are the undo plan (each saved change is also kept in the add-on's Audit history). */
function MassEditPreview({ changes, svcName }: { changes: MassEditChangeRow[]; svcName: (id: string | null) => string }) {
  const offerings = new Set(changes.map((c) => c.serviceId ?? '')).size;
  return (
    <div className="fk-note warn" data-testid="mass-preview">
      {changes.length === 0 ? <span data-testid="mass-preview-none">{tx('cg.ao.mp.none')}</span> : <div>
        <b data-testid="mass-preview-count">{tx('cg.ao.mp.count', { n: nf(changes.length), o: nf(offerings) })}</b>
        <ul className="fk-list dense" data-testid="mass-preview-list">{changes.map((c, i) => <li key={i} className="fk-li"><span>{svcName(c.serviceId)} · {MASS_FIELD[c.field] ? tx(MASS_FIELD[c.field]) : '—'}</span>
          <span className="fk-muted">{massValue(c.field, c.oldValue)} → {massValue(c.field, c.newValue)}</span></li>)}</ul>
        <span className="fk-hint" data-testid="mass-preview-undo">{tx('cg.ao.mp.undo')}</span>
      </div>}
    </div>
  );
}

function ArchiveAddOn({ row, restore, onClose, onDone }: { row: any; restore: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const [all, setAll] = useState(false); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const impact = useLoad(() => (restore ? Promise.resolve(null) : posCatalogApi.addOn(row.key)), [row.key, restore]);
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const b = { serviceId: all ? undefined : row.serviceId, reason: reason.trim() || undefined };
      if (restore) await posCatalogApi.restoreAddOn(row.key, b); else await posCatalogApi.archiveAddOn(row.key, b);
      onDone(tx(restore ? 'cg.ao.restored' : 'cg.ao.archived', { name: row.name }));
    } catch (e) { setErr(errorTextOf(e, tx('pos.archive_failed'))); } finally { setBusy(false); }
  };
  return (
    <FitDialog title={tx(restore ? 'cg.ao.restoreTitle' : 'cg.ao.archiveTitle', { name: row.name })} onClose={onClose} busy={busy} testId="dlg-add-on-archive"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className={'fk-btn ' + (restore ? 'primary' : 'danger')} onClick={go} disabled={busy} data-testid="archive-confirm">{restore ? tx('pos.restore') : tx('pos.archive')}</button></>}>
      <p>{tx(restore ? 'cg.ao.restoreBody' : 'cg.ao.archiveBody', { s: row.serviceName })}</p>
      {row.sharedWith > 1 ? <label className="cg-chk"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} data-testid="archive-all" /> {tx(restore ? 'cg.ao.restoreAll' : 'cg.ao.archiveAll', { n: nf(row.sharedWith) })}</label> : null}
      <label className="fk-field wide">{tx('cg.f.reasonOptional')}<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></label>
      {!restore ? <AddOnBookingImpact upcoming={impact.data?.upcoming} serviceId={all ? null : row.serviceId} archiving /> : null}
      {err ? <div className="fk-note bad" role="alert"><span>{err}</span></div> : null}
    </FitDialog>
  );
}

type DTab = 'overview' | 'assignments' | 'pricing' | 'usage' | 'audit';
function AddOnDetails({ addOnKey, initialTab, canEdit, onClose, onEdit }: { addOnKey: string; initialTab?: DTab; canEdit: boolean; onClose: () => void; onEdit: (row: any) => void }) {
  const [t, setT] = useState<DTab>(initialTab ?? 'overview'); const [up, setUp] = useState(1); const [hp, setHp] = useState(1);
  const d = useLoad(() => posCatalogApi.addOn(addOnKey), [addOnKey]);
  const u = useLoad(() => (t === 'usage' ? posCatalogApi.addOnUsage({ key: addOnKey, preset: 'all', page: up, pageSize: 8 }) : Promise.resolve(null)), [addOnKey, t, up]);
  const h = useLoad(() => (t === 'audit' ? posCatalogApi.history({ addOnKey, field: 'all', page: hp, pageSize: 8 }) : Promise.resolve(null)), [addOnKey, t, hp]);
  const x = d.data;
  const active = x ? x.offerings.filter((o: any) => o.active).length : 0;
  return (
    <FitDialog wide title={x ? x.name : tx('pos.details')} subtitle={x ? tx('cg.ao.detailSub', { n: nf(x.offerings.length), a: nf(active) }) : undefined} onClose={onClose} testId="dlg-add-on-details"
      footer={<>{x && canEdit ? <button type="button" className="fk-btn primary" onClick={() => onEdit(undefined)} data-testid="details-edit">{tx('cg.ao.editDefinition')}</button> : null}<button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button></>}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !x ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="fk-seg mos-dtabs" role="tablist" aria-label={tx('pos.details')}>
          {(['overview', 'assignments', 'pricing', 'usage', 'audit'] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={t === k} className={t === k ? 'on' : ''} onClick={() => setT(k)} data-testid={'ad-tab-' + k}>{tx('cg.adtab.' + k)}</button>)}
        </div>
        {t === 'overview' ? <dl className="fk-dl mo-dl" data-testid="ad-overview">
          <dt>{tx('pos.name_2')}</dt><dd>{x.name}</dd>
          <dt>{tx('cg.ao.offeredOn')}</dt><dd>{tx('cg.ao.offeredOnV', { n: nf(x.offerings.length), a: nf(active) })}</dd>
          <dt>{tx('pos.price')}</dt><dd>{x.differsByService ? tx('cg.ao.variesByService') : `${fmtMoney(x.offerings[0].priceCents)} · ${plusMin(x.offerings[0].durationMinutes)}`}</dd>
          <dt>{tx('pos.taxable')}</dt><dd>{x.offerings.every((o: any) => o.taxable) ? tx('pos.yes') : x.offerings.some((o: any) => o.taxable) ? tx('cg.ao.mixed') : tx('pos.no')}</dd>
          <dt>{tx('cg.ao.paidUses')}</dt><dd>{x.usage.paidLines ? tx('cg.ao.paidUsesV', { n: nf(x.usage.paidLines), v: fmtMoney(x.usage.cents), d: day(x.usage.lastAt) }) : tx('cg.ao.noUsage')}</dd>
          <dt>{tx('cg.ao.key')}</dt><dd className="mos-mono">{x.key}</dd>
          <dd className="fk-hint" style={{ gridColumn: '1 / -1' }}>{tx('cg.ao.usageMatchRule')}</dd>
        </dl> : null}
        {t === 'assignments' ? <table className="fk-table fn-table cg-table" data-testid="ad-assignments"><thead><tr><th>{tx('pos.service_3')}</th><th className="t-opt">{tx('pos.category')}</th><th>{tx('pos.status')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
          <tbody>{x.offerings.map((o: any) => <tr key={o.offeringId}><td>{o.serviceName}{o.serviceStatus !== 'active' ? <span className="fk-li-s">{tx('cg.status.' + (o.serviceStatus === 'archived' ? 'archived' : 'inactive'))}</span> : null}</td><td className="t-opt">{o.categoryName ?? '—'}</td>
            <td><span className={'fk-chip ' + (o.active ? 'ok' : 'mut')}>{o.active ? tx('pos.active_3') : tx('pos.inactive_2')}</span></td>
            <td className="fn-acts">{canEdit ? <button type="button" className="fk-btn ghost sm" onClick={() => onEdit({ ...o, key: x.key, name: x.name, sharedWith: x.offerings.length })}>{tx('cg.ao.editOffering')}</button> : null}</td></tr>)}</tbody></table> : null}
        {t === 'pricing' ? <table className="fk-table fn-table cg-table" data-testid="ad-pricing"><thead><tr><th>{tx('pos.service_3')}</th><th className="num">{tx('pos.add_on_2')}</th><th className="num">{tx('cg.ao.plusTime')}</th><th className="num">{tx('cg.ao.withServicePrice')}</th><th className="num">{tx('cg.ao.withServiceTime')}</th></tr></thead>
          <tbody>{x.offerings.map((o: any) => <tr key={o.offeringId}><td>{o.serviceName}</td><td className="num">{fmtMoney(o.priceCents)}</td><td className="num">{plusMin(o.durationMinutes)}</td><td className="num"><b>{fmtMoney(o.withServicePriceCents)}</b></td><td className="num">{mins(o.withServiceMinutes)}</td></tr>)}</tbody></table> : null}
        {t === 'usage' ? (u.error ? <StateBlock error={u.error} onRetry={u.reload} /> : !u.data ? <div className="fk-loading">{tx('pos.loading')}</div> : u.data.items.length === 0 ? <Empty title={tx('cg.ao.noUsage')} /> : <><UsageTable rows={u.data.items} /><Pager info={pageOf(u.data)} onPage={setUp} /></>) : null}
        {t === 'audit' ? (h.error ? <StateBlock error={h.error} onRetry={h.reload} /> : !h.data ? <div className="fk-loading">{tx('pos.loading')}</div> : h.data.items.length === 0 ? <Empty title={tx('cg.noHistory')} /> : <><ChangeHistoryTable rows={h.data.items} /><Pager info={pageOf(h.data)} onPage={setHp} /></>) : null}
      </>}
    </FitDialog>
  );
}
