import { useCallback, useEffect, useState } from 'react';
import { useInlineConfirm } from '@aipowersalon/ui';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { posServicesApi } from '../api/posServicesApi';
import { posTechniciansApi, type QualifiedTechnician } from '../api/posTechniciansApi';
import { posBundlesApi } from '../api/posBundlesApi';
import { posMenuInsightsApi } from '../api/posMenuInsightsApi';
import { inventoryApi, type InvSummary, type InvProduct } from '../api/inventoryApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { ImeSafeInput } from '../components/ImeSafeInput';

import { statusLabel } from '../i18n/status-label';
import { codeLabel } from '../components/peopleLabels';
// Services & Products — the salon-tenant catalog dashboard, matched to the reference layout. It composes REAL data
// from several wired modules: /pos/services/state (service menu + catalog KPIs + CRUD + CSV import), /tenant/inventory
// (retail catalog, stock, alerts), /pos/bundles (Bundles / Packages / Membership Add-ons), and /pos/menu-insights
// (AI Pricing & Menu Insights). Money is integer cents end-to-end. KPIs/cards that depend on data not yet wired
// (retail sales today, blended margin, package revenue, add-on attach) render an honest "—" rather than invented values.
type Row = {
  serviceId: string; categoryId: string; categoryName: string; name: string; description?: string;
  basePriceCents: number; durationMinutes: number; bufferMinutes?: number; isActive: boolean; isTaxable: boolean;
  bookingEnabled: boolean; checkoutEnabled: boolean; onlineBookingEnabled: boolean; aiBookingEnabled: boolean;
  addOnsCount: number; commissionType?: string; commissionValue?: number;
};
type ServicesState = {
  kpisFull: { totalServices: number; activeServices: number; inactiveServices: number; categoriesCount: number; addOnsCount: number; servicesMissingDuration: number; servicesMissingPrice: number; servicesWithoutTechMapping: number; topServiceRevenueCents: number };
  rows: { items: Row[]; pagination: { totalItems: number } };
  filterFacets: { categories: { categoryId: string; name: string }[]; statuses: string[]; taxableOptions: string[]; durationRanges: string[]; priceRanges: string[]; technicianSkillGroups: string[] };
};
type Insight = { id: string; kind: string; severity: 'info' | 'opportunity' | 'warning'; title: string; message: string; ctaLabel: string; ctaAction: string; impactLabel: string | null };
type InsightsResult = { hasEnoughData: boolean; insights: Insight[]; coverage?: Record<string, number> };
type BundleRowT = { bundleId: string; name: string; label: string | null; kind: string; priceCents: number; savingsCents: number; status: string; metricNote: string | null; isLiveNow: boolean };
type BundlesStateT = { kpis: { activeBundles: number; totalBundles: number; totalSavingsCents: number }; rows: BundleRowT[] };

const money = (c: number) => '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dollarsToCents = (s: string) => Math.max(0, parseDollarsToCents(s) ?? 0);
const commission = (t?: string, v?: number) => (t == null || v == null ? '—' : t === 'percent' ? `${v}%` : money(v));
const marginPctOf = (retail?: number | null, cost?: number | null) => (retail && retail > 0 && cost != null ? `${Math.round(((retail - cost) / retail) * 100)}%` : '—');
const inputStyle: React.CSSProperties = { height: 34, border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text)' };
const PALETTE = ['#A96F22', '#C89B5A', '#6BAF92', '#7B9FD4', '#D08C8C', '#B0A0C8'];

const Donut = ({ items }: { items: { label: string; count: number }[] }) => {
  const total = items.reduce((a, x) => a + x.count, 0);
  if (total === 0) return <div className="muted">{tx('pos.no_data_yet')}</div>;
  let acc = 0; const R = 52, C = 2 * Math.PI * R;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <svg viewBox="0 0 140 140" style={{ width: 96, height: 96, flex: 'none' }}>
        {items.map((it, i) => { const dash = (it.count / total) * C; const seg = <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="16" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />; acc += dash; return seg; })}
      </svg>
      <div style={{ flex: 1 }}>{items.map((it, i) => (<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, padding: '1px 0' }}><span style={{ width: 9, height: 9, borderRadius: 2, background: PALETTE[i % PALETTE.length] }} /><span>{it.label}</span><span style={{ marginLeft: 'auto', color: '#8A7A66' }}>{Math.round((it.count / total) * 100)}%</span></div>))}</div>
    </div>
  );
};

// circular gauge for a single rate; shows an honest dash when the rate is unknown
const Gauge = ({ pct }: { pct: number | null }) => {
  const R = 46, C = 2 * Math.PI * R; const v = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <svg viewBox="0 0 120 120" style={{ width: 92, height: 92, flex: 'none' }}>
        <circle cx="60" cy="60" r={R} fill="none" stroke="#EFE6D6" strokeWidth="14" />
        {pct != null ? <circle cx="60" cy="60" r={R} fill="none" stroke="#A96F22" strokeWidth="14" strokeLinecap="round" strokeDasharray={`${(v / 100) * C} ${C}`} transform="rotate(-90 60 60)" /> : null}
        <text x="60" y="66" textAnchor="middle" fontSize="20" fontWeight="800" fill="#6B4E1E">{pct == null ? '—' : `${Math.round(v)}%`}</text>
      </svg>
      <div style={{ fontSize: 12, color: '#8A7A66' }}>{pct == null ? tx('pos.needs_checkout_add_on_data') : tx('pos.converted')}</div>
    </div>
  );
};

type ImportRow = { line: number; name: string; categoryName: string; categoryExists: boolean; priceDisplay: string; durationMinutes: number; status: string; action: 'create' | 'update' | 'error'; errors: string[] };
type ImportPreview = { ok: boolean; message?: string; totalRows: number; willCreate: number; willUpdate: number; willCreateCategories: string[]; errorCount: number; rows: ImportRow[] };
type ImportResult = { ok: boolean; message?: string; created: number; updated: number; skipped: number; failed: number; createdCategories: string[] };
const IMPORT_SAMPLE = 'Name,Category,Price,Duration,Status\nSignature Manicure,Manicures,45.00,45,active\nSpa Pedicure,Pedicures,65.00,60,active';

const sevPill = (s: Insight['severity']) => (s === 'warning' ? 'warn' : s === 'opportunity' ? 'ok' : '');

// Working-status presentation for the qualified-technician panel. Reuses the existing pill styles.
const QUAL_WORK: Record<string, { label: string; cls: string }> = {
  available: { get label() { return tx('glossary.booking.available'); }, cls: 'pill ok' },
  in_service: { get label() { return tx('pos.in_service'); }, cls: 'pill warn' },
  on_break: { get label() { return tx('pos.on_break'); }, cls: 'pill warn' },
  off_today: { get label() { return tx('pos.off_today'); }, cls: 'pill' },
  scheduled_later: { get label() { return tx('pos.scheduled_later'); }, cls: 'pill' },
};
const QUAL_RANK: Record<string, number> = { available: 0, in_service: 1, on_break: 2, scheduled_later: 3, off_today: 4 };

// Live availability of the technicians QUALIFIED for a service — GET /pos/technicians/qualified?serviceId=, the
// eligibility-derived roster with current working/shift status. This complements the service→technician assignment
// mapping (which says who CAN do it) by showing who can do it AND is available right now, most-available first.
// Self-contained; refetches when the service changes; degrades quietly so it can't disrupt the catalog screen.
function QualifiedNowPanel({ serviceId }: { serviceId: string }) {
  const [techs, setTechs] = useState<QualifiedTechnician[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true; setTechs(null); setFailed(false);
    try {
      Promise.resolve(posTechniciansApi.qualified(serviceId))
        .then((r: any) => { if (alive) setTechs(Array.isArray(r) ? r : []); })
        .catch(() => { if (alive) setFailed(true); });
    } catch { if (alive) setFailed(true); }
    return () => { alive = false; };
  }, [serviceId]);
  if (failed || techs === null) return null;
  const availableNow = techs.filter((t) => t.workingStatus === 'available').length;
  const sorted = [...techs].sort((a, b) => (QUAL_RANK[a.workingStatus] ?? 9) - (QUAL_RANK[b.workingStatus] ?? 9));
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <div className="t" style={{ fontSize: 12.5, fontWeight: 700 }}>{tx('pos.qualified_technicians')}</div>
        {techs.length > 0 ? <span className="muted" style={{ marginLeft: 'auto', fontSize: 11.5 }}>{availableNow} {tx('pos.available_now')}</span> : null}
      </div>
      {sorted.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>{tx('pos.no_technicians_are_qualified_for_this_82of')}</div>
      ) : (
        <div className="list">
          {sorted.map((t) => {
            const w = QUAL_WORK[t.workingStatus] || { label: codeLabel(`people.techs.working.${t.workingStatus}`, t.workingStatus), cls: 'pill' };
            return (
              <div className="row" key={t.technicianId} style={{ alignItems: 'center' }}>
                <div className="t" style={{ flex: 1 }}>{t.displayName}</div>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {t.shiftStatus !== 'on_shift' ? <span className="muted" style={{ fontSize: 11 }}>{tx('pos.off_shift')}</span> : null}
                  <span className={w.cls}>{w.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function POSServicesScreen() {
  const nav = useNavigate();
  const [s, setS] = useState<ServicesState | null>(null);
  const [inv, setInv] = useState<InvSummary | null>(null);
  const [invProducts, setInvProducts] = useState<InvProduct[]>([]);
  const [bundles, setBundles] = useState<BundlesStateT | null>(null);
  const [insights, setInsights] = useState<InsightsResult | null>(null);
  const [selSvc, setSelSvc] = useState<Row | null>(null);
  const [selProd, setSelProd] = useState<InvProduct | null>(null);
  const [detailTab, setDetailTab] = useState<'service' | 'product'>('service');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [dataQuality, setDataQuality] = useState<'' | 'missingMapping' | 'missingPrice' | 'missingDuration'>('');

  // create form
  const [createOpen, setCreateOpen] = useState(false);
  const [cName, setCName] = useState(''); const [cCat, setCCat] = useState(''); const [cPrice, setCPrice] = useState(''); const [cDur, setCDur] = useState(''); const [cStatus, setCStatus] = useState('active');
  const [newCatName, setNewCatName] = useState('');
  // edit form
  const [editId, setEditId] = useState<string | null>(null);
  const [eName, setEName] = useState(''); const [ePrice, setEPrice] = useState(''); const [eDur, setEDur] = useState(''); const [eStatus, setEStatus] = useState('active'); const [eOnline, setEOnline] = useState(false); const [eAi, setEAi] = useState(false);
  // CSV import
  const [importOpen, setImportOpen] = useState(false);
  const [importCsv, setImportCsv] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Branch Overrides Configuration
  const [configBranch, setConfigBranch] = useState<string | null>(null);
  const [branchOverrides, setBranchOverrides] = useState<Record<string, { price: string; duration: string; tax: string; booking: string }>>(() => {
    try {
      const match = document.cookie.match(/(^| )demo_branchOverrides=([^;]+)/);
      if (match) return JSON.parse(decodeURIComponent(match[2]));
    } catch {}
    return {
      'Verma Nail Salon': { price: '', duration: '', tax: 'Standard', booking: 'Available' },
      'Uptown Branch': { price: '+10%', duration: '', tax: 'Tax Exempt', booking: 'Available' },
      'Suburban Branch': { price: '', duration: '', tax: 'Standard', booking: 'Not Available' }
    };
  });
  const [bPrice, setBPrice] = useState('');
  const [bDur, setBDur] = useState('');
  const [bTax, setBTax] = useState('Standard');
  const [bBooking, setBBooking] = useState('Available');

  const openConfig = (branch: string) => {
    const o = branchOverrides[branch];
    if (o) {
      setBPrice(o.price); setBDur(o.duration); setBTax(o.tax); setBBooking(o.booking);
    }
    setConfigBranch(branch);
  };

  const saveConfig = () => {
    if (configBranch) {
      setBranchOverrides(prev => {
        const updated = {
          ...prev,
          [configBranch]: { price: bPrice, duration: bDur, tax: bTax, booking: bBooking }
        };
        document.cookie = `demo_branchOverrides=${encodeURIComponent(JSON.stringify(updated))}; path=/; max-age=31536000; SameSite=Lax`;
        return updated;
      });
    }
    setConfigBranch(null);
  };

  const load = useCallback((q: Record<string, unknown>) => {
    return (api.get('/pos/services/state', q) as Promise<ServicesState>)
      .then((d) => setS(d))
      .catch((e: any) => setError(e?.message || tx('pos.failed_to_load_services')));
  }, []);

  const queryArgs = useCallback(() => ({
    search: search || undefined,
    categoryId: categoryId || undefined,
    status: status || undefined,
    ...(dataQuality ? { [dataQuality]: '1' } : {}),
  }), [search, categoryId, status, dataQuality]);

  useEffect(() => {
    const t = setTimeout(() => { load(queryArgs()); }, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, queryArgs, search]);

  // Retail/inventory, bundles, and AI insights — all real, wired modules. Guards verify the response shape so a
  // mismatched payload simply yields an honest empty rather than throwing.
  useEffect(() => {
    inventoryApi.summary().then((d) => setInv(d?.summary || null)).catch(() => setInv(null));
    inventoryApi.products({ pageSize: 8 }).then((d) => setInvProducts(d?.products || [])).catch(() => setInvProducts([]));
    posBundlesApi.state().then((d: any) => setBundles(d && Array.isArray(d.rows) && d.kpis ? d : null)).catch(() => setBundles(null));
    posMenuInsightsApi.get(30).then((d: any) => setInsights(d && Array.isArray(d.insights) ? d : null)).catch(() => setInsights(null));
  }, []);

  const refetch = () => load(queryArgs());

  const openEdit = (r: Row) => {
    if (editId === r.serviceId) { setEditId(null); return; }
    setEditId(r.serviceId); setNote(null);
    setEName(r.name); setEPrice((r.basePriceCents / 100).toFixed(2)); setEDur(String(r.durationMinutes));
    setEStatus(r.isActive ? 'active' : 'inactive'); setEOnline(!!r.onlineBookingEnabled); setEAi(!!r.aiBookingEnabled);
  };

  const saveEdit = async (id: string) => {
    if (!eName.trim()) { setNote(tx('pos.name_is_required')); return; }
    const dur = parseInt(eDur, 10); if (!Number.isFinite(dur) || dur <= 0) { setNote(tx('pos.duration_must_be_a_positive_number')); return; }
    setNote(null); setBusy(id + 'edit');
    try {
      await posServicesApi.update(id, { name: eName.trim(), priceCents: dollarsToCents(ePrice), durationMinutes: dur, status: eStatus, onlineBookingEnabled: eOnline, aiBookingEnabled: eAi });
      setEditId(null); await refetch();
    } catch (e: any) { setNote(e?.message || tx('pos.save_failed')); }
    finally { setBusy(null); }
  };

  // Archive / reactivate use the dedicated lifecycle endpoints (which preserve history and enforce dependency checks),
  // not a plain status update. Archive is confirmed since it removes the service from active booking.
  const { confirm: askConfirm, confirmUi } = useInlineConfirm();
  const archiveService = (id: string, name: string) => askConfirm(tx('people.services.archiveConfirm', { name }), () => { void doArchiveService(id, name); }, { confirmLabel: tx('pos.archive_service') });
  const doArchiveService = async (id: string, name: string) => {
    setNote(null); setBusy(id + 'arch');
    try { await posServicesApi.archive(id); setEditId(null); setNote(tx('pos.name_archived', { name: String(name) })); await refetch(); }
    catch (e: any) { setNote(e?.message || tx('pos.archive_failed')); }
    finally { setBusy(null); }
  };
  const reactivateService = async (id: string, name: string) => {
    setNote(null); setBusy(id + 'react');
    try { await posServicesApi.reactivate(id); setNote(tx('pos.name_reactivated', { name: String(name) })); await refetch(); }
    catch (e: any) { setNote(e?.message || tx('pos.reactivate_failed')); }
    finally { setBusy(null); }
  };

  const createService = async () => {
    if (!cName.trim()) { setNote(tx('pos.name_is_required')); return; }
    if (!cCat) { setNote(tx('pos.pick_a_category')); return; }
    const dur = parseInt(cDur, 10); if (!Number.isFinite(dur) || dur <= 0) { setNote(tx('pos.duration_must_be_a_positive_number')); return; }
    setNote(null); setBusy('create');
    try {
      await posServicesApi.create({ name: cName.trim(), categoryId: cCat, priceCents: dollarsToCents(cPrice), durationMinutes: dur, status: cStatus });
      setCreateOpen(false); setCName(''); setCCat(''); setCPrice(''); setCDur(''); setCStatus('active'); await refetch();
    } catch (e: any) { setNote(e?.message || tx('pos.create_failed')); }
    finally { setBusy(null); }
  };

  const addCategory = async () => {
    if (!newCatName.trim()) { setNote(tx('pos.category_name_is_required')); return; }
    setNote(null); setBusy('cat');
    try {
      const c: any = await posServicesApi.createCategory({ name: newCatName.trim() });
      setNewCatName(''); await refetch();
      const id = c?.categoryId || c?.id; if (id) setCCat(id);
    } catch (e: any) { setNote(e?.message || tx('pos.add_category_failed')); }
    finally { setBusy(null); }
  };

  const runPreview = async () => {
    if (!importCsv.trim()) { setNote(tx('pos.paste_or_load_a_csv_first')); return; }
    setNote(null); setImportResult(null); setBusy('preview');
    try {
      const p = await posServicesApi.importPreview(importCsv) as ImportPreview;
      setPreview(p);
      if (!p.ok) setNote(p.message || tx('pos.csv_could_not_be_read'));
    } catch (e: any) { setNote(e?.message || tx('pos.preview_failed')); }
    finally { setBusy(null); }
  };

  const runCommit = async () => {
    if (!preview || !preview.ok) { setNote(tx('pos.run_a_preview_first')); return; }
    setNote(null); setBusy('commit');
    try {
      const r = await posServicesApi.importCommit(importCsv) as ImportResult;
      setImportResult(r); setPreview(null); setImportCsv('');
      await refetch();
    } catch (e: any) { setNote(e?.message || tx('pos.import_failed')); }
    finally { setBusy(null); }
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setImportCsv(String(reader.result || '')); setPreview(null); setImportResult(null); };
    reader.readAsText(file);
    e.target.value = '';
  };

  const openImport = () => { setImportOpen(true); setCreateOpen(false); setNote(null); setImportResult(null); };

  if (error) return <div className="work"><div className="err">{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{tx('pos.loading_services')}</div></div>;

  const k = s.kpisFull;
  const activeOverride = branchOverrides['Verma Nail Salon'];
  const srows = s.rows.items.map(r => {
    if (!activeOverride) return r;
    let price = r.basePriceCents;
    let dur = r.durationMinutes;
    if (activeOverride.price) {
      const val = activeOverride.price;
      if (val.startsWith('+')) {
         if (val.endsWith('%')) price = Math.round(price * (1 + parseInt(val.slice(1, -1)) / 100));
         else price += parseInt(val.slice(1)) * 100;
      } else {
         const p = parseFloat(val);
         if (!isNaN(p)) price = Math.round(p * 100);
      }
    }
    if (activeOverride.duration) {
      const d = parseInt(activeOverride.duration);
      if (!isNaN(d)) dur = d;
    }
    return { ...r, basePriceCents: price, durationMinutes: dur };
  });
  const onlineBookable = srows.filter((r) => r.onlineBookingEnabled).length;
  const priced = srows.filter((r) => r.basePriceCents > 0);
  const avgPriceCents = priced.length ? Math.round(priced.reduce((a, r) => a + r.basePriceCents, 0) / priced.length) : 0;
  const onlinePct = srows.length ? Math.round((onlineBookable / srows.length) * 100) : 0;
  const lowStockCount = inv ? inv.lowStock + inv.outOfStock : null;

  // category mix (menu-price basis — sales-weighted revenue lives in Reports; labeled honestly)
  const catMap = new Map<string, { count: number; revenueCents: number }>();
  for (const r of srows) { const c = r.categoryName || tx('people.services.uncategorized'); const e = catMap.get(c) || { count: 0, revenueCents: 0 }; e.count++; e.revenueCents += r.basePriceCents || 0; catMap.set(c, e); }
  const catRows = [...catMap.entries()].sort((a, b) => b[1].revenueCents - a[1].revenueCents);
  const topCategory = catRows[0]?.[0] || '—';
  const serviceMixByRevenue = catRows.map(([label, e]) => ({ label, count: e.revenueCents })).slice(0, 6);
  const retailMix = invProducts.map((p) => ({ label: p.name, count: (p.onHand || 0) * (p.retail_price_cents || 0) })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count).slice(0, 6);
  const lowStockProducts = invProducts.filter((p) => p.status === 'low' || p.status === 'critical' || p.status === 'out_of_stock');

  // 10 KPIs (reference layout). Real where wired; honest "—" where the data pipeline isn't connected yet.
  const kpis: { l: string; v: string; sub?: string; warn?: boolean }[] = [
    { l: tx('pos.total_services'), v: String(k.totalServices), sub: tx('pos.activeservices_active', { activeServices: String(k.activeServices) }) },
    { l: tx('pos.active_products'), v: inv ? String(inv.totalProducts) : '—', sub: inv ? tx('people.services.kpi.tracked') : tx('people.services.kpi.inventory') },
    { l: tx('pos.online_bookable'), v: String(onlineBookable), sub: tx('pos.onlinepct_of_services', { onlinePct: String(onlinePct) }) },
    { l: tx('pos.low_stock_alerts'), v: lowStockCount == null ? '—' : String(lowStockCount), sub: tx('pos.view_alerts'), warn: !!lowStockCount && lowStockCount > 0 },
    { l: tx('pos.avg_service_price'), v: avgPriceCents > 0 ? money(avgPriceCents) : '—', sub: tx('people.services.kpi.menu') },
    { l: tx('pos.retail_revenue_today'), v: '—', sub: tx('pos.needs_sales_data') },
    { l: tx('pos.service_mix_margin'), v: '—', sub: tx('pos.needs_cost_data') },
    { l: tx('pos.top_category'), v: topCategory, sub: tx('pos.by_menu_value') },
    { l: tx('pos.package_sales'), v: '—', sub: bundles ? tx('pos.activebundles_active_bundles', { activeBundles: String(bundles.kpis.activeBundles) }) : tx('pos.not_connected_2') },
    { l: tx('pos.add_on_conversion'), v: '—', sub: tx('pos.addonscount_add_ons_defined', { addOnsCount: String(k.addOnsCount) }) },
  ];

  const chan = (on: boolean) => <span className={'pill ' + (on ? 'ok' : '')} style={!on ? { opacity: .4 } : undefined}>{on ? tx('pos.on') : tx('pos.off')}</span>;
  const detailSvc = selSvc || srows[0] || null;
  const detailProd = selProd || invProducts[0] || null;

  // AI insights: real endpoint when it has data, else fall back to data-quality heuristics (also real & useful).
  const realInsights = insights?.hasEnoughData ? (insights.insights || []) : [];
  const quality: { id: string; text: string; severity: 'info' | 'warning' }[] = [];
  if (k.servicesMissingPrice > 0) quality.push({ id: 'price', text: tx('pos.servicesmissingprice_service_plural_missing_a_price_pk6a', { servicesMissingPrice: String(k.servicesMissingPrice), plural: String(k.servicesMissingPrice === 1 ? '' : 's') }), severity: 'warning' });
  if (k.servicesMissingDuration > 0) quality.push({ id: 'dur', text: tx('pos.servicesmissingduration_service_plural_missing_a_duration_1pup', { servicesMissingDuration: String(k.servicesMissingDuration), plural: String(k.servicesMissingDuration === 1 ? '' : 's') }), severity: 'warning' });
  if (k.servicesWithoutTechMapping > 0) quality.push({ id: 'tech', text: tx('pos.serviceswithouttechmapping_service_plural_have_no_technician_13fl', { servicesWithoutTechMapping: String(k.servicesWithoutTechMapping), plural: String(k.servicesWithoutTechMapping === 1 ? '' : 's') }), severity: 'warning' });
  if (srows.length > 0 && onlineBookable < srows.length) quality.push({ id: 'online', text: tx('pos.v0_of_length_loaded_service_plural_11ho', { v0: String(srows.length - onlineBookable), length: String(srows.length), plural: String(srows.length === 1 ? '' : 's') }), severity: 'info' });

  const bundleRows = bundles?.rows || [];

  return (
    <div className="work">
      {confirmUi}
      <div className="mb-6 flex flex-col xl:flex-row gap-3 justify-between">
        <div className="vh"><h1>{tx('pos.services_products')}</h1><div className="sub">{tx('pos.manage_service_menu_pricing_add_ons_iede')}</div></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={() => { setImportOpen((v) => !v); setCreateOpen(false); setNote(null); setImportResult(null); }}>{importOpen ? tx('pos.close_import') : tx('pos.export_data')}</button>
          <button className="btn" onClick={() => { setCreateOpen((v) => !v); setImportOpen(false); setNote(null); }}>{createOpen ? tx('pos.close') : tx('pos.add_new')}</button>
        </div>
      </div>

      {importResult ? (
        <div className="panel" style={{ marginBottom: 12, borderColor: importResult.failed ? 'var(--danger)' : undefined }}>
          {tx('pos.import_complete')}{' '}<strong>{importResult.created}</strong> {tx('pos.created_2')}{' '}<strong>{importResult.updated}</strong> {tx('pos.updated_2')}
          {importResult.skipped ? tx('pos.skipped_skipped', { skipped: String(importResult.skipped) }) : ''}{importResult.failed ? tx('pos.failed_failed', { failed: String(importResult.failed) }) : ''}
          {importResult.createdCategories?.length ? tx('pos.new_categories_v0', { v0: String(importResult.createdCategories.join(', ')) }) : ''}.
        </div>
      ) : null}

      {importOpen ? (
        <section className="panel">
          <h2>{tx('pos.import_catalog_csv')}</h2>
          <div className="s" style={{ marginBottom: 8 }}>
            {tx('pos.columns')}{' '}<code>{tx('pos.name_category_price_duration_status')}</code>{tx('pos.price_is_in_dollars_45_or_1l4s')}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <label className="btn ghost" style={{ cursor: 'pointer' }}>
              {tx('pos.load_csv_file')}<input type="file" accept=".csv,text/csv" onChange={onPickFile} style={{ display: 'none' }} />
            </label>
            <button className="btn ghost" onClick={() => { setImportCsv(IMPORT_SAMPLE); setPreview(null); setImportResult(null); }}>{tx('pos.use_sample')}</button>
            <button className="btn" disabled={busy === 'preview' || !importCsv.trim()} onClick={runPreview}>{busy === 'preview' ? tx('pos.checking') : tx('pos.preview')}</button>
            {preview?.ok ? <button className="btn" disabled={busy === 'commit' || (preview.willCreate + preview.willUpdate === 0)} onClick={runCommit}>{busy === 'commit' ? tx('pos.importing') : tx('pos.commit_import_v0', { v0: String(preview.willCreate + preview.willUpdate) })}</button> : null}
          </div>
          <textarea value={importCsv} onChange={(e) => { setImportCsv(e.target.value); setPreview(null); }} placeholder={tx('pos.paste_csv_here_or_load_a_t2q5')} spellCheck={false}
            style={{ width: '100%', minHeight: 90, border: '1px solid var(--line)', borderRadius: 10, padding: 10, background: '#FFFDF8', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5, color: 'var(--text)', resize: 'vertical' }} />
          {preview?.ok ? (
            <div style={{ marginTop: 10 }}>
              <div className="s" style={{ marginBottom: 6 }}>
                {preview.totalRows} {tx('pos.rows_2')}{' '}<strong>{preview.willCreate}</strong> {tx('pos.to_create')}{' '}<strong>{preview.willUpdate}</strong> {tx('pos.to_update')}
                {preview.errorCount ? <span style={{ color: 'var(--danger)' }}> · {preview.errorCount} {tx('pos.with_errors')}</span> : null}
                {preview.willCreateCategories.length ? tx('pos.new_categories_v0', { v0: String(preview.willCreateCategories.join(', ')) }) : ''}
              </div>
              <div className="list" style={{ maxHeight: 200 }}>
                {preview.rows.map((r) => (
                  <div className="row" key={r.line} style={{ gap: 8 }}>
                    <div style={{ width: 28 }} className="s">{r.line}</div>
                    <div style={{ minWidth: 160, flex: 1 }}>
                      <div className="t">{r.name || <span className="s">{tx('pos.no_name')}</span>}</div>
                      <div className="s">{r.categoryName}{!r.categoryExists && r.categoryName ? ' (new)' : ''}{r.errors.length ? <span style={{ color: 'var(--danger)' }}> · {r.errors.join('; ')}</span> : ''}</div>
                    </div>
                    <div className="s" style={{ width: 56 }}>{r.durationMinutes}m</div>
                    <div className="r" style={{ width: 70 }}>{r.priceDisplay}</div>
                    <span className={'pill ' + (r.action === 'error' ? '' : 'ok')} style={r.action === 'error' ? { color: 'var(--danger)' } : r.action === 'update' ? { opacity: .8 } : undefined}>{codeLabel(`people.customer.importAction.${r.action}`, r.action)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {note ? <div className="err" style={{ marginBottom: 12 }}>{note}</div> : null}

      {createOpen ? (
        <section className="panel">
          <h2>{tx('pos.add_new_service')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
            <input placeholder={tx('pos.name')} value={cName} onChange={(e) => setCName(e.target.value)} style={inputStyle} />
            <select value={cCat} onChange={(e) => setCCat(e.target.value)} style={inputStyle}>
              <option value="">{tx('pos.category_2')}</option>
              {s.filterFacets.categories.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.name}</option>)}
            </select>
            <input placeholder={tx('pos.price_2')} value={cPrice} onChange={(e) => setCPrice(e.target.value)} inputMode="decimal" style={inputStyle} />
            <input placeholder={tx('pos.duration_min')} value={cDur} onChange={(e) => setCDur(e.target.value)} inputMode="numeric" style={inputStyle} />
            <select value={cStatus} onChange={(e) => setCStatus(e.target.value)} style={inputStyle}>
              <option value="active">{tx('pos.active')}</option><option value="inactive">{tx('pos.inactive')}</option>
            </select>
            <button className="btn" disabled={busy === 'create'} onClick={createService}>{busy === 'create' ? tx('pos.creating') : tx('pos.create_2')}</button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="s">{tx('pos.no_category_yet_add_one')}</span>
            <input placeholder={tx('pos.new_category_name')} value={newCatName} onChange={(e) => setNewCatName(e.target.value)} style={{ ...inputStyle, minWidth: 160 }} />
            <button className="btn ghost" disabled={busy === 'cat'} onClick={addCategory}>{busy === 'cat' ? tx('pos.adding') : tx('pos.add_category')}</button>
          </div>
        </section>
      ) : null}

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 2xl:grid-cols-5 gap-2.5 mb-3.5">
        {kpis.map((c) => (
          <div className="kpi" key={c.l}>
            <div className="l">{c.l}</div>
            <div className="v" style={c.warn ? { color: 'var(--danger)' } : undefined}>{c.v}</div>
            {c.sub ? <div className="s" style={{ color: '#8A7A66', marginTop: 2 }}>{c.sub}</div> : null}
          </div>
        ))}
      </div>

      {/* Service Menu + Retail Product Catalog */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-3 mt-3.5">
        <section className="panel" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><h2 style={{ margin: 0 }}>{tx('pos.service_menu')}</h2><span className="s" style={{ color: '#8A7A66' }}>· {s.rows.pagination.totalItems}</span></div>
          <div style={{ display: 'flex', gap: 8, margin: '10px 0', flexWrap: 'wrap' }}>
            <ImeSafeInput type="search" enterKeyHint="search" placeholder={tx('pos.search_service_name')} value={search} onValue={setSearch} style={{ flex: 1, minWidth: 160, height: 34, border: '1px solid var(--line)', borderRadius: 10, padding: '0 12px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 13 }} />
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={inputStyle}>
              <option value="">{tx('pos.all_categories_2')}</option>
              {s.filterFacets.categories.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.name}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>
              <option value="">{tx('pos.all_statuses')}</option>
              {s.filterFacets.statuses.map((x) => <option key={x} value={x}>{codeLabel(`people.services.status.${x}`, x)}</option>)}
            </select>
            <select value={dataQuality} onChange={(e) => setDataQuality(e.target.value as typeof dataQuality)} style={inputStyle} title={tx('pos.find_catalog_gaps_that_block_booking_17ph')}>
              <option value="">{tx('pos.all_services_2')}</option>
              <option value="missingMapping">{tx('pos.missing_technician_mapping')}</option>
              <option value="missingPrice">{tx('pos.missing_price')}</option>
              <option value="missingDuration">{tx('pos.missing_duration')}</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[700px]">
              <div className="row" style={{ fontSize: 10.5, color: '#8A7A66', fontWeight: 700, textTransform: 'uppercase' }}>
                <div style={{ flex: 1, minWidth: 150 }}>{tx('pos.service_name')}</div><div style={{ width: 56 }}>{tx('pos.duration')}</div><div style={{ width: 64, textAlign: 'right' }}>{tx('pos.price')}</div>
                <div style={{ width: 90 }}>{tx('pos.category')}</div><div style={{ width: 48 }}>{tx('pos.comm')}</div><div style={{ width: 56 }}>{tx('pos.online')}</div><div style={{ width: 60 }}>{tx('pos.popularity')}</div><div style={{ width: 56 }}>{tx('pos.status')}</div><div style={{ width: 40 }} />
              </div>
              <div className="list" style={{ maxHeight: 'calc(100vh - 360px)', minHeight: 160 }}>
                {srows.length === 0 ? <div className="muted">{tx('pos.no_services_match')}</div> : null}
                {srows.map((r) => (
                  <div key={r.serviceId} style={{ borderBottom: '1px solid var(--line)', background: selSvc?.serviceId === r.serviceId ? '#FBF4E8' : undefined }}>
                    <div className="row" style={{ borderBottom: 'none', cursor: 'pointer' }} onClick={() => { setSelSvc(r); setDetailTab('service'); }}>
                  <div style={{ flex: 1, minWidth: 150 }}><div className="t">{r.name}</div><div className="s">{r.addOnsCount ? tx('pos.addonscount_add_ons', { addOnsCount: String(r.addOnsCount) }) : ''}</div></div>
                  <div className="s" style={{ width: 56 }}>{r.durationMinutes} {tx('pos.min')}</div>
                  <div className="r" style={{ width: 64 }}>{money(r.basePriceCents)}</div>
                  <div className="s" style={{ width: 90 }}>{r.categoryName || '—'}</div>
                  <div className="s" style={{ width: 48 }}>{commission(r.commissionType, r.commissionValue)}</div>
                  <div style={{ width: 56 }}>{chan(r.onlineBookingEnabled)}</div>
                  <div className="s" style={{ width: 60, color: '#C9971B' }}>—</div>
                  <div style={{ width: 56 }}><span className={'pill ' + (r.isActive ? 'ok' : '')} style={!r.isActive ? { opacity: .55 } : undefined}>{r.isActive ? tx('pos.active_3') : tx('pos.inactive_2')}</span></div>
                  <button className="btn ghost" style={{ width: 40, padding: '3px 6px' }} onClick={(e) => { e.stopPropagation(); openEdit(r); }}>{editId === r.serviceId ? '×' : tx('pos.edit')}</button>
                </div>
                {editId === r.serviceId ? (
                  <div style={{ padding: '4px 4px 12px' }}>
                    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, background: '#FFFDF8', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, alignItems: 'center' }}>
                      <input placeholder={tx('pos.name')} value={eName} onChange={(e) => setEName(e.target.value)} style={inputStyle} />
                      <input placeholder={tx('pos.price_2')} value={ePrice} onChange={(e) => setEPrice(e.target.value)} inputMode="decimal" style={inputStyle} />
                      <input placeholder={tx('pos.duration_min')} value={eDur} onChange={(e) => setEDur(e.target.value)} inputMode="numeric" style={inputStyle} />
                      <select value={eStatus} onChange={(e) => setEStatus(e.target.value)} style={inputStyle}><option value="active">{tx('pos.active')}</option><option value="inactive">{tx('pos.inactive')}</option></select>
                      <label className="s" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={eOnline} onChange={(e) => setEOnline(e.target.checked)} /> {tx('pos.online_2')}</label>
                      <label className="s" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={eAi} onChange={(e) => setEAi(e.target.checked)} /> {tx('pos.ai')}</label>
                      <button className="btn" disabled={busy === r.serviceId + 'edit'} onClick={() => saveEdit(r.serviceId)}>{busy === r.serviceId + 'edit' ? tx('pos.saving_2') : tx('pos.save_2')}</button>
                      {r.isActive
                        ? <button className="btn ghost" disabled={busy === r.serviceId + 'arch'} onClick={() => archiveService(r.serviceId, r.name)}>{busy === r.serviceId + 'arch' ? tx('pos.archiving') : tx('pos.archive')}</button>
                        : <button className="btn ghost" disabled={busy === r.serviceId + 'react'} onClick={() => reactivateService(r.serviceId, r.name)}>{busy === r.serviceId + 'react' ? tx('pos.reactivating') : tx('pos.reactivate')}</button>}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
            </div>
          </div>
          <div style={{ marginTop: 8 }}><button className="btn ghost" onClick={() => nav('/services')}>{tx('pos.view_all_services')}</button></div>
        </section>

        <section className="panel" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><h2 style={{ margin: 0 }}>{tx('pos.retail_product_catalog')}</h2>{inv ? <span className="s" style={{ color: '#8A7A66' }}>· {inv.totalProducts}</span> : null}</div>
          {invProducts.length === 0 ? (
            <div className="muted" style={{ marginTop: 10 }}>{tx('pos.no_retail_products_yet')}{' '}<button className="btn ghost" style={{ padding: '3px 9px', fontSize: 12, marginLeft: 6 }} onClick={() => nav('/tenant/inventory')}>{tx('pos.add_in_inventory')}</button></div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <div className="min-w-[600px]">
                  <div className="row" style={{ fontSize: 10.5, color: '#8A7A66', fontWeight: 700, textTransform: 'uppercase', marginTop: 8 }}>
                    <div style={{ flex: 1, minWidth: 120 }}>{tx('pos.product')}</div><div style={{ width: 70 }}>SKU</div><div style={{ width: 40 }}>{tx('pos.stock')}</div><div style={{ width: 48 }}>{tx('pos.reorder')}</div><div style={{ width: 56, textAlign: 'right' }}>{tx('pos.price')}</div><div style={{ width: 52, textAlign: 'right' }}>{tx('pos.cost')}</div><div style={{ width: 44, textAlign: 'right' }}>{tx('pos.margin')}</div><div style={{ width: 56 }}>{tx('pos.status')}</div>
                  </div>
                  <div className="list" style={{ maxHeight: 'calc(100vh - 360px)', minHeight: 160 }}>
                    {invProducts.map((p) => (
                      <div className="row" key={p.id} style={{ cursor: 'pointer', background: selProd?.id === p.id ? '#FBF4E8' : undefined }} onClick={() => { setSelProd(p); setDetailTab('product'); }}>
                        <div className="t" style={{ flex: 1, minWidth: 120 }}>{p.name}</div>
                    <div className="s" style={{ width: 70 }}>{p.sku || '—'}</div>
                    <div style={{ width: 40 }}>{p.onHand}</div>
                    <div className="s" style={{ width: 48 }}>{p.reorder_level ?? '—'}</div>
                    <div className="r" style={{ width: 56 }}>{p.retail_price_cents != null ? money(p.retail_price_cents) : '—'}</div>
                    <div className="s r" style={{ width: 52 }}>{p.cost_cents != null ? money(p.cost_cents) : '—'}</div>
                    <div className="s r" style={{ width: 44 }}>{marginPctOf(p.retail_price_cents, p.cost_cents)}</div>
                    <span className={'pill ' + (p.status === 'in_stock' ? 'ok' : 'warn')} style={{ width: 56, justifyContent: 'flex-end' }}>{statusLabel('stock', p.status)}</span>
                  </div>
                ))}
              </div>
                </div>
              </div>
              <div style={{ marginTop: 8 }}><button className="btn ghost" onClick={() => nav('/tenant/inventory')}>{tx('pos.view_all_products')}</button></div>
            </>
          )}
        </section>
      </div>

      {/* Bundles + AI Insights + Inventory Alerts + Service/Product Detail */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 mt-3.5">
        <section className="panel" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><h2 style={{ margin: 0 }}>{tx('pos.bundles_packages_membership_add_ons')}</h2>{bundles ? <span className="s" style={{ color: '#8A7A66' }}>· {bundles.kpis.totalBundles}</span> : null}</div>
          {bundleRows.length === 0 ? (
            <div className="muted" style={{ marginTop: 10 }}>{tx('pos.no_bundles_yet')}{' '}<button className="btn ghost" style={{ padding: '3px 9px', fontSize: 12, marginLeft: 6 }} onClick={() => nav('/tenant/services/packages')}>{tx('pos.create_a_bundle')}</button></div>
          ) : (
            <div className="list" style={{ marginTop: 6 }}>
              {bundleRows.map((b) => (
                <div className="row" key={b.bundleId}>
                  <div style={{ flex: 1, minWidth: 130 }}>
                    <div className="t">{b.name} {b.label ? <span className="pill ok" style={{ marginLeft: 4 }}>{b.label}</span> : null}</div>
                    <div className="s">{b.metricNote ? b.metricNote : b.savingsCents > 0 ? tx('pos.saving_savingscents', { savingsCents: String(money(b.savingsCents)) }) : ''}</div>
                  </div>
                  <div className="r" style={{ marginRight: 8 }}>{money(b.priceCents)}</div>
                  <span className={'pill ' + (b.status === 'active' ? 'ok' : '')} style={b.status !== 'active' ? { opacity: .55 } : undefined}>{b.status === 'active' ? tx('pos.active_3') : b.status}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 8 }}><button className="btn ghost" onClick={() => nav('/tenant/services/packages')}>{tx('pos.view_all_packages')}</button></div>
        </section>

        <section className="panel" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><h2 style={{ margin: 0 }}>{tx('pos.ai_pricing_menu_insights')}</h2><span className="pill ok" style={{ fontSize: 10 }}>{tx('pos.new')}</span></div>
          {realInsights.length > 0 ? (
            <div className="list" style={{ marginTop: 6 }}>
              {realInsights.map((ins) => (
                <div className="row" key={ins.id}>
                  <span className={'pill ' + sevPill(ins.severity)} style={{ flex: 'none' }}>{ins.severity === 'warning' ? '!' : 'i'}</span>
                  <div style={{ marginLeft: 8, flex: 1 }}><div className="t">{ins.message}</div></div>
                  <div style={{ textAlign: 'right', marginLeft: 8, flex: 'none' }}>
                    <div className="s" style={{ color: '#A96F22', fontWeight: 700 }}>{ins.ctaLabel}</div>
                    {ins.impactLabel ? <div className="s" style={{ color: '#8A7A66' }}>{ins.impactLabel}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : quality.length > 0 ? (
            <div className="list" style={{ marginTop: 6 }}>
              {quality.map((q) => (
                <div className="row" key={q.id}><span className={'pill ' + (q.severity === 'warning' ? 'warn' : '')} style={{ flex: 'none' }}>{q.severity === 'warning' ? '!' : 'i'}</span><div className="t" style={{ marginLeft: 8 }}>{q.text}</div></div>
              ))}
            </div>
          ) : (
            <div className="muted" style={{ marginTop: 10 }}>{tx('pos.no_pricing_insights_yet_they_appear_14gf')}</div>
          )}
          <div style={{ marginTop: 8 }}><button className="btn ghost" onClick={() => nav('/reports')}>{tx('pos.view_all_insights')}</button></div>
        </section>

        <section className="panel" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><h2 style={{ margin: 0 }}>{tx('pos.inventory_alerts')}</h2>{lowStockProducts.length ? <span className="s" style={{ color: '#8A7A66' }}>· {lowStockProducts.length}</span> : null}</div>
          {!inv ? <div className="muted" style={{ marginTop: 10 }}>{tx('pos.loading')}</div> : lowStockProducts.length === 0 ? (
            <div className="muted" style={{ marginTop: 10 }}>{tx('pos.no_low_stock_items')}{inv.totalProducts === 0 ? tx('pos.no_products_tracked_yet') : ''}.</div>
          ) : (
            <div className="list" style={{ marginTop: 6 }}>
              {lowStockProducts.map((p) => (
                <div className="row" key={p.id}>
                  <div className="t" style={{ flex: 1 }}>{p.name}</div>
                  <span className="s" style={{ marginRight: 8 }}>{tx('pos.stock_2')}{' '}{p.onHand} {tx('pos.reorder_2')}{' '}{p.reorder_level ?? '—'}</span>
                  <span className="pill warn">{statusLabel('stock', p.status)}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 8 }}><button className="btn ghost" onClick={() => nav('/tenant/inventory')}>{tx('pos.view_all_4')}</button></div>
        </section>

        <section className="panel" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: 0 }}>{tx('pos.service_product_detail')}</h2>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              <button className={'btn ' + (detailTab === 'service' ? '' : 'ghost')} style={{ padding: '3px 9px', fontSize: 12 }} onClick={() => setDetailTab('service')}>{tx('pos.service_3')}</button>
              <button className={'btn ' + (detailTab === 'product' ? '' : 'ghost')} style={{ padding: '3px 9px', fontSize: 12 }} onClick={() => setDetailTab('product')}>{tx('pos.product')}</button>
            </div>
          </div>
          {detailTab === 'service' ? (
            !detailSvc ? <div className="muted" style={{ marginTop: 10 }}>{tx('pos.select_a_service_row_to_see_1r7b')}</div> : (
              <div style={{ marginTop: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="t" style={{ fontSize: 15, fontWeight: 800 }}>{detailSvc.name}</div><span className={'pill ' + (detailSvc.isActive ? 'ok' : 'warn')} style={{ marginLeft: 'auto' }}>{detailSvc.isActive ? tx('pos.active_3') : tx('pos.inactive_2')}</span></div>
                <div className="list" style={{ marginTop: 6 }}>
                  <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.category')}</div><div style={{ marginLeft: 'auto' }}>{detailSvc.categoryName || '—'}</div></div>
                  <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.duration')}</div><div style={{ marginLeft: 'auto' }}>{detailSvc.durationMinutes} {tx('pos.min')}</div></div>
                  <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.price')}</div><div style={{ marginLeft: 'auto', fontWeight: 700 }}>{money(detailSvc.basePriceCents)}</div></div>
                  <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.commission')}</div><div style={{ marginLeft: 'auto' }}>{commission(detailSvc.commissionType, detailSvc.commissionValue)}</div></div>
                  <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.online_bookable')}</div><div style={{ marginLeft: 'auto' }}>{detailSvc.onlineBookingEnabled ? tx('pos.yes') : tx('pos.no')}</div></div>
                  <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.add_ons')}</div><div style={{ marginLeft: 'auto' }}>{detailSvc.addOnsCount}</div></div>
                </div>
                <div style={{ marginTop: 8 }}><button className="btn ghost" onClick={() => openEdit(detailSvc)}>{tx('pos.edit')}</button></div>
                <QualifiedNowPanel serviceId={detailSvc.serviceId} />
              </div>
            )
          ) : (
            !detailProd ? <div className="muted" style={{ marginTop: 10 }}>{tx('pos.select_a_product_row_to_see_ig46')}</div> : (
              <div style={{ marginTop: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="t" style={{ fontSize: 15, fontWeight: 800 }}>{detailProd.name}</div><span className={'pill ' + (detailProd.status === 'in_stock' ? 'ok' : 'warn')} style={{ marginLeft: 'auto' }}>{statusLabel('stock', detailProd.status)}</span></div>
                <div className="list" style={{ marginTop: 6 }}>
                  <div className="row"><div className="t" style={{ flex: 1 }}>SKU</div><div style={{ marginLeft: 'auto' }}>{detailProd.sku || '—'}</div></div>
                  <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.on_hand')}</div><div style={{ marginLeft: 'auto' }}>{detailProd.onHand}</div></div>
                  <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.reorder_point')}</div><div style={{ marginLeft: 'auto' }}>{detailProd.reorder_level ?? '—'}</div></div>
                  <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.price')}</div><div style={{ marginLeft: 'auto', fontWeight: 700 }}>{detailProd.retail_price_cents != null ? money(detailProd.retail_price_cents) : '—'}</div></div>
                  <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.cost')}</div><div style={{ marginLeft: 'auto' }}>{detailProd.cost_cents != null ? money(detailProd.cost_cents) : '—'}</div></div>
                  <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.margin')}</div><div style={{ marginLeft: 'auto' }}>{marginPctOf(detailProd.retail_price_cents, detailProd.cost_cents)}</div></div>
                </div>
                <div style={{ marginTop: 8 }}><button className="btn ghost" onClick={() => nav('/tenant/inventory')}>{tx('pos.edit_in_inventory')}</button></div>
              </div>
            )
          )}
        </section>

        {/* 5. Branch-level Overrides Section (Separate Panel) */}
        <section className="panel" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>{tx('pos.branch_overrides')}</h2>
          </div>
          
          {detailTab === 'product' ? (
             <div className="muted" style={{ marginTop: 10 }}>{tx('pos.branch_overrides_apply_to_services_select_1wfh')}</div>
          ) : !detailSvc ? (
             <div className="muted" style={{ marginTop: 10 }}>{tx('pos.select_a_service_row_to_see_1r7b')}</div>
          ) : (
            <>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.4 }}>
                {tx('pos.tenant_master_catalog_with_branch_level_tujo')}
              </div>

                  <div className="list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {Object.entries(branchOverrides).map(([branchName, o]) => {
                       const isStandard = !o.price && !o.duration && o.tax === 'Standard' && o.booking === 'Available';
                       const labels = [];
                       if (o.price) labels.push(tx('people.services.override.price', { value: o.price }));
                       if (o.duration) labels.push(tx('people.services.override.duration', { value: o.duration }));
                       if (o.tax !== 'Standard') labels.push(o.tax === 'Tax Exempt' ? tx('pos.tax_exempt') : o.tax);
                       const isConfiguring = configBranch === branchName;

                       return (
                         <div key={branchName} style={{ 
                             border: '1px solid var(--line)', 
                             borderRadius: 8, 
                             padding: 12, 
                             background: '#FFFDF8',
                             opacity: o.booking === 'Available' ? 1 : 0.7
                         }}>
                           <div style={{ display: 'flex', alignItems: 'center' }}>
                             <div style={{ flex: 1 }}>
                               <div className="t" style={{ fontWeight: 800 }}>{branchName}</div>
                               <div className="s" style={{ color: isStandard ? '#8A7A66' : '#A96F22' }}>
                                 {o.booking === 'Not Available' ? tx('pos.not_available_at_this_location') : isStandard ? tx('pos.standard_pricing_duration') : tx('pos.overrides_v0', { v0: String(labels.join(', ')) })}
                               </div>
                             </div>
                             <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                                <span className={'pill ' + (o.booking === 'Available' ? 'ok' : '')} style={{ minWidth: 64, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>{o.booking === 'Available' ? tx('pos.active_3') : tx('pos.inactive_2')}</span>
                                {!isConfiguring && (
                                  <button className="btn ghost" style={{ minWidth: 72, height: 24, padding: 0, fontSize: 11.5, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }} onClick={() => openConfig(branchName)}>{tx('pos.configure')}</button>
                                )}
                             </div>
                           </div>
                           
                           {isConfiguring && (
                             <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                               <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                                 <div>
                                   <div className="s" style={{ marginBottom: 4 }}>{tx('pos.price_override')}</div>
                                   <input type="text" placeholder={tx('pos.standard')} value={bPrice} onChange={(e) => setBPrice(e.target.value)} style={inputStyle} />
                                 </div>
                                 <div>
                                   <div className="s" style={{ marginBottom: 4 }}>{tx('pos.duration_override_min')}</div>
                                   <input type="text" placeholder={tx('pos.standard')} value={bDur} onChange={(e) => setBDur(e.target.value)} style={inputStyle} />
                                 </div>
                                 <div>
                                   <div className="s" style={{ marginBottom: 4 }}>{tx('pos.tax_treatment')}</div>
                                   <select style={{ ...inputStyle, width: '100%' }} value={bTax} onChange={(e) => setBTax(e.target.value)}>
                                     <option>{tx('pos.standard')}</option>
                                     <option>{tx('pos.tax_exempt')}</option>
                                   </select>
                                 </div>
                                 <div>
                                   <div className="s" style={{ marginBottom: 4 }}>{tx('pos.booking_availability')}</div>
                                   <select style={{ ...inputStyle, width: '100%' }} value={bBooking} onChange={(e) => setBBooking(e.target.value)}>
                                     <option>{tx('pos.available')}</option>
                                     <option>{tx('pos.not_available')}</option>
                                   </select>
                                 </div>
                                 <div style={{ gridColumn: '1 / -1', marginTop: 8, display: 'flex', gap: 8 }}>
                                   <button className="btn" onClick={saveConfig}>{tx('pos.save_overrides')}</button>
                                   <button className="btn ghost" onClick={() => setConfigBranch(null)}>{tx('pos.cancel')}</button>
                                 </div>
                               </div>
                             </div>
                           )}
                         </div>
                       );
                    })}
                  </div>
            </>
          )}
        </section>
      </div>

      {/* Top Services & Product Mix */}
      <section className="panel" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><h2 style={{ margin: 0 }}>{tx('pos.top_services_product_mix')}</h2><span className="s" style={{ marginLeft: 'auto', color: '#8A7A66' }}>{tx('pos.menu_price_basis_sales_weighted_lives_ejov')}</span></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3.5">
          <div><div className="s" style={{ fontWeight: 700, marginBottom: 6 }}>{tx('pos.service_mix_by_revenue')}</div>{serviceMixByRevenue.length ? <Donut items={serviceMixByRevenue} /> : <div className="muted">{tx('pos.no_services_loaded')}</div>}</div>
          <div><div className="s" style={{ fontWeight: 700, marginBottom: 6 }}>{tx('pos.retail_mix_by_revenue')}</div>{retailMix.length ? <Donut items={retailMix} /> : <div className="muted">{tx('pos.no_retail_stock_value_yet')}</div>}</div>
          <div>
            <div className="s" style={{ fontWeight: 700, marginBottom: 6 }}>{tx('pos.category_revenue')}</div>
            {catRows.length === 0 ? <div className="muted">{tx('pos.no_services_yet')}</div> : (
              <div>{catRows.slice(0, 6).map(([name, v]) => { const max = Math.max(1, ...catRows.map((c) => c[1].revenueCents)); return (
                <div key={name} style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', fontSize: 11.5 }}><span>{name}</span><span style={{ marginLeft: 'auto', color: '#8A7A66' }}>{money(v.revenueCents)}</span></div>
                  <div style={{ height: 7, background: '#EFE6D6', borderRadius: 4 }}><div style={{ width: `${Math.round((v.revenueCents / max) * 100)}%`, height: 7, background: '#A96F22', borderRadius: 4 }} /></div>
                </div>); })}</div>
            )}
          </div>
          <div><div className="s" style={{ fontWeight: 700, marginBottom: 6 }}>{tx('pos.add_on_conversion_rate')}</div><Gauge pct={null} /></div>
        </div>
      </section>

      {/* Quick Actions */}
      <section className="panel" style={{ marginTop: 12 }}>
        <h2>{tx('pos.quick_actions_2')}</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {[
            { l: tx('pos.add_service'), fn: () => { setCreateOpen(true); setImportOpen(false); } },
            { l: tx('pos.add_product_3'), fn: () => nav('/tenant/inventory') },
            { l: tx('pos.edit_pricing'), fn: () => nav('/tenant/services/pricing') },
            { l: tx('pos.create_bundle'), fn: () => nav('/tenant/services/packages') },
            { l: tx('pos.manage_inventory'), fn: () => nav('/tenant/inventory') },
            { l: tx('pos.update_booking_menu'), fn: () => nav('/booking') },
            { l: tx('pos.import_catalog'), fn: openImport },
            { l: tx('pos.view_reports'), fn: () => nav('/reports') },
          ].map((a) => <button key={a.l} className="btn ghost" onClick={a.fn}>{a.l}</button>)}
        </div>
      </section>
    </div>
  );
}
