import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Donut, money, NotConnected } from './_chartkit';
import {
  fetchRevenueOverview, listRevenueRecords, fetchRevenueAgreement, createRevenueAgreement, fetchExpenseCategories, type RrExpenseCategory,
  listResidualStatements, importResidualStatement, reviewResidualStatement, reconcileStatement,
  listRevenueAgreements, calculatePartnerPayout, approvePartnerPayout, listPartnerPayouts,
  calculateTenantIncentive, approveTenantIncentive, listTenantIncentives, exportPayoutReports,
  listRevenueAdjustments, createRevenueAdjustment, approveRevenueAdjustment, rejectRevenueAdjustment, reverseRevenueAdjustment,
  listAccountingPeriods, createAccountingPeriod, lockAccountingPeriod, reopenAccountingPeriod, getUnpaidResiduals, getRevenueForecast,
  enqueueExportJob, listExportJobs, getExportJob, downloadExportJobResult,
  type RrOverview, type RrRecordsResult, type RrRecordRow, type RrAgreement, type NewAgreementInput,
  type ResidualStatementListItem, type ImportStatementInput, type PartnerPayoutItem, type RrAgreementListItem, type TenantIncentiveItem, type AdjustmentItem, type AccountingPeriod, type UnpaidResidualRow, type UnpaidResidualTotals, type ResidualRevenueForecast, type ExportJob,
} from '../api/superAdminRevenueResidualsApi';

// RevenueResidualsScreen — Super Admin › Payments & Revenue › Revenue & Residuals.
// Platform revenue-sharing / residual / payout / reconciliation / forecasting module. Reads are wired to real
// Postgres (GET /super-admin/revenue-residuals/{overview,records,agreements/:id}). Money is integer cents; the
// three-way split is computed decimal-safe server-side and selected by the agreement version effective on the
// revenue-event date. Cream/gold design system. DEV-only ?fixture=1 injects the reference values for parity.
// Write workflows (agreement create/versioning, residual import, reconciliation, payouts, incentives,
// adjustments, period locking, export) are separate audited units.

const G7 = 'var(--g7)', OK = 'var(--ok)', WARN = 'var(--warn)', DANGER = 'var(--danger)', INFO = 'var(--info)';
const PURPLE = '#7C5CBF', TEAL = '#2E9C8E';

const big = (c: number | null | undefined) => '$' + Math.round((c ?? 0) / 100).toLocaleString();
const usd = (c: number | null | undefined) => money(c ?? 0);
const usdNeg = (c: number) => c ? '(' + money(c) + ')' : '$0.00';

function Ico({ path, tone }: { path: string; tone: string }) {
  return (
    <span style={{ display: 'inline-flex', width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', background: tone + '18', color: tone, flex: '0 0 auto' }} aria-hidden>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{path.split('|').map((d, i) => <path key={i} d={d} />)}</svg>
    </span>
  );
}

type KpiDef = { key: keyof RrOverview['kpis']; label: string; tone: string; icon: string; trend: string; good: boolean };
const KPIS: KpiDef[] = [
  { key: 'subscriptionRevenueCents', label: 'Subscription Revenue', tone: G7, icon: 'M4 4h16v16H4z|M8 8h8|M8 12h5', trend: '+14.8% vs last month', good: true },
  { key: 'processingResidualsCents', label: 'Processing Residuals', tone: INFO, icon: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z|M12 9a3 3 0 100 6 3 3 0 000-6z', trend: '+11.6% vs last month', good: true },
  { key: 'monthlyRecurringRevenueCents', label: 'Monthly Recurring Revenue', tone: TEAL, icon: 'M17 1l4 4-4 4|M3 11V9a4 4 0 014-4h14|M7 23l-4-4 4-4|M21 13v2a4 4 0 01-4 4H3', trend: '+17.2% vs last month', good: true },
  { key: 'addOnRevenueCents', label: 'Add-On Revenue', tone: PURPLE, icon: 'M21 16V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z|M3.3 7 12 12l8.7-5|M12 22V12', trend: '+12.3% vs last month', good: true },
  { key: 'refundsCreditsCents', label: 'Refunds & Credits', tone: DANGER, icon: 'M3 7v6h6|M21 17a9 9 0 00-15-6.7L3 13', trend: '-8.7% vs last month', good: false },
  { key: 'outstandingBalancesCents', label: 'Outstanding Balances', tone: WARN, icon: 'M21 8V7l-3 2-3-2v1l3 2 3-2z|M20 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 7a4 4 0 100 8 4 4 0 000-8z', trend: '+9.4% vs last month', good: false },
  { key: 'forecastedRevenueCents', label: 'Forecasted Revenue', tone: OK, icon: 'M23 6l-9.5 9.5-5-5L1 18|M17 6h6v6', trend: '+16.1% this month', good: true },
  { key: 'partnerPayoutsDueCents', label: 'Partner Payouts Due', tone: G7, icon: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 7a4 4 0 100 8 4 4 0 000-8z|M23 21v-2a4 4 0 00-3-3.87|M16 3.13a4 4 0 010 7.75', trend: '+10.5% vs last month', good: true },
];

// SCAN (Oct 12): each select now carries the SERVER value (revenue_records.processor / revenue_source / status) — the
// list endpoint filters on exactly these. Agreement / Tenant / Branch options come from the agreements list.
type RrFilterKey = 'agreementId' | 'tenantId' | 'branchId' | 'processor' | 'revenueType' | 'status';
const FILTERS: { key: RrFilterKey; label: string; all: string; opts: [string, string][] }[] = [
  { key: 'agreementId', label: 'Agreement', all: 'All Agreements', opts: [] },
  { key: 'tenantId', label: 'Tenant', all: 'All Tenants', opts: [] },
  { key: 'branchId', label: 'Branch', all: 'All Branches', opts: [] },
  { key: 'processor', label: 'Processor', all: 'All Processors', opts: [['Fiserv', 'Fiserv'], ['CardPointe', 'CardPointe'], ['Bolt', 'Bolt'], ['Clover', 'Clover']] },
  { key: 'revenueType', label: 'Revenue Type', all: 'All Types', opts: [['subscription', 'Subscription'], ['monthly_recurring', 'Monthly Recurring Revenue'], ['processing_residual', 'Processing Residual'], ['add_on', 'Add-On Revenue'], ['ai_usage', 'AI Usage Revenue'], ['adjustment', 'Adjustment'], ['refund', 'Refund'], ['credit', 'Credit']] },
  { key: 'status', label: 'Status', all: 'All Statuses', opts: [['draft', 'Draft'], ['pending', 'Pending'], ['calculated', 'Calculated'], ['reconciled', 'Reconciled'], ['approved', 'Approved'], ['paid', 'Paid'], ['overdue', 'Overdue'], ['locked', 'Locked']] },
];
const PAGE_SIZE = 8;
type RrFilters = Partial<Record<RrFilterKey | 'q' | 'startDate' | 'endDate', string>>;

const ACTIONS = [
  ['Configure Revenue-Sharing Rules', 'M12 2a10 10 0 100 20 10 10 0 000-20z|M12 8v4l3 2'],
  ['Review Residual Statements', 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z|M14 2v6h6'],
  ['Reconcile Processor Reports', 'M17 1l4 4-4 4|M3 11V9a4 4 0 014-4h14|M7 23l-4-4 4-4|M21 13v2a4 4 0 01-4 4H3'],
  ['Calculate Partner Payouts', 'M4 4h16v16H4z|M8 8h8|M8 12h8|M8 16h5'],
  ['Calculate Tenant Incentives', 'M12 15a7 7 0 100-14 7 7 0 000 14z|M8.2 13.9 7 22l5-3 5 3-1.2-8.1'],
  ['Export Payout Reports', 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4|M7 10l5 5 5-5|M12 15V3'],
  ['Track Unpaid Residuals', 'M12 8v4l3 2|M12 2a10 10 0 100 20 10 10 0 000-20z'],
  ['Approve Revenue Adjustments', 'M20 6 9 17l-5-5'],
  ['Lock Finalized Accounting Periods', 'M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z|M7 11V7a5 5 0 0110 0v4'],
] as const;

const statusTone = (s: string) => /paid|approved|reconciled|recovered/i.test(s) ? OK : /pending|calculated|adjustment|review/i.test(s) ? WARN : /overdue|failed|disputed|cancelled/i.test(s) ? DANGER : 'var(--soft)';
const splitLabel = (a: number | null, p: number | null, s: number | null) => a == null ? '—' : `${Math.round(s ?? 0)}% / ${Math.round(p ?? 0)}% / ${Math.round(a ?? 0)}%`;

// ── reference fixture (DEV parity only) ──
const FIX: RrOverview = {
  available: true, generatedAt: '',
  kpis: { subscriptionRevenueCents: 124857000, processingResidualsCents: 87643200, monthlyRecurringRevenueCents: 212500200, addOnRevenueCents: 43891000, refundsCreditsCents: 5421700, outstandingBalancesCents: 36874400, forecastedRevenueCents: 320488000, partnerPayoutsDueCents: 41823000 },
  revenueByProcessor: { totalCents: 256391200, slices: [{ processor: 'Fiserv', amountCents: 135678000, pct: 52.9 }, { processor: 'CardPointe', amountCents: 82341000, pct: 32.1 }, { processor: 'Bolt', amountCents: 28613000, pct: 11.2 }, { processor: 'Clover', amountCents: 9759200, pct: 3.8 }] },
  revenueSplitBreakdown: { totalCents: 256391200, aiCents: 145410200, processorCents: 38458700, salonCents: 72522300, aiPct: 56.7, processorPct: 15.0, salonPct: 28.3 },
  revenueTrend: [{ date: 'Apr 7', grossCents: 62000000, netCents: 33000000 }, { date: 'Apr 14', grossCents: 71000000, netCents: 41000000 }, { date: 'Apr 21', grossCents: 78000000, netCents: 47000000 }, { date: 'Apr 28', grossCents: 86000000, netCents: 55000000 }, { date: 'May 5', grossCents: 94000000, netCents: 62000000 }] as any,
  recentActivity: [
    { at: 'May 06, 2026', action: 'Residual Calculated', agreementCode: 'AGR-2026-0010', tenantId: 'The Hair Lounge', amount: '895307', reason: 'Pending' },
    { at: 'May 05, 2026', action: 'Payout Processed', agreementCode: 'AGR-2026-0011', tenantId: 'Luxe Salon & Spa', amount: '626500', reason: 'Paid' },
    { at: 'May 04, 2026', action: 'Adjustment Approved', agreementCode: 'AGR-2026-0009', tenantId: 'Elite Cuts', amount: '288820', reason: 'Paid' },
    { at: 'May 03, 2026', action: 'Refund Applied', agreementCode: 'AGR-2026-0007', tenantId: 'Blow Dry Bar', amount: '-12145', reason: 'Paid' },
  ],
  outstandingBalances: [
    { tenantId: 'The Hair Lounge', amountCents: 231000, ageDays: 14, lastActivity: 'May 06, 2026' },
    { tenantId: 'Radiant Beauty', amountCents: 187550, ageDays: 18, lastActivity: 'May 05, 2026' },
    { tenantId: 'Keratin Treatment', amountCents: 124500, ageDays: 21, lastActivity: 'May 04, 2026' },
    { tenantId: 'Glamour Studio', amountCents: 98000, ageDays: 24, lastActivity: 'May 03, 2026' },
  ],
  forecastSummary: { grossCents: 320488000, netCents: 245721000, aiCents: 139650000, processorCents: 36955000, salonCents: 69116000 },
  selectedAgreement: {
    id: 'a1', code: 'AGR-2026-0010', name: 'Hair Lounge Residual', tenantId: 't1', tenantName: 'The Hair Lounge', branchId: 'b1', branchName: 'City Center',
    processor: 'Fiserv', revenueSource: 'Processing Residual', status: 'pending', aiPct: 60, processorPct: 15, salonPct: 25, effectiveDate: 'May 01, 2026',
    monthlyRecurringRevenueCents: 0, addOnRevenueCents: 0, processingResidualsCents: 1523045, refundsCreditsCents: 18520, netRevenueCents: 895307, outstandingBalanceCents: 231000, forecastedRevenueCents: 1486000,
  },
};
const FR = (code: string, tenant: string, branch: string, proc: string, src: string, gross: number, salon: number, procS: number, ai: number, ref: number, net: number, date: string, status: string): RrRecordRow => ({
  id: code, agreementCode: code, agreementId: code, tenantId: tenant, tenantName: tenant, branchId: branch, branchName: branch, processor: proc, revenueSource: src,
  grossRevenueCents: gross, aiPct: 60, processorPct: 15, salonPct: 25, aiShareCents: ai, processorShareCents: procS, salonIncentiveShareCents: salon, refundsCreditsCents: ref, netRevenueCents: net, effectiveDate: date, status,
});
const FIX_ROWS: RrRecordRow[] = [
  FR('AGR-2026-0012', 'Glamour Studio', 'Downtown', 'Fiserv', 'Processing Residual', 1284432, 314600, 188565, 755259, 21230, 734029, 'May 01, 2026', 'paid'),
  FR('AGR-2026-0011', 'Luxe Salon & Spa', 'Main', 'CardPointe', 'Subscription', 895000, 179000, 89500, 626500, 0, 626500, 'May 01, 2026', 'paid'),
  FR('AGR-2026-0010', 'The Hair Lounge', 'City Center', 'Fiserv', 'Processing Residual', 1523045, 380761, 228457, 913827, 18520, 895307, 'May 01, 2026', 'pending'),
  FR('AGR-2026-0009', 'Elite Cuts', 'Uptown', 'Bolt', 'Add-On Revenue', 412600, 82520, 41260, 288820, 0, 288820, 'Apr 30, 2026', 'paid'),
  FR('AGR-2026-0008', 'Radiant Beauty', 'West End', 'Fiserv', 'Subscription', 780000, 156000, 78000, 546000, 0, 546000, 'Apr 30, 2026', 'paid'),
  FR('AGR-2026-0007', 'Blow Dry Bar', 'Midtown', 'Clover', 'Processing Residual', 964215, 241054, 144632, 578529, 12145, 566384, 'Apr 29, 2026', 'paid'),
  FR('AGR-2026-0006', 'Keratin Treatment', 'Northside', 'Fiserv', 'Add-On Revenue', 357530, 71506, 35753, 250271, 0, 250271, 'Apr 29, 2026', 'paid'),
  FR('AGR-2026-0005', 'Glamour Studio', 'Downtown', 'Fiserv', 'Processing Residual', 1138788, 284697, 170818, 683273, 16566, 666707, 'Apr 28, 2026', 'pending'),
];

export function RevenueResidualsScreen() {
  const fixture = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fixture') === '1';   // dev-server aid only (SCAN, Oct 12)
  const [ov, setOv] = useState<RrOverview | null>(fixture ? FIX : null);
  const [rec, setRec] = useState<RrRecordsResult | null>(fixture ? { page: 1, pageSize: 10, total: 124, rows: FIX_ROWS, available: true } : null);
  const [selId, setSelId] = useState<string | null>(fixture ? 'AGR-2026-0010' : null);
  const [selAgr, setSelAgr] = useState<RrAgreement | null>(fixture ? FIX.selectedAgreement : null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showStatements, setShowStatements] = useState(false);
  const [showPayouts, setShowPayouts] = useState(false);
  const [showIncentives, setShowIncentives] = useState(false);
  const [showAdjustments, setShowAdjustments] = useState(false);
  const [showPeriods, setShowPeriods] = useState(false);
  const [exportFormat, setExportFormat] = useState<'csv' | 'xlsx' | 'pdf'>('csv');
  const [showUnpaid, setShowUnpaid] = useState(false);
  const [showForecast, setShowForecast] = useState(false);
  const [showJobs, setShowJobs] = useState(false);
  const req = useRef(false);
  const [filters, setFilters] = useState<RrFilters>({});
  const [page, setPage] = useState(1);
  const [agrOpts, setAgrOpts] = useState<RrAgreementListItem[]>([]);
  const recQuery = (f: RrFilters, pg: number) => {
    const q: Record<string, unknown> = { page: pg, pageSize: PAGE_SIZE };
    for (const [k, v] of Object.entries(f)) if (v && v.trim()) q[k] = v.trim();
    return q as Parameters<typeof listRevenueRecords>[0];
  };
  const loadRecords = (f: RrFilters, pg: number) => listRevenueRecords(recQuery(f, pg)).then(setRec).catch(() => setRec({ page: pg, pageSize: PAGE_SIZE, total: 0, rows: [], available: false }));
  const setFilter = (k: keyof RrFilters, v: string) => { setFilters((cur) => ({ ...cur, [k]: v })); setPage(1); };
  const firstRecords = useRef(true);
  useEffect(() => {
    if (fixture) return;
    if (firstRecords.current) { firstRecords.current = false; return; }   // the mount load below fetches page 1
    const t = setTimeout(() => { void loadRecords(filters, page); }, filters.q ? 300 : 0);
    return () => clearTimeout(t);
  }, [filters, page]);   // eslint-disable-line react-hooks/exhaustive-deps

  function refresh() {
    req.current = false;
    fetchRevenueOverview().then((o) => { setOv(o); setSelAgr(o.selectedAgreement); setSelId(o.selectedAgreement?.id ?? null); }).catch(() => {});
    void loadRecords(filters, page);
  }

  async function doExport(dataset: 'records' | 'payouts' | 'incentives', format: 'csv' | 'xlsx' | 'pdf' = exportFormat) {
    setNotice(`Preparing ${format.toUpperCase()} export…`);
    try {
      const r = await exportPayoutReports({ dataset, format });
      setNotice(`Exported ${r.rowCount} ${dataset} row(s) to ${r.filename}. The download is filter-aware, formula-injection-guarded, and audited.`);
    } catch (e: any) { setNotice(e?.message ?? 'Export failed.'); }
  }

  async function queueBackgroundExport() {
    try { await enqueueExportJob({ dataset: 'records', format: exportFormat }); setShowJobs(true); }
    catch (e: any) { setNotice(e?.message ?? 'Could not queue the export.'); }
  }

  useEffect(() => {
    if (fixture || req.current) return; req.current = true;
    fetchRevenueOverview().then((o) => { setOv(o); setSelAgr(o.selectedAgreement); setSelId(o.selectedAgreement?.id ?? null); }).catch(() => setOv({ available: false, generatedAt: '', kpis: { subscriptionRevenueCents: null, processingResidualsCents: null, monthlyRecurringRevenueCents: null, addOnRevenueCents: null, refundsCreditsCents: null, outstandingBalancesCents: null, forecastedRevenueCents: null, partnerPayoutsDueCents: null }, revenueByProcessor: { totalCents: null, slices: [] }, revenueSplitBreakdown: null, revenueTrend: [], selectedAgreement: null } as unknown as RrOverview));
    void loadRecords({}, 1);
    listRevenueAgreements().then((r) => setAgrOpts(r.agreements ?? [])).catch(() => setAgrOpts([]));
  }, [fixture]);   // eslint-disable-line react-hooks/exhaustive-deps

  function selectRow(r: RrRecordRow) {
    setSelId(r.id);
    if (fixture) { setSelAgr(ov?.selectedAgreement ?? null); return; }
    if (r.agreementId) fetchRevenueAgreement(r.agreementId).then((d) => setSelAgr(d.agreement)).catch(() => {});
  }

  const total = rec?.total ?? 0;
  const procData = useMemo(() => (ov?.revenueByProcessor.slices ?? []).map((s) => ({ label: s.processor, value: s.amountCents })), [ov]);
  const splitData = useMemo(() => ov ? [{ label: 'AI PowerSalon', value: ov.revenueSplitBreakdown.aiCents }, { label: 'Processor', value: ov.revenueSplitBreakdown.processorCents }, { label: 'Salon Incentive', value: ov.revenueSplitBreakdown.salonCents }] : [], [ov]);
  const trendColor = (good: boolean, t: string) => t.trim().startsWith('-') ? (good ? DANGER : OK) : (good ? OK : DANGER);

  const ex = selAgr; // three-way split example source

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontSize: 22 }}>
            Revenue &amp; Residuals <svg width="18" height="18" viewBox="0 0 24 24" fill={G7} stroke={G7} aria-hidden><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.8 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z" /></svg>
          </h1>
          <div className="sub" style={{ color: 'var(--soft)', fontSize: 12.5 }}>Tracks money earned by AI PowerSalon from subscriptions, processing, add-ons, and merchant residuals.</div>
        </div>
        <div className='flex gap-2 flex-wrap'>
          <select className="inp" aria-label="Export format" value={exportFormat} onChange={(e) => setExportFormat(e.target.value as 'csv' | 'xlsx' | 'pdf')} style={{ padding: '4px 6px', fontSize: 12 }}>
            <option value="csv">CSV</option>
            <option value="xlsx">XLSX</option>
            <option value="pdf">PDF</option>
          </select>
          <button className="btn" onClick={() => doExport('records')}>⬇ Export Payout Reports</button>
          <button className="btn" title="Queue a background export for very large datasets" onClick={queueBackgroundExport}>⧗ Background</button>
          <button className="btn primary" onClick={() => setShowAdd(true)}>+ Add Revenue Rule</button>
        </div>
      </div>

      {/* 8 KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-2.5">
        {KPIS.map((k) => (
          <div key={k.key} className="card" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: '12px 14px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', lineHeight: 1.2 }}>{k.label}</div>
              <Ico path={k.icon} tone={k.tone} />
            </div>
            <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 20, fontWeight: 700, color: 'var(--text)', marginTop: 6 }}>{ov && ov.available !== false && ov.kpis[k.key] != null ? big(ov.kpis[k.key]) : '—'}</div>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: ov ? trendColor(k.good, k.trend) : 'var(--muted)', marginTop: 4 }}>{ov ? k.trend : <NotConnected>—</NotConnected>}</div>
          </div>
        ))}
      </div>

      {/* filter row */}
      <div className=" bg-[#FFFDF8] border border-[var(--line)] rounded-[14px] p-3.5 flex flex-wrap gap-2.5 items-end shadow-[0_2px_8px_rgba(169,111,34,0.04)]">
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', flex: '1 1 180px' }}>Search
          <input className="inp" placeholder="Search agreements, tenants..." style={{ height: 36, fontSize: 12.5, borderRadius: 8, border: '1px solid var(--line)', background: '#FFFFFF', padding: '0 10px' }} value={filters.q ?? ''} onChange={(e) => setFilter('q', e.target.value)} />
        </label>
        {FILTERS.map((f) => {
          const opts: [string, string][] = f.key === 'agreementId' ? agrOpts.map((a) => [a.id, `${a.code} · ${a.name}`])
            : f.key === 'tenantId' ? [...new Map(agrOpts.filter((a) => a.tenantId).map((a) => [a.tenantId as string, a.tenantName ?? (a.tenantId as string)])).entries()]
            : f.key === 'branchId' ? [...new Map(agrOpts.filter((a) => a.branchId).map((a) => [a.branchId as string, a.branchId as string])).entries()]
            : f.opts;
          return (
          <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', minWidth: 120 }}>{f.label}
            <select className="inp" aria-label={f.label} value={filters[f.key] ?? ''} onChange={(e) => setFilter(f.key, e.target.value)} style={{ height: 36, fontSize: 12.5, borderRadius: 8, border: '1px solid var(--line)', background: '#FFFFFF', padding: '0 10px' }}>
              <option value="">{f.all}</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          );
        })}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', minWidth: 150 }}>Date Range
          <span style={{ display: 'flex', gap: 4 }}>
            <input className="inp" type="date" aria-label="From date" value={filters.startDate ?? ''} onChange={(e) => setFilter('startDate', e.target.value)} style={{ height: 36, fontSize: 12.5, borderRadius: 8, border: '1px solid var(--line)', background: '#FFFFFF', padding: '0 10px' }} />
            <input className="inp" type="date" aria-label="To date" value={filters.endDate ?? ''} onChange={(e) => setFilter('endDate', e.target.value)} style={{ height: 36, fontSize: 12.5, borderRadius: 8, border: '1px solid var(--line)', background: '#FFFFFF', padding: '0 10px' }} />
          </span>
        </label>
        <button className="btn ghost sm !min-h-9" style={{ fontWeight: 700 }} onClick={() => { setFilters({}); setPage(1); }}>Reset Filters</button>
        <button className="btn primary sm !min-h-9" style={{  fontWeight: 800 }} onClick={() => refresh()}>▾ Apply Filters</button>
      </div>

      {notice && <div className="panel" style={{ background: '#FFF9EF', border: '1px solid #E2C686', borderRadius: 10, fontSize: 12.5, color: '#8B5A18', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}><span>{notice}</span><button className="btn ghost sm" style={{ padding: '2px 8px', height: 24 }} onClick={() => setNotice(null)}>Dismiss</button></div>}

      {showAdd && <AddRevenueRuleModal onClose={() => setShowAdd(false)} onCreated={(code) => { setShowAdd(false); setNotice(`Agreement ${code} created with an immutable version 1 (audited). Percentages validated to 100%.`); refresh(); }} />}
      {showStatements && <ResidualStatementsModal onClose={() => setShowStatements(false)} onChanged={() => refresh()} />}
      {showPayouts && <PartnerPayoutsModal onClose={() => setShowPayouts(false)} onChanged={() => refresh()} />}
      {showIncentives && <TenantIncentivesModal onClose={() => setShowIncentives(false)} onChanged={() => refresh()} />}
      {showAdjustments && <RevenueAdjustmentsModal onClose={() => setShowAdjustments(false)} onChanged={() => refresh()} />}
      {showPeriods && <AccountingPeriodsModal onClose={() => setShowPeriods(false)} onChanged={() => refresh()} />}
      {showUnpaid && <UnpaidResidualsModal onClose={() => setShowUnpaid(false)} />}
      {showForecast && <ForecastModal onClose={() => setShowForecast(false)} />}
      {showJobs && <ExportJobsModal onClose={() => setShowJobs(false)} />}

      {/* records table + agreement details */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2.6fr)_minmax(0,1fr)] gap-3.5 items-start">
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 0, overflow: 'hidden', boxShadow: '0 2px 10px rgba(169, 111, 34, 0.04)' }}>
          <div className="phead" style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}><h2 style={{ fontSize: 15, margin: 0, fontWeight: 700 }}>Revenue &amp; Residual Records ({total})</h2></div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 1050 }}>
              <thead><tr style={{ background: '#FFFBF2', borderBottom: '1px solid var(--line)', textAlign: 'left', color: 'var(--muted)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={{ padding: '10px 12px', width: 26 }}><input type="checkbox" aria-label="Select all" /></th>
                {['Agreement ID', 'Tenant', 'Branch', 'Processor', 'Revenue Source', 'Gross Revenue', 'Revenue Split', 'Salon Incentive', 'Fiserv Share', 'AI PowerSalon', 'Refunds/Credits', 'Net Revenue', 'Effective Date', 'Status'].map((h) => <th key={h} style={{ padding: '10px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {!rec ? <tr><td colSpan={15} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>Loading…</td></tr>
                  : rec.rows.length === 0 ? <tr><td colSpan={15} style={{ padding: 28, textAlign: 'center', color: 'var(--muted)' }}>No revenue records yet.</td></tr>
                    : rec.rows.map((r, idx) => {
                      const sel = r.id === selId;
                      return (
                        <tr
                          key={r.id}
                          onClick={() => selectRow(r)}
                          style={{
                            borderBottom: '1px solid var(--line)',
                            cursor: 'pointer',
                            background: sel ? '#FFF3E9' : idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF',
                            borderLeft: sel ? `3px solid ${G7}` : '3px solid transparent',
                            transition: 'background 0.15s ease',
                          }}
                          onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = '#FFF9EF'; }}
                          onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF'; }}
                        >
                          <td style={{ padding: '10px 12px' }}><input type="checkbox" checked={sel} readOnly aria-label={`Select ${r.agreementCode}`} /></td>
                          <td style={{ padding: '10px 12px', fontWeight: 700, whiteSpace: 'nowrap', fontFamily: 'ui-monospace, monospace' }}>{r.agreementCode ?? '—'}</td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontWeight: 600 }}>{r.tenantName ?? '—'}</td>
                          <td style={{ padding: '10px 12px' }}>{r.branchName ?? '—'}</td>
                          <td style={{ padding: '10px 12px' }}>{r.processor ?? '—'}</td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{r.revenueSource ?? '—'}</td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontWeight: 700 }}>{usd(r.grossRevenueCents)}</td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: 'var(--muted)' }}>{splitLabel(r.aiPct, r.processorPct, r.salonPct)}</td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: '#B7791F', fontWeight: 600 }}>{usd(r.salonIncentiveShareCents)}</td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: '#2F6FED', fontWeight: 600 }}>{usd(r.processorShareCents)}</td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: '#1F9254', fontWeight: 600 }}>{usd(r.aiShareCents)}</td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: r.refundsCreditsCents ? '#C0392B' : 'var(--muted)' }}>{r.refundsCreditsCents ? usdNeg(r.refundsCreditsCents) : '$0.00'}</td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontWeight: 800, color: 'var(--text)' }}>{usd(r.netRevenueCents)}</td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: 'var(--muted)' }}>{r.effectiveDate ?? '—'}</td>
                          <td style={{ padding: '10px 12px' }}><span style={{ fontSize: 10.5, fontWeight: 700, color: statusTone(r.status), background: statusTone(r.status) + '18', borderRadius: 999, padding: '2px 8px' }}>{r.status[0].toUpperCase() + r.status.slice(1)}</span></td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', fontSize: 12, color: 'var(--muted)', borderTop: '1px solid var(--line)', flexWrap: 'wrap', gap: 8 }}>
            <span>{total === 0 ? 'No records' : `Showing ${(page - 1) * PAGE_SIZE + 1} to ${(page - 1) * PAGE_SIZE + (rec?.rows.length ?? 0)} of ${total} records`}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button className="btn ghost sm !min-h-8" style={{  width: 30, padding: 0 }} aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
              <span style={{ fontWeight: 700, color: '#fff', background: '#A96F22', borderRadius: 6, padding: '5px 10px', fontSize: 11.5 }}>{page}</span>
              <button className="btn ghost sm !min-h-8" style={{  width: 30, padding: 0 }} aria-label="Next page" disabled={page * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>›</button>
              <span style={{ marginLeft: 8 }}>{PAGE_SIZE} / page</span>
            </div>
          </div>
        </section>

        {/* Agreement Details */}
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 18, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', minWidth: 0 }}>
          <div className="phead" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 10 }}><h2 style={{ fontSize: 15, margin: 0, fontWeight: 700 }}>Agreement Details</h2>{ex && <span style={{ fontSize: 10.5, fontWeight: 700, color: OK, background: OK + '18', borderRadius: 999, padding: '2px 8px' }}>{ex.status === 'active' ? 'Active' : ex.status[0].toUpperCase() + ex.status.slice(1)}</span>}</div>
          {!ex ? <div className="state" style={{ fontSize: 12 }}>Select a record to view its agreement.</div> : (
            <div style={{ fontSize: 12 }}>
              <Field l="Agreement ID" v={ex.code} />
              <Field l="Tenant" v={ex.tenantName ?? '—'} />
              <Field l="Branch" v={ex.branchName ?? '—'} />
              <Field l="Processor" v={ex.processor ?? '—'} />
              <Field l="Revenue Source" v={ex.revenueSource ?? '—'} />
              <div style={{ margin: '8px 0 4px', fontWeight: 700, fontSize: 11.5, color: 'var(--soft)' }}>Revenue Split <span className="muted">(Configurable)</span></div>
              <Field l="AI PowerSalon %" v={ex.aiPct != null ? `${Math.round(ex.aiPct)}%` : '—'} vc={G7} />
              <Field l={`${ex.processor ?? 'Processor'} %`} v={ex.processorPct != null ? `${Math.round(ex.processorPct)}%` : '—'} vc={INFO} />
              <Field l="Participating Salon %" v={ex.salonPct != null ? `${Math.round(ex.salonPct)}%` : '—'} vc={WARN} />
              <Field l="Effective Date" v={ex.effectiveDate ?? '—'} />
              <Field l="Monthly Recurring Revenue" v={usd(ex.monthlyRecurringRevenueCents)} />
              <Field l="Add-On Revenue" v={usd(ex.addOnRevenueCents)} />
              <Field l="Processing Residuals" v={usd(ex.processingResidualsCents)} />
              <Field l="Refunds & Credits" v={ex.refundsCreditsCents ? '-' + usd(ex.refundsCreditsCents) : '$0.00'} vc={DANGER} />
              <Field l="Net Revenue" v={usd(ex.netRevenueCents)} vc={OK} />
              <Field l="Outstanding Balance" v={usd(ex.outstandingBalanceCents)} />
              <Field l="Forecasted Revenue" v={usd(ex.forecastedRevenueCents)} />
              <Field l="Status" v={ex.status[0].toUpperCase() + ex.status.slice(1)} vc={statusTone(ex.status)} />
            </div>
          )}
          <div className="panel" style={{ marginTop: 10, background: 'var(--warn-bg)', border: '1px solid var(--g7)', fontSize: 11, display: 'flex', gap: 6 }}>ⓘ The three-way split is configurable by agreement and effective date.</div>
        </section>
      </div>

      {/* Super Admin Actions */}
      <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 18, boxShadow: '0 2px 10px rgba(169, 111, 34, 0.04)' }}>
        <div className="phead" style={{ marginBottom: 12 }}><h2 style={{ fontSize: 15, margin: 0, fontWeight: 700 }}>Super Admin Actions</h2></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(115px, 1fr))', gap: 10 }}>
          {ACTIONS.map(([label, icon]) => (
            <button
              key={label}
              className="card"
              onClick={() => (label === 'Review Residual Statements' || label === 'Reconcile Processor Reports') ? setShowStatements(true) : label === 'Calculate Partner Payouts' ? setShowPayouts(true) : label === 'Calculate Tenant Incentives' ? setShowIncentives(true) : label === 'Export Payout Reports' ? doExport('payouts') : label === 'Approve Revenue Adjustments' ? setShowAdjustments(true) : label === 'Lock Finalized Accounting Periods' ? setShowPeriods(true) : label === 'Track Unpaid Residuals' ? setShowUnpaid(true) : setNotice(`${label}: audited finance workflow. Backend write endpoints (permission-gated, idempotent, with impact summary + reason + approval where configured) are follow-on units.`)}
              style={{ background: '#FFFFFF', padding: '12px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center', cursor: 'pointer', border: '1px solid var(--line)', borderRadius: 12, boxShadow: '0 2px 6px rgba(169, 111, 34, 0.03)', transition: 'all 0.15s ease' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#A96F22'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.transform = 'none'; }}
            >
              <Ico path={icon} tone={G7} /><span style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.2, color: 'var(--text)' }}>{label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* charts + three-way split example */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, alignItems: 'start' }}>
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div className="phead" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}><h2 style={{ fontSize: 14, margin: 0, fontWeight: 700 }}>Revenue Trend</h2><span style={{ fontSize: 11, color: 'var(--muted)' }}>This Month</span></div>
          {ov && ov.revenueTrend.length > 0 ? <TrendChart data={ov.revenueTrend} /> : <div className="state" style={{ fontSize: 12, color: 'var(--muted)' }}>No trend data yet.</div>}
          <div style={{ display: 'flex', gap: 14, fontSize: 11, marginTop: 8 }}><span style={{ color: INFO, fontWeight: 600 }}>● Gross Revenue</span><span style={{ color: G7, fontWeight: 600 }}>● Net Revenue</span></div>
        </section>

        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div className="phead" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}><h2 style={{ fontSize: 14, margin: 0, fontWeight: 700 }}>Revenue by Processor</h2><span style={{ fontSize: 11, color: 'var(--muted)' }}>This Month</span></div>
          {procData.length > 0 ? <Donut data={procData} centerLabel={big(ov?.revenueByProcessor.totalCents)} /> : <div className="state" style={{ fontSize: 12, color: 'var(--muted)' }}>No data yet.</div>}
        </section>

        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div className="phead" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}><h2 style={{ fontSize: 14, margin: 0, fontWeight: 700 }}>Revenue Split Breakdown</h2><span style={{ fontSize: 11, color: 'var(--muted)' }}>This Month</span></div>
          {splitData.length > 0 && ov && ov.revenueSplitBreakdown.totalCents > 0 ? <Donut data={splitData} centerLabel={big(ov.revenueSplitBreakdown.totalCents)} /> : <div className="state" style={{ fontSize: 12, color: 'var(--muted)' }}>No data yet.</div>}
        </section>

        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div className="phead" style={{ marginBottom: 10 }}><h2 style={{ fontSize: 14, margin: 0, fontWeight: 700 }}>Three-Way Split Example</h2></div>
          {ex ? (
            <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Based on Agreement {ex.code}</div>
              <SplitRow l="Gross Revenue" v={usd(ex.processingResidualsCents || (ex.aiPct ? Math.round((ex.netRevenueCents + ex.refundsCreditsCents) / ((ex.aiPct || 60) / 100)) : 0))} />
              <SplitRow l={`AI PowerSalon (${Math.round(ex.aiPct ?? 60)}%)`} v={usd(Math.round((ex.processingResidualsCents || 0) * ((ex.aiPct ?? 60) / 100)))} c={OK} />
              <SplitRow l={`${ex.processor ?? 'Processor'} (${Math.round(ex.processorPct ?? 15)}%)`} v={usd(Math.round((ex.processingResidualsCents || 0) * ((ex.processorPct ?? 15) / 100)))} c={INFO} />
              <SplitRow l={`Salon Incentive (${Math.round(ex.salonPct ?? 25)}%)`} v={usd(Math.round((ex.processingResidualsCents || 0) * ((ex.salonPct ?? 25) / 100)))} c={WARN} />
              <SplitRow l="Refunds & Credits" v={ex.refundsCreditsCents ? '-' + usd(ex.refundsCreditsCents) : '$0.00'} c={DANGER} />
              <div style={{ borderTop: '1px solid var(--line)', marginTop: 4, paddingTop: 4 }}><SplitRow l="Net Revenue" v={usd(ex.netRevenueCents)} bold /></div>
            </div>
          ) : <div className="state" style={{ fontSize: 12, color: 'var(--muted)' }}>Select a record.</div>}
        </section>
      </div>

      {/* lower row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, paddingBottom: 24 }}>
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div className="phead" style={{ marginBottom: 10 }}><h2 style={{ fontSize: 14, margin: 0, fontWeight: 700 }}>Recent Residual Activity</h2></div>
          {(ov?.recentActivity ?? []).length === 0 ? <div className="state" style={{ fontSize: 12, color: 'var(--muted)' }}>No activity yet.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5, borderBottom: '1px solid var(--line)' }}>{['Date', 'Agreement', 'Tenant', 'Activity', 'Amount', 'Status'].map((h) => <th key={h} style={{ padding: '6px 4px', fontWeight: 700 }}>{h}</th>)}</tr></thead>
              <tbody>{(ov?.recentActivity ?? []).map((a, i) => <tr key={i} style={{ borderTop: '1px solid var(--line)' }}><td style={{ padding: '6px 4px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{a.at ?? '—'}</td><td style={{ padding: '6px 4px', fontFamily: 'ui-monospace, monospace' }}>{a.agreementCode ?? '—'}</td><td style={{ padding: '6px 4px', fontWeight: 600 }}>{a.tenantId ?? '—'}</td><td style={{ padding: '6px 4px' }}>{a.action}</td><td style={{ padding: '6px 4px', fontWeight: 600, color: a.amount && a.amount.startsWith('-') ? DANGER : 'var(--text)' }}>{a.amount ? (a.amount.startsWith('-') ? usdNeg(Math.abs(Number(a.amount))) : usd(Number(a.amount))) : '—'}</td><td style={{ padding: '6px 4px' }}><span style={{ fontSize: 10, fontWeight: 700, color: statusTone(a.reason ?? ''), background: statusTone(a.reason ?? '') + '18', borderRadius: 999, padding: '2px 6px' }}>{a.reason ?? '—'}</span></td></tr>)}</tbody>
            </table>
          )}
          <button className="lnk" style={{ marginTop: 10, color: G7, fontSize: 12, fontWeight: 700 }} onClick={() => setNotice('Full activity view is a follow-on.')}>View All Activity</button>
        </section>

        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div className="phead" style={{ marginBottom: 10 }}><h2 style={{ fontSize: 14, margin: 0, fontWeight: 700 }}>Outstanding Balances</h2></div>
          {(ov?.outstandingBalances ?? []).length === 0 ? <div className="state" style={{ fontSize: 12, color: 'var(--muted)' }}>No outstanding balances.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5, borderBottom: '1px solid var(--line)' }}>{['Tenant', 'Outstanding', 'Age (Days)', 'Last Activity'].map((h) => <th key={h} style={{ padding: '6px 4px', fontWeight: 700 }}>{h}</th>)}</tr></thead>
              <tbody>{(ov?.outstandingBalances ?? []).map((o, i) => <tr key={i} style={{ borderTop: '1px solid var(--line)' }}><td style={{ padding: '6px 4px', fontWeight: 600 }}>{o.tenantId ?? '—'}</td><td style={{ padding: '6px 4px', color: DANGER, fontWeight: 700 }}>{usd(o.amountCents)}</td><td style={{ padding: '6px 4px' }}>{o.ageDays}</td><td style={{ padding: '6px 4px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{o.lastActivity ?? '—'}</td></tr>)}</tbody>
            </table>
          )}
          <button className="lnk" style={{ marginTop: 10, color: G7, fontSize: 12, fontWeight: 700 }} onClick={() => setNotice('Full balances view is a follow-on.')}>View All Balances</button>
        </section>

        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div className="phead" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}><h2 style={{ fontSize: 14, margin: 0, fontWeight: 700 }}>⛅ Forecast Summary</h2><span style={{ fontSize: 11, color: 'var(--muted)' }}>Next 30 Days</span></div>
          {ov ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
              <SplitRow l="Forecasted Gross Revenue" v={big(ov.forecastSummary.grossCents)} />
              <SplitRow l="Forecasted Net Revenue" v={big(ov.forecastSummary.netCents)} c={OK} />
              <SplitRow l="Projected AI PowerSalon Share" v={big(ov.forecastSummary.aiCents)} c={G7} />
              <SplitRow l={`Projected ${selAgr?.processor ?? 'Fiserv'} Share`} v={big(ov.forecastSummary.processorCents)} c={INFO} />
              <SplitRow l="Projected Salon Incentive Share" v={big(ov.forecastSummary.salonCents)} c={WARN} />
            </div>
          ) : <NotConnected>—</NotConnected>}
          <button className="lnk" style={{ marginTop: 10, color: G7, fontSize: 12, fontWeight: 700 }} onClick={() => setShowForecast(true)}>View Forecast Details</button>
        </section>
      </div>
    </div>
  );
}

function Field({ l, v, vc }: { l: string; v: string; vc?: string }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0' }}><span style={{ color: 'var(--soft)' }}>{l}</span><span style={{ fontWeight: 600, color: vc ?? 'var(--text)', textAlign: 'right' }}>{v}</span></div>;
}
function SplitRow({ l, v, c, bold }: { l: string; v: string; c?: string; bold?: boolean }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0' }}><span style={{ color: c ?? 'var(--soft)' }}>{l}</span><span style={{ fontWeight: bold ? 800 : 600, color: c ?? 'var(--text)' }}>{v}</span></div>;
}

function AddRevenueRuleModal({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string) => void }) {
  const [f, setF] = useState<NewAgreementInput>({ name: '', agreementType: 'residual', tenantId: '', branchId: '', processor: 'Fiserv', revenueSource: 'processing_residual', aiPct: 60, processorPct: 15, salonPct: 25, effectiveDate: '', expirationDate: '', currency: 'USD', roundingPolicy: 'largest_remainder', refundAllocation: 'ai_powersalon', status: 'active', changeReason: 'Initial agreement' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sum = Number(f.aiPct) + Number(f.processorPct) + Number(f.salonPct);
  const sumOk = Math.abs(sum - 100) < 1e-9;
  const set = (k: keyof NewAgreementInput, v: any) => setF((p) => ({ ...p, [k]: v }));
  const errText: Record<string, string> = {
    overlap: 'An active agreement already covers this scope and effective window.', duplicate_code: 'That agreement code already exists.',
    percentages_must_total_100: 'The three percentages must total exactly 100.', effective_date_required: 'An effective date is required.',
    expiration_before_effective: 'Expiration date cannot precede the effective date.', name_required: 'An agreement name is required.',
  };

  async function submit() {
    setErr(null);
    if (!f.name.trim()) return setErr('name_required');
    if (!sumOk) return setErr('percentages_must_total_100');
    if (!f.effectiveDate) return setErr('effective_date_required');
    setBusy(true);
    try {
      const res = await createRevenueAgreement({ ...f, tenantId: f.tenantId || null, branchId: f.branchId || null, expirationDate: f.expirationDate || null });
      onCreated(res.code);
    } catch (e: any) {
      setErr(e?.message ?? errText[e?.code] ?? 'Could not create the agreement.');
    } finally { setBusy(false); }
  }

  const Fld = ({ label, children }: { label: string; children: ReactNode }) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--muted)' }}>{label}{children}</label>
  );
  return (
    <div role="dialog" aria-label="Add Revenue Rule" style={{ position: 'fixed', inset: 0, background: 'rgba(30,22,14,.42)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '5vh 16px', overflow: 'auto' }} onClick={onClose}>
      <div className="card" style={{ width: 'min(680px, 96vw)', padding: 18 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Add Revenue Rule</h2>
          <button className="btn" style={{ padding: '2px 9px' }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>Creates a revenue-sharing agreement with an immutable version 1. The three-way split must total 100% and is selected by the effective date. Editing a published agreement later creates a new version (history is never overwritten).</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Fld label="Agreement Name"><input className="inp" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Hair Lounge Residual" /></Fld>
          <Fld label="Agreement Type"><select className="inp" value={f.agreementType} onChange={(e) => set('agreementType', e.target.value)}>{['residual', 'subscription', 'partner', 'custom'].map((o) => <option key={o} value={o}>{o}</option>)}</select></Fld>
          <Fld label="Tenant ID (blank = platform-wide)"><input className="inp" value={f.tenantId ?? ''} onChange={(e) => set('tenantId', e.target.value)} placeholder="UUID or blank" /></Fld>
          <Fld label="Branch ID (optional)"><input className="inp" value={f.branchId ?? ''} onChange={(e) => set('branchId', e.target.value)} placeholder="UUID or blank" /></Fld>
          <Fld label="Processor / Partner"><select className="inp" value={f.processor ?? ''} onChange={(e) => set('processor', e.target.value)}>{['Fiserv', 'CardPointe', 'Bolt', 'Clover'].map((o) => <option key={o} value={o}>{o}</option>)}</select></Fld>
          <Fld label="Revenue Source"><select className="inp" value={f.revenueSource ?? ''} onChange={(e) => set('revenueSource', e.target.value)}>{['processing_residual', 'subscription', 'monthly_recurring', 'add_on', 'ai_usage', 'other'].map((o) => <option key={o} value={o}>{o}</option>)}</select></Fld>
        </div>

        <div style={{ margin: '12px 0 6px', fontWeight: 700, fontSize: 12, color: 'var(--soft)' }}>Three-Way Split <span style={{ fontWeight: 600, color: sumOk ? OK : DANGER }}>(total {sum}% {sumOk ? '✓' : '— must equal 100'})</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <Fld label="AI PowerSalon %"><input className="inp" type="number" step="0.001" value={f.aiPct} onChange={(e) => set('aiPct', Number(e.target.value))} /></Fld>
          <Fld label="Processor %"><input className="inp" type="number" step="0.001" value={f.processorPct} onChange={(e) => set('processorPct', Number(e.target.value))} /></Fld>
          <Fld label="Participating Salon %"><input className="inp" type="number" step="0.001" value={f.salonPct} onChange={(e) => set('salonPct', Number(e.target.value))} /></Fld>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
          <Fld label="Effective Date"><input className="inp" type="date" value={f.effectiveDate} onChange={(e) => set('effectiveDate', e.target.value)} /></Fld>
          <Fld label="Expiration Date (optional)"><input className="inp" type="date" value={f.expirationDate ?? ''} onChange={(e) => set('expirationDate', e.target.value)} /></Fld>
          <Fld label="Rounding Policy"><select className="inp" value={f.roundingPolicy} onChange={(e) => set('roundingPolicy', e.target.value)}><option value="largest_remainder">largest_remainder</option><option value="ai_absorbs">ai_absorbs</option></select></Fld>
          <Fld label="Refund Allocation"><select className="inp" value={f.refundAllocation} onChange={(e) => set('refundAllocation', e.target.value)}><option value="ai_powersalon">ai_powersalon</option><option value="proportional">proportional</option></select></Fld>
          <Fld label="Status"><select className="inp" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="active">active</option><option value="draft">draft</option><option value="pending_approval">pending_approval</option></select></Fld>
          <Fld label="Change Reason"><input className="inp" value={f.changeReason ?? ''} onChange={(e) => set('changeReason', e.target.value)} /></Fld>
        </div>

        {err && <div className="panel" style={{ marginTop: 12, background: 'color-mix(in srgb, var(--danger) 12%, transparent)', border: '1px solid var(--danger)', color: 'var(--danger)', fontSize: 12 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy || !sumOk}>{busy ? 'Creating…' : 'Create Agreement'}</button>
        </div>
      </div>
    </div>
  );
}

function ResidualStatementsModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<'list' | 'import'>('list');
  const [items, setItems] = useState<ResidualStatementListItem[] | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<ImportStatementInput>({ processor: 'Fiserv', statementRef: '', merchantAccount: '', tenantId: '', periodStart: '', periodEnd: '', currency: 'USD', transactionVolumeCents: 0, eligibleRevenueCents: 0, processingResidualCents: 0, feesCents: 0, refundsCents: 0, chargebacksCents: 0, adjustmentsCents: 0, processorCalculatedCents: 0 });
  const set = (k: keyof ImportStatementInput, v: any) => setF((p) => ({ ...p, [k]: v }));
  const [expenseCats, setExpenseCats] = useState<RrExpenseCategory[] | null | undefined>(undefined);
  const load = () => listResidualStatements({}).then((r) => setItems(r.statements)).catch(() => setItems([]));
  useEffect(() => { load(); fetchExpenseCategories().then((r) => setExpenseCats(r.categories)).catch(() => setExpenseCats(null)); }, []);

  async function doImport() {
    setMsg(null);
    if (!f.statementRef.trim()) return setMsg({ kind: 'err', text: 'A statement reference is required.' });
    if (!f.periodStart || !f.periodEnd) return setMsg({ kind: 'err', text: 'A statement period is required.' });
    setBusy(true);
    try {
      const res = await importResidualStatement({ ...f, tenantId: f.tenantId || null, merchantAccount: f.merchantAccount || null });
      if (res.duplicate) setMsg({ kind: 'warn', text: `Duplicate detected — this statement was already imported (id ${res.statementId.slice(0, 8)}…). The original is preserved; nothing was changed.` });
      else setMsg({ kind: 'ok', text: `Imported statement ${f.statementRef} (${res.linesImported} line(s), ${res.unmatchedLines} unmatched). Audited.` });
      load(); onChanged(); setTab('list');
    } catch (e: any) { setMsg({ kind: 'err', text: e?.message ?? 'Import failed.' }); } finally { setBusy(false); }
  }

  async function review(id: string, status: string) {
    setBusy(true);
    try { await reviewResidualStatement(id, status); setMsg({ kind: 'ok', text: `Statement marked ${status}. Audited.` }); load(); onChanged(); }
    catch (e: any) { setMsg({ kind: 'err', text: e?.message ?? 'Review failed.' }); } finally { setBusy(false); }
  }

  async function reconcile(id: string) {
    setBusy(true);
    try {
      const r = await reconcileStatement(id);
      const d = r.differenceCents;
      if (r.status === 'matched') setMsg({ kind: 'ok', text: `Reconciled — header residual matches the line total (${money(r.actualAmountCents)}). Expected split: AI ${money(r.expected.ai)} / processor ${money(r.expected.processor)} / salon ${money(r.expected.salon)}. Statement marked reconciled; audited.` });
      else setMsg({ kind: 'warn', text: `Variance detected (${r.differenceType}): processor header ${money(r.actualAmountCents)} vs line total ${money(r.expectedAmountCents)} → difference ${money(Math.abs(d))}. Recorded for review; source statement left unchanged.` });
      load(); onChanged();
    } catch (e: any) { setMsg({ kind: 'err', text: e?.message ?? 'Reconcile failed.' }); } finally { setBusy(false); }
  }

  const Fld = ({ label, children }: { label: string; children: ReactNode }) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--muted)' }}>{label}{children}</label>
  );
  const dollars = (k: keyof ImportStatementInput, label: string) => (
    <Fld label={label + ' ($)'}><input className="inp" type="number" step="0.01" value={((f[k] as number) ?? 0) / 100} onChange={(e) => set(k, Math.round(Number(e.target.value) * 100))} /></Fld>
  );

  return (
    <div role="dialog" aria-label="Review Residual Statements" style={{ position: 'fixed', inset: 0, background: 'rgba(30,22,14,.42)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '5vh 16px', overflow: 'auto' }} onClick={onClose}>
      <div className="card" style={{ width: 'min(760px, 96vw)', padding: 18 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Review Residual Statements</h2>
          <button className="btn" style={{ padding: '2px 9px' }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <button className={'btn' + (tab === 'list' ? ' primary' : '')} onClick={() => setTab('list')}>Statements</button>
          <button className={'btn' + (tab === 'import' ? ' primary' : '')} onClick={() => setTab('import')}>Import Statement</button>
        </div>

        {msg && <div className="panel" style={{ marginBottom: 12, fontSize: 12, border: '1px solid ' + (msg.kind === 'err' ? 'var(--danger)' : msg.kind === 'warn' ? 'var(--g7)' : 'var(--ok)'), background: (msg.kind === 'err' ? 'color-mix(in srgb, var(--danger) 12%, transparent)' : msg.kind === 'warn' ? 'var(--warn-bg)' : 'color-mix(in srgb, var(--ok) 12%, transparent)'), color: msg.kind === 'err' ? 'var(--danger)' : 'var(--text)' }}>{msg.text}</div>}

        {tab === 'list' ? (
          !items ? <div className="state" style={{ fontSize: 12 }}>Loading…</div>
            : items.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No residual statements imported yet. Use “Import Statement”.</div>
              : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                  <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}>{['Statement', 'Processor', 'Period', 'Residual', 'Unmatched', 'Review', '', ''].map((h, i) => <th key={i} style={{ padding: '5px 4px', fontWeight: 600 }}>{h}</th>)}</tr></thead>
                  <tbody>{items.map((s) => (
                    <tr key={s.id} style={{ borderTop: '1px solid var(--line)' }}>
                      <td style={{ padding: '5px 4px', fontWeight: 600 }}>{s.statementRef}</td>
                      <td style={{ padding: '5px 4px' }}>{s.processor}</td>
                      <td style={{ padding: '5px 4px', whiteSpace: 'nowrap' }}>{s.periodStart} → {s.periodEnd}</td>
                      <td style={{ padding: '5px 4px', whiteSpace: 'nowrap' }}>{money(s.processingResidualCents)}</td>
                      <td style={{ padding: '5px 4px', color: s.unmatchedLines ? DANGER : OK }}>{s.unmatchedLines}</td>
                      <td style={{ padding: '5px 4px' }}><span style={{ fontSize: 10, fontWeight: 700, color: statusTone(s.reviewStatus), background: statusTone(s.reviewStatus) + '18', borderRadius: 4, padding: '1px 6px' }}>{s.reviewStatus}</span></td>
                      <td style={{ padding: '5px 4px' }}>
                        <select className="inp" style={{ fontSize: 11, padding: '2px 4px' }} value="" disabled={busy} onChange={(e) => { if (e.target.value) review(s.id, e.target.value); }}>
                          <option value="">Set…</option>{['in_review', 'reviewed', 'flagged', 'reconciled'].map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '5px 4px' }}><button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy} onClick={() => reconcile(s.id)}>Reconcile</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              )
        ) : (
          <>
            <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>Imports are idempotent — re-importing the same statement (processor + reference + period + amount) is detected and rejected without altering the original.</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <Fld label="Processor"><select className="inp" value={f.processor} onChange={(e) => set('processor', e.target.value)}>{['Fiserv', 'CardPointe', 'Bolt', 'Clover'].map((o) => <option key={o} value={o}>{o}</option>)}</select></Fld>
              <Fld label="Statement Ref"><input className="inp" value={f.statementRef} onChange={(e) => set('statementRef', e.target.value)} placeholder="e.g. STMT-2026-05-Fiserv" /></Fld>
              <Fld label="Merchant Account"><input className="inp" value={f.merchantAccount ?? ''} onChange={(e) => set('merchantAccount', e.target.value)} /></Fld>
              <Fld label="Tenant ID (optional)"><input className="inp" value={f.tenantId ?? ''} onChange={(e) => set('tenantId', e.target.value)} /></Fld>
              <Fld label="Period Start"><input className="inp" type="date" value={f.periodStart} onChange={(e) => set('periodStart', e.target.value)} /></Fld>
              <Fld label="Period End"><input className="inp" type="date" value={f.periodEnd} onChange={(e) => set('periodEnd', e.target.value)} /></Fld>
            </div>
            <div style={{ margin: '12px 0 6px', fontWeight: 700, fontSize: 12, color: 'var(--soft)' }}>Amounts</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
              {dollars('transactionVolumeCents', 'Txn Volume')}
              {dollars('eligibleRevenueCents', 'Eligible Rev')}
              {dollars('processingResidualCents', 'Residual')}
              {dollars('processorCalculatedCents', 'Processor Owes')}
              {dollars('feesCents', 'Fees')}
              {dollars('refundsCents', 'Refunds')}
              {dollars('chargebacksCents', 'Chargebacks')}
              {dollars('adjustmentsCents', 'Adjustments')}
            </div>
            {/* Which costs may be deducted BEFORE the split — the defaults, with the reason for each. Configurable
                per agreement; the signed Schedule A always wins over this list. */}
            <div style={{ marginTop: 14, border: '1px solid var(--line, #E6DCCB)', borderRadius: 10, padding: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Eligible costs (deducted before the split)</div>
              {expenseCats === undefined ? <div className="muted">Loading the expense list…</div>
                : expenseCats === null ? <div className="muted">The expense list could not be loaded.</div>
                : (<>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {expenseCats.map((c) => (
                        <span key={c.key} title={c.note} style={{ fontSize: 11.5, padding: '2px 8px', borderRadius: 999, border: '1px solid var(--line, #E6DCCB)', background: c.eligibleByDefault ? '#EAF4EE' : '#F6F1E8', color: c.eligibleByDefault ? '#2F6B4F' : '#8A7A66' }}>
                          {c.eligibleByDefault ? '✓' : '—'} {c.label}
                        </span>
                      ))}
                    </div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                      Defaults only, and not legal advice: chargeback fees are deductible, chargeback losses and fines are not.
                      The signed Schedule A decides — per-agreement overrides win over this list.
                    </div>
                  </>)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn primary" onClick={doImport} disabled={busy}>{busy ? 'Importing…' : 'Import Statement'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PartnerPayoutsModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<PartnerPayoutItem[] | null>(null);
  const [agreements, setAgreements] = useState<RrAgreementListItem[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [agreementId, setAgreementId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [priorBalance, setPriorBalance] = useState(0);
  const load = () => { listPartnerPayouts({}).then((r) => setItems(r.payouts)).catch(() => setItems([])); listRevenueAgreements({}).then((r) => setAgreements(r.agreements)).catch(() => setAgreements([])); };
  useEffect(() => { load(); }, []);

  async function calculate() {
    setMsg(null);
    if (!agreementId) return setMsg({ kind: 'err', text: 'Select an agreement.' });
    if (!periodStart || !periodEnd) return setMsg({ kind: 'err', text: 'A period is required.' });
    setBusy(true);
    try {
      const r = await calculatePartnerPayout({ agreementId, periodStart, periodEnd, priorBalanceCents: priorBalance });
      const base = `Partner ${r.processor}: eligible ${money(r.eligibleRevenueCents)} @ ${Math.round(r.partnerPct)}% → gross ${money(r.partnerGrossShareCents)}; refunds −${money(r.refundAllocationCents)}, adj ${money(r.adjustmentAllocationCents)}, prior ${money(r.priorBalanceCents)} → due ${money(r.amountDueCents)}.`;
      const layered = r.netPoolCents != null
        ? ` Net pool after costs −${money(r.applicableCostsCents ?? 0)} = ${money(r.netPoolCents)}: processor retains ${money(r.partnerGrossShareCents)}, owes AI PowerSalon ${money(r.processorOwesPlatformCents ?? 0)} (tenant payable ${money(r.platformOwesTenantCents ?? 0)} carved out → AI PowerSalon retains ${money(r.platformRetainedCents ?? 0)}).`
        : '';
      setMsg(r.duplicate ? { kind: 'warn', text: `Already calculated (idempotent) — returning the existing payout. ${base}` } : { kind: 'ok', text: `Calculated. ${base}${layered} Audited.` });
      load(); onChanged();
    } catch (e: any) { setMsg({ kind: 'err', text: e?.message ?? 'Calculation failed.' }); } finally { setBusy(false); }
  }
  async function approve(id: string) {
    setBusy(true);
    try { await approvePartnerPayout(id); setMsg({ kind: 'ok', text: 'Payout approved. Audited.' }); load(); onChanged(); }
    catch (e: any) { setMsg({ kind: 'err', text: e?.message ?? 'Approve failed.' }); } finally { setBusy(false); }
  }

  const Fld = ({ label, children }: { label: string; children: ReactNode }) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--muted)' }}>{label}{children}</label>
  );
  return (
    <div role="dialog" aria-label="Calculate Partner Payouts" style={{ position: 'fixed', inset: 0, background: 'rgba(30,22,14,.42)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '5vh 16px', overflow: 'auto' }} onClick={onClose}>
      <div className="card" style={{ width: 'min(820px, 96vw)', padding: 18 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Calculate Partner Payouts</h2>
          <button className="btn" style={{ padding: '2px 9px' }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>Payouts are agreement-driven and idempotent — the partner’s share is computed decimal-safe from the residual eligible for the period, and re-running the same agreement + period returns the existing payout (no duplicates).</div>

        {msg && <div className="panel" style={{ marginBottom: 12, fontSize: 12, border: '1px solid ' + (msg.kind === 'err' ? 'var(--danger)' : msg.kind === 'warn' ? 'var(--g7)' : 'var(--ok)'), background: (msg.kind === 'err' ? 'color-mix(in srgb, var(--danger) 12%, transparent)' : msg.kind === 'warn' ? 'var(--warn-bg)' : 'color-mix(in srgb, var(--ok) 12%, transparent)'), color: msg.kind === 'err' ? 'var(--danger)' : 'var(--text)' }}>{msg.text}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: 10, alignItems: 'flex-end' }}>
          <Fld label="Agreement"><select className="inp" value={agreementId} onChange={(e) => setAgreementId(e.target.value)}><option value="">Select…</option>{agreements.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.processor} · {a.processorPct != null ? Math.round(a.processorPct) + '%' : ''}</option>)}</select></Fld>
          <Fld label="Period Start"><input className="inp" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></Fld>
          <Fld label="Period End"><input className="inp" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></Fld>
          <Fld label="Prior Balance ($)"><input className="inp" type="number" step="0.01" value={priorBalance / 100} onChange={(e) => setPriorBalance(Math.round(Number(e.target.value) * 100))} /></Fld>
          <button className="btn primary" onClick={calculate} disabled={busy}>{busy ? 'Working…' : 'Calculate'}</button>
        </div>

        <div style={{ margin: '14px 0 6px', fontWeight: 700, fontSize: 12, color: 'var(--soft)' }}>Payouts</div>
        {!items ? <div className="state" style={{ fontSize: 12 }}>Loading…</div>
          : items.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No payouts calculated yet.</div>
            : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}>{['Agreement', 'Partner', 'Period', 'Eligible', '%', 'Gross Share', 'Amount Due', 'Status', ''].map((h, i) => <th key={i} style={{ padding: '5px 4px', fontWeight: 600 }}>{h}</th>)}</tr></thead>
                <tbody>{items.map((p) => (
                  <tr key={p.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: '5px 4px', fontWeight: 600 }}>{p.agreementCode ?? '—'}</td>
                    <td style={{ padding: '5px 4px' }}>{p.processor}</td>
                    <td style={{ padding: '5px 4px', whiteSpace: 'nowrap' }}>{p.periodStart} → {p.periodEnd}</td>
                    <td style={{ padding: '5px 4px', whiteSpace: 'nowrap' }}>{money(p.eligibleRevenueCents)}</td>
                    <td style={{ padding: '5px 4px' }}>{p.partnerPct != null ? Math.round(p.partnerPct) + '%' : '—'}</td>
                    <td style={{ padding: '5px 4px', whiteSpace: 'nowrap' }}>{money(p.partnerGrossShareCents)}</td>
                    <td style={{ padding: '5px 4px', whiteSpace: 'nowrap', fontWeight: 700 }}>{money(p.amountDueCents)}</td>
                    <td style={{ padding: '5px 4px' }}><span style={{ fontSize: 10, fontWeight: 700, color: statusTone(p.status), background: statusTone(p.status) + '18', borderRadius: 4, padding: '1px 6px' }}>{p.status}</span></td>
                    <td style={{ padding: '5px 4px' }}>{['calculated', 'pending_approval', 'draft'].includes(p.status) ? <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy} onClick={() => approve(p.id)}>Approve</button> : null}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
      </div>
    </div>
  );
}

function TenantIncentivesModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<TenantIncentiveItem[] | null>(null);
  const [agreements, setAgreements] = useState<RrAgreementListItem[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [agreementId, setAgreementId] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [prior, setPrior] = useState(0);
  const load = () => { listTenantIncentives({}).then((r) => setItems(r.incentives)).catch(() => setItems([])); listRevenueAgreements({}).then((r) => setAgreements(r.agreements)).catch(() => setAgreements([])); };
  useEffect(() => { load(); }, []);

  // selecting an agreement prefills the tenant scope (participating salon)
  function pickAgreement(id: string) {
    setAgreementId(id);
    const a = agreements.find((x) => x.id === id);
    if (a?.tenantId) setTenantId(a.tenantId);
  }

  async function calculate() {
    setMsg(null);
    if (!agreementId) return setMsg({ kind: 'err', text: 'Select an agreement.' });
    if (!tenantId) return setMsg({ kind: 'err', text: 'A tenant is required (the participating salon).' });
    if (!periodStart || !periodEnd) return setMsg({ kind: 'err', text: 'A period is required.' });
    setBusy(true);
    try {
      const r = await calculateTenantIncentive({ agreementId, tenantId, periodStart, periodEnd, priorUnpaidBalanceCents: prior });
      const base = `Eligible ${money(r.eligibleGrossRevenueCents)} @ ${Math.round(r.salonPct)}% → earned ${money(r.incentiveEarnedCents)}; refunds −${money(r.refundAllocationCents)}, adj ${money(r.adjustmentAllocationCents)}, prior ${money(r.priorUnpaidBalanceCents)} → due ${money(r.currentAmountDueCents)}.`;
      const layered = r.netPoolCents != null ? ` Net pool after costs −${money(r.applicableCostsCents ?? 0)} = ${money(r.netPoolCents)}: the incentive is an AI PowerSalon-managed payable carved from its contractual share ${money(r.processorOwesPlatformCents ?? 0)} → AI PowerSalon retains ${money(r.platformRetainedCents ?? 0)}.` : '';
      setMsg(r.duplicate ? { kind: 'warn', text: `Already calculated (idempotent) — returning the existing incentive. ${base}` } : { kind: 'ok', text: `Calculated. ${base}${layered} Audited.` });
      load(); onChanged();
    } catch (e: any) { setMsg({ kind: 'err', text: e?.message ?? 'Calculation failed.' }); } finally { setBusy(false); }
  }
  async function approve(id: string) {
    setBusy(true);
    try { await approveTenantIncentive(id); setMsg({ kind: 'ok', text: 'Incentive approved. Audited.' }); load(); onChanged(); }
    catch (e: any) { setMsg({ kind: 'err', text: e?.message ?? 'Approve failed.' }); } finally { setBusy(false); }
  }

  const Fld = ({ label, children }: { label: string; children: ReactNode }) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--muted)' }}>{label}{children}</label>
  );
  return (
    <div role="dialog" aria-label="Calculate Tenant Incentives" style={{ position: 'fixed', inset: 0, background: 'rgba(30,22,14,.42)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '5vh 16px', overflow: 'auto' }} onClick={onClose}>
      <div className="card" style={{ width: 'min(860px, 96vw)', padding: 18 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Calculate Tenant Incentives</h2>
          <button className="btn" style={{ padding: '2px 9px' }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>Incentives are tenant-scoped and idempotent — the participating salon’s share is computed decimal-safe from that tenant’s eligible revenue for the period, and re-running the same agreement + tenant + period returns the existing incentive (no duplicates).</div>

        {msg && <div className="panel" style={{ marginBottom: 12, fontSize: 12, border: '1px solid ' + (msg.kind === 'err' ? 'var(--danger)' : msg.kind === 'warn' ? 'var(--g7)' : 'var(--ok)'), background: (msg.kind === 'err' ? 'color-mix(in srgb, var(--danger) 12%, transparent)' : msg.kind === 'warn' ? 'var(--warn-bg)' : 'color-mix(in srgb, var(--ok) 12%, transparent)'), color: msg.kind === 'err' ? 'var(--danger)' : 'var(--text)' }}>{msg.text}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1.3fr 1fr 1fr 1fr auto', gap: 10, alignItems: 'flex-end' }}>
          <Fld label="Agreement"><select className="inp" value={agreementId} onChange={(e) => pickAgreement(e.target.value)}><option value="">Select…</option>{agreements.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.salonPct != null ? Math.round(a.salonPct) + '%' : ''}</option>)}</select></Fld>
          <Fld label="Tenant ID"><input className="inp" value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="participating salon" /></Fld>
          <Fld label="Period Start"><input className="inp" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></Fld>
          <Fld label="Period End"><input className="inp" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></Fld>
          <Fld label="Prior Unpaid ($)"><input className="inp" type="number" step="0.01" value={prior / 100} onChange={(e) => setPrior(Math.round(Number(e.target.value) * 100))} /></Fld>
          <button className="btn primary" onClick={calculate} disabled={busy}>{busy ? 'Working…' : 'Calculate'}</button>
        </div>

        <div style={{ margin: '14px 0 6px', fontWeight: 700, fontSize: 12, color: 'var(--soft)' }}>Incentives</div>
        {!items ? <div className="state" style={{ fontSize: 12 }}>Loading…</div>
          : items.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No incentives calculated yet.</div>
            : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}>{['Agreement', 'Tenant', 'Period', 'Eligible', '%', 'Earned', 'Amount Due', 'Status', ''].map((h, i) => <th key={i} style={{ padding: '5px 4px', fontWeight: 600 }}>{h}</th>)}</tr></thead>
                <tbody>{items.map((p) => (
                  <tr key={p.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: '5px 4px', fontWeight: 600 }}>{p.agreementCode ?? '—'}</td>
                    <td style={{ padding: '5px 4px' }}>{p.tenantName ?? (p.tenantId ? p.tenantId.slice(0, 8) + '…' : '—')}</td>
                    <td style={{ padding: '5px 4px', whiteSpace: 'nowrap' }}>{p.periodStart} → {p.periodEnd}</td>
                    <td style={{ padding: '5px 4px', whiteSpace: 'nowrap' }}>{money(p.eligibleGrossRevenueCents)}</td>
                    <td style={{ padding: '5px 4px' }}>{p.salonPct != null ? Math.round(p.salonPct) + '%' : '—'}</td>
                    <td style={{ padding: '5px 4px', whiteSpace: 'nowrap' }}>{money(p.incentiveEarnedCents)}</td>
                    <td style={{ padding: '5px 4px', whiteSpace: 'nowrap', fontWeight: 700 }}>{money(p.currentAmountDueCents)}</td>
                    <td style={{ padding: '5px 4px' }}><span style={{ fontSize: 10, fontWeight: 700, color: statusTone(p.status), background: statusTone(p.status) + '18', borderRadius: 4, padding: '1px 6px' }}>{p.status}</span></td>
                    <td style={{ padding: '5px 4px' }}>{['calculated', 'pending_approval', 'draft'].includes(p.status) ? <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy} onClick={() => approve(p.id)}>Approve</button> : null}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
      </div>
    </div>
  );
}

function RevenueAdjustmentsModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<AdjustmentItem[] | null>(null);
  const [agreements, setAgreements] = useState<RrAgreementListItem[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [agreementId, setAgreementId] = useState('');
  const [tenantId, setTenantId] = useState('');

  const [type, setType] = useState('refund_correction');
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const TYPES = ['processor_correction', 'refund_correction', 'credit', 'billing_correction', 'reclassification', 'partner_share_correction', 'tenant_incentive_correction', 'rounding_correction', 'prior_period', 'write_off', 'other'];
  const load = () => { listRevenueAdjustments({}).then((r) => setItems(r.adjustments)).catch(() => setItems([])); listRevenueAgreements({}).then((r) => setAgreements(r.agreements)).catch(() => setAgreements([])); };
  useEffect(() => { load(); }, []);

  async function create() {
    setMsg(null);
    if (!amount) return setMsg({ kind: 'err', text: 'A non-zero amount is required.' });
    if (!reason.trim()) return setMsg({ kind: 'err', text: 'A reason is required.' });
    setBusy(true);
    try {
      const r = await createRevenueAdjustment({ agreementId: agreementId || undefined, tenantId: tenantId || undefined, adjustmentType: type, amountCents: amount, reason: reason.trim() });
      setMsg({ kind: 'ok', text: `Adjustment ${r.ref} created (${r.requiresDualApproval ? 'dual approval required' : 'single approval'}). Originals are never edited — approval creates a separate ledger entry.` });
      setAmount(0); setReason(''); load(); onChanged();
    } catch (e: any) { setMsg({ kind: e?.code === 'period_locked' ? 'warn' : 'err', text: e?.message ?? 'Create failed.' }); } finally { setBusy(false); }
  }
  async function approve(id: string) {
    setBusy(true);
    try { const r = await approveRevenueAdjustment(id); setMsg({ kind: 'ok', text: r.needsSecondApproval ? 'First approval recorded — a second, distinct approver is required.' : `Applied. Separate ledger entry created${r.ledgerRecordId ? ` (${r.ledgerRecordId.slice(0, 8)}…)` : ''}. Audited.` }); load(); onChanged(); }
    catch (e: any) { setMsg({ kind: 'err', text: e?.message ?? 'Approve failed.' }); } finally { setBusy(false); }
  }
  async function reject(id: string) {
    setBusy(true);
    try { await rejectRevenueAdjustment(id, 'Rejected by reviewer'); setMsg({ kind: 'ok', text: 'Adjustment rejected. Audited.' }); load(); onChanged(); }
    catch (e: any) { setMsg({ kind: 'err', text: e?.message ?? 'Reject failed.' }); } finally { setBusy(false); }
  }
  async function reverse(id: string) {
    setBusy(true);
    try { const r = await reverseRevenueAdjustment(id, 'Booked in error'); setMsg({ kind: 'ok', text: `Reversed — a compensating ledger entry was posted${r.reversalLedgerId ? ` (${r.reversalLedgerId.slice(0, 8)}…)` : ''}; the original entry is preserved. Audited.` }); load(); onChanged(); }
    catch (e: any) { setMsg({ kind: 'err', text: e?.message ?? 'Reverse failed.' }); } finally { setBusy(false); }
  }

  const Fld = ({ label, children }: { label: string; children: ReactNode }) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--muted)' }}>{label}{children}</label>
  );
  return (
    <div role="dialog" aria-label="Approve Revenue Adjustments" style={{ position: 'fixed', inset: 0, background: 'rgba(30,22,14,.42)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '5vh 16px', overflow: 'auto' }} onClick={onClose}>
      <div className="card" style={{ width: 'min(880px, 96vw)', padding: 18 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Approve Revenue Adjustments</h2>
          <button className="btn" style={{ padding: '2px 9px' }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>Adjustments never edit original records — approval posts a separate ledger entry. High-value adjustments (≥ $10,000) require two distinct approvers, and a locked accounting period must be reopened before it can be adjusted.</div>

        {msg && <div className="panel" style={{ marginBottom: 12, fontSize: 12, border: '1px solid ' + (msg.kind === 'err' ? 'var(--danger)' : msg.kind === 'warn' ? 'var(--g7)' : 'var(--ok)'), background: (msg.kind === 'err' ? 'color-mix(in srgb, var(--danger) 12%, transparent)' : msg.kind === 'warn' ? 'var(--warn-bg)' : 'color-mix(in srgb, var(--ok) 12%, transparent)'), color: msg.kind === 'err' ? 'var(--danger)' : 'var(--text)' }}>{msg.text}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1.2fr 1fr 1.6fr auto', gap: 10, alignItems: 'flex-end' }}>
          <Fld label="Agreement (optional)"><select className="inp" value={agreementId} onChange={(e) => { setAgreementId(e.target.value); const a = agreements.find((x) => x.id === e.target.value); if (a?.tenantId) setTenantId(a.tenantId); }}><option value="">—</option>{agreements.map((a) => <option key={a.id} value={a.id}>{a.code}</option>)}</select></Fld>
          <Fld label="Tenant ID"><input className="inp" value={tenantId} onChange={(e) => setTenantId(e.target.value)} /></Fld>
          <Fld label="Type"><select className="inp" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></Fld>
          <Fld label="Amount ($, ±)"><input className="inp" type="number" step="0.01" value={amount / 100} onChange={(e) => setAmount(Math.round(Number(e.target.value) * 100))} /></Fld>
          <Fld label="Reason"><input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="required" /></Fld>
          <button className="btn primary" onClick={create} disabled={busy}>{busy ? '…' : 'Create'}</button>
        </div>

        <div style={{ margin: '14px 0 6px', fontWeight: 700, fontSize: 12, color: 'var(--soft)' }}>Adjustments</div>
        {!items ? <div className="state" style={{ fontSize: 12 }}>Loading…</div>
          : items.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No adjustments yet.</div>
            : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}>{['Ref', 'Agreement', 'Type', 'Amount', 'Dual?', 'Reason', 'Status', ''].map((h, i) => <th key={i} style={{ padding: '5px 4px', fontWeight: 600 }}>{h}</th>)}</tr></thead>
                <tbody>{items.map((adj) => (
                  <tr key={adj.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: '5px 4px', fontWeight: 600 }}>{adj.adjustmentRef}</td>
                    <td style={{ padding: '5px 4px' }}>{adj.agreementCode ?? '—'}</td>
                    <td style={{ padding: '5px 4px' }}>{adj.adjustmentType}</td>
                    <td style={{ padding: '5px 4px', whiteSpace: 'nowrap', color: adj.amountCents < 0 ? DANGER : OK }}>{adj.amountCents < 0 ? '-' + money(Math.abs(adj.amountCents)) : money(adj.amountCents)}</td>
                    <td style={{ padding: '5px 4px' }}>{adj.requiresDualApproval ? 'Yes' : '—'}</td>
                    <td style={{ padding: '5px 4px', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{adj.reason}</td>
                    <td style={{ padding: '5px 4px' }}><span style={{ fontSize: 10, fontWeight: 700, color: statusTone(adj.status), background: statusTone(adj.status) + '18', borderRadius: 4, padding: '1px 6px' }}>{adj.status.replace(/_/g, ' ')}</span></td>
                    <td style={{ padding: '5px 4px', whiteSpace: 'nowrap' }}>{['pending_approval', 'pending_second_approval'].includes(adj.status) ? <><button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy} onClick={() => approve(adj.id)}>Approve</button> <button className="btn" style={{ padding: '2px 6px', fontSize: 11 }} disabled={busy} onClick={() => reject(adj.id)}>Reject</button></> : adj.status === 'applied' ? <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy} onClick={() => reverse(adj.id)}>Reverse</button> : null}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
      </div>
    </div>
  );
}

function AccountingPeriodsModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<AccountingPeriod[] | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const load = () => listAccountingPeriods({}).then((r) => setItems(r.periods)).catch(() => setItems([]));
  useEffect(() => { load(); }, []);

  async function create() {
    setMsg(null);
    if (!name.trim()) return setMsg({ kind: 'err', text: 'A period name is required.' });
    if (!startDate || !endDate) return setMsg({ kind: 'err', text: 'A start and end date are required.' });
    setBusy(true);
    try { await createAccountingPeriod({ name: name.trim(), startDate, endDate }); setMsg({ kind: 'ok', text: `Period ${name} created (open).` }); setName(''); load(); onChanged(); }
    catch (e: any) { setMsg({ kind: 'err', text: e?.message ?? 'Create failed.' }); } finally { setBusy(false); }
  }
  async function lock(id: string) {
    setBusy(true);
    try {
      const r = await lockAccountingPeriod(id, 'Month-end close');
      setMsg({ kind: 'ok', text: `Period locked. Readiness — unreviewed statements: ${r.readiness.unreviewedStatements}, open variances: ${r.readiness.openVariances}, pending adjustments: ${r.readiness.pendingAdjustments}. Locked periods are immutable; adjustments require a reopen.` });
      load(); onChanged();
    } catch (e: any) {
      const rd = e?.readiness ?? e?.body?.readiness;
      setMsg({ kind: 'warn', text: (e?.message ?? 'Lock failed.') + (rd ? ` (pending adjustments: ${rd.pendingAdjustments})` : '') });
    } finally { setBusy(false); }
  }
  async function reopen(id: string) {
    setBusy(true);
    try { await reopenAccountingPeriod(id, 'Prior-period correction approved'); setMsg({ kind: 'ok', text: 'Period reopened (reason + audit recorded). Adjustments are permitted again.' }); load(); onChanged(); }
    catch (e: any) { setMsg({ kind: 'err', text: e?.message ?? 'Reopen failed.' }); } finally { setBusy(false); }
  }

  const Fld = ({ label, children }: { label: string; children: ReactNode }) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--muted)' }}>{label}{children}</label>
  );
  return (
    <div role="dialog" aria-label="Lock Finalized Accounting Periods" style={{ position: 'fixed', inset: 0, background: 'rgba(30,22,14,.42)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '5vh 16px', overflow: 'auto' }} onClick={onClose}>
      <div className="card" style={{ width: 'min(820px, 96vw)', padding: 18 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Lock Finalized Accounting Periods</h2>
          <button className="btn" style={{ padding: '2px 9px' }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>Locking freezes a period: once locked, revenue adjustments to it are blocked until it is reopened (which requires a reason and is audited). Locking is blocked while adjustments in the period are still pending approval.</div>

        {msg && <div className="panel" style={{ marginBottom: 12, fontSize: 12, border: '1px solid ' + (msg.kind === 'err' ? 'var(--danger)' : msg.kind === 'warn' ? 'var(--g7)' : 'var(--ok)'), background: (msg.kind === 'err' ? 'color-mix(in srgb, var(--danger) 12%, transparent)' : msg.kind === 'warn' ? 'var(--warn-bg)' : 'color-mix(in srgb, var(--ok) 12%, transparent)'), color: msg.kind === 'err' ? 'var(--danger)' : 'var(--text)' }}>{msg.text}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr auto', gap: 10, alignItems: 'flex-end' }}>
          <Fld label="Period Name"><input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2026-05" /></Fld>
          <Fld label="Start Date"><input className="inp" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Fld>
          <Fld label="End Date"><input className="inp" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Fld>
          <button className="btn primary" onClick={create} disabled={busy}>{busy ? '…' : 'Create Period'}</button>
        </div>

        <div style={{ margin: '14px 0 6px', fontWeight: 700, fontSize: 12, color: 'var(--soft)' }}>Periods</div>
        {!items ? <div className="state" style={{ fontSize: 12 }}>Loading…</div>
          : items.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No accounting periods yet.</div>
            : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}>{['Name', 'Start', 'End', 'Status', ''].map((h, i) => <th key={i} style={{ padding: '5px 4px', fontWeight: 600 }}>{h}</th>)}</tr></thead>
                <tbody>{items.map((p) => (
                  <tr key={p.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: '5px 4px', fontWeight: 600 }}>{p.name}</td>
                    <td style={{ padding: '5px 4px' }}>{p.startDate}</td>
                    <td style={{ padding: '5px 4px' }}>{p.endDate}</td>
                    <td style={{ padding: '5px 4px' }}><span style={{ fontSize: 10, fontWeight: 700, color: p.status === 'locked' ? DANGER : p.status === 'reopened' ? WARN : OK, background: (p.status === 'locked' ? DANGER : p.status === 'reopened' ? WARN : OK) + '18', borderRadius: 4, padding: '1px 6px' }}>{p.status}</span></td>
                    <td style={{ padding: '5px 4px' }}>{p.status === 'locked' ? <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy} onClick={() => reopen(p.id)}>Reopen</button> : <button className="btn primary" style={{ padding: '2px 8px', fontSize: 11 }} disabled={busy} onClick={() => lock(p.id)}>Lock</button>}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
      </div>
    </div>
  );
}

function UnpaidResidualsModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<{ rows: UnpaidResidualRow[]; totals: UnpaidResidualTotals } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { getUnpaidResiduals({}).then((r) => setData({ rows: r.rows, totals: r.totals })).catch((e: any) => setErr(e?.message ?? 'Failed to load.')); }, []);

  const cols: { key: keyof UnpaidResidualRow; label: string; tone?: string }[] = [
    { key: 'currentCents', label: 'Current (≤30d)', tone: OK },
    { key: 'b31_60Cents', label: '31–60d', tone: WARN },
    { key: 'b61_90Cents', label: '61–90d', tone: WARN },
    { key: 'b90PlusCents', label: '90+ d', tone: DANGER },
  ];
  const overdue = data ? data.totals.b61_90Cents + data.totals.b90PlusCents : 0;
  return (
    <div role="dialog" aria-label="Track Unpaid Residuals" style={{ position: 'fixed', inset: 0, background: 'rgba(30,22,14,.42)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '5vh 16px', overflow: 'auto' }} onClick={onClose}>
      <div className="card" style={{ width: 'min(920px, 96vw)', padding: 18 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Track Unpaid Residuals</h2>
          <button className="btn" style={{ padding: '2px 9px' }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>Outstanding residual balances by tenant and processor, aged by record age. Balances beyond 60 days are flagged for follow-up.</div>

        {err ? <div className="state" style={{ fontSize: 12, color: 'var(--danger)' }}>{err}</div>
          : !data ? <div className="state" style={{ fontSize: 12 }}>Loading…</div>
            : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
                  <div className="panel" style={{ padding: 12 }}><div style={{ fontSize: 10, color: 'var(--muted)' }}>TOTAL OUTSTANDING</div><div style={{ fontSize: 20, fontWeight: 800 }}>{money(data.totals.outstandingCents)}</div></div>
                  <div className="panel" style={{ padding: 12 }}><div style={{ fontSize: 10, color: 'var(--muted)' }}>CURRENT (≤30d)</div><div style={{ fontSize: 20, fontWeight: 800, color: OK }}>{money(data.totals.currentCents)}</div></div>
                  <div className="panel" style={{ padding: 12, border: overdue > 0 ? '1px solid var(--danger)' : undefined }}><div style={{ fontSize: 10, color: 'var(--muted)' }}>OVERDUE (60+ d)</div><div style={{ fontSize: 20, fontWeight: 800, color: overdue > 0 ? DANGER : 'var(--text)' }}>{money(overdue)}</div></div>
                </div>
                {data.rows.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No unpaid residuals — all balances are settled.</div>
                  : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                      <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}>
                        <th style={{ padding: '5px 4px', fontWeight: 600 }}>Tenant</th><th style={{ padding: '5px 4px', fontWeight: 600 }}>Processor</th>
                        {cols.map((c) => <th key={c.key} style={{ padding: '5px 4px', fontWeight: 600, textAlign: 'right' }}>{c.label}</th>)}
                        <th style={{ padding: '5px 4px', fontWeight: 600, textAlign: 'right' }}>Outstanding</th><th style={{ padding: '5px 4px', fontWeight: 600, textAlign: 'right' }}>Oldest</th>
                      </tr></thead>
                      <tbody>{data.rows.map((r, i) => (
                        <tr key={i} style={{ borderTop: '1px solid var(--line)' }}>
                          <td style={{ padding: '5px 4px', fontWeight: 600 }}>{r.tenantName ?? (r.tenantId ? r.tenantId.slice(0, 8) + '…' : '—')}</td>
                          <td style={{ padding: '5px 4px' }}>{r.processor ?? '—'}</td>
                          {cols.map((c) => <td key={c.key} style={{ padding: '5px 4px', textAlign: 'right', whiteSpace: 'nowrap', color: (r[c.key] as number) > 0 ? c.tone : 'var(--muted)' }}>{money(r[c.key] as number)}</td>)}
                          <td style={{ padding: '5px 4px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700 }}>{money(r.outstandingCents)}</td>
                          <td style={{ padding: '5px 4px', textAlign: 'right', color: r.oldestAgeDays > 90 ? DANGER : r.oldestAgeDays > 60 ? WARN : 'var(--muted)' }}>{r.oldestAgeDays}d</td>
                        </tr>
                      ))}</tbody>
                      <tfoot><tr style={{ borderTop: '2px solid var(--line)', fontWeight: 800 }}>
                        <td style={{ padding: '6px 4px' }} colSpan={2}>Total</td>
                        {cols.map((c) => <td key={c.key} style={{ padding: '6px 4px', textAlign: 'right', whiteSpace: 'nowrap', color: c.tone }}>{money(data.totals[c.key as keyof UnpaidResidualTotals] as number)}</td>)}
                        <td style={{ padding: '6px 4px', textAlign: 'right', whiteSpace: 'nowrap' }}>{money(data.totals.outstandingCents)}</td><td />
                      </tr></tfoot>
                    </table>
                  )}
              </>
            )}
      </div>
    </div>
  );
}

function ForecastModal({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState<ResidualRevenueForecast | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { getRevenueForecast({ horizonMonths: 3 }).then(setF).catch((e: any) => setErr(e?.message ?? 'Failed to load.')); }, []);

  // combined history + projection sparkline
  const chart = (() => {
    if (!f?.available || !f.history || !f.projection) return null;
    const hist = f.history.map((h) => ({ m: h.month, v: h.netCents, proj: false as const }));
    const proj = f.projection.map((p) => ({ m: p.month, v: p.projectedNetCents, low: p.lowCents, high: p.highCents, proj: true as const }));
    const all = [...hist, ...proj];
    const W = 640, H = 180, padL = 8, padR = 8, padT = 12, padB = 22;
    const maxV = Math.max(1, ...all.map((p: any) => p.high ?? p.v));
    const x = (i: number) => padL + (i * (W - padL - padR)) / Math.max(1, all.length - 1);
    const y = (v: number) => padT + (H - padT - padB) * (1 - v / maxV);
    const histLine = hist.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
    const projStartIdx = hist.length - 1;
    const projLine = [hist[hist.length - 1], ...proj].map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(projStartIdx + i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
    const band = proj.length ? `M ${x(projStartIdx).toFixed(1)} ${y(hist[hist.length - 1].v).toFixed(1)} ` +
      proj.map((p: any, i: number) => `L ${x(projStartIdx + 1 + i).toFixed(1)} ${y(p.high).toFixed(1)}`).join(' ') + ' ' +
      [...proj].reverse().map((p: any, i: number) => `L ${x(all.length - 1 - i).toFixed(1)} ${y(p.low).toFixed(1)}`).join(' ') +
      ` L ${x(projStartIdx).toFixed(1)} ${y(hist[hist.length - 1].v).toFixed(1)} Z` : '';
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 180 }}>
        {band && <path d={band} fill={G7} opacity={0.12} />}
        <path d={histLine} fill="none" stroke={OK} strokeWidth={2} />
        <path d={projLine} fill="none" stroke={G7} strokeWidth={2} strokeDasharray="5 4" />
        {all.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.v)} r={2.5} fill={(p as any).proj ? G7 : OK} />)}
        {all.map((p, i) => (i % Math.ceil(all.length / 8 || 1) === 0 || i === all.length - 1) ? <text key={'t' + i} x={x(i)} y={H - 6} fontSize={8} fill="var(--muted)" textAnchor="middle">{p.m.slice(2)}</text> : null)}
      </svg>
    );
  })();

  return (
    <div role="dialog" aria-label="Revenue Forecast" style={{ position: 'fixed', inset: 0, background: 'rgba(30,22,14,.42)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '5vh 16px', overflow: 'auto' }} onClick={onClose}>
      <div className="card" style={{ width: 'min(760px, 96vw)', padding: 18 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Revenue Forecast</h2>
          <button className="btn" style={{ padding: '2px 9px' }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        {err ? <div className="state" style={{ fontSize: 12, color: 'var(--danger)' }}>{err}</div>
          : !f ? <div className="state" style={{ fontSize: 12 }}>Loading…</div>
            : !f.available ? <div className="state" style={{ fontSize: 12 }}>{f.reason === 'insufficient_history' ? 'Not enough revenue history yet to project a trend — at least two months of records are required.' : 'Forecast is unavailable.'}</div>
              : (
                <>
                  <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>{f.methodology}. The shaded band is the ±1σ range around the projection.</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
                    <div className="panel" style={{ padding: 12 }}><div style={{ fontSize: 10, color: 'var(--muted)' }}>NEXT PERIOD ({f.nextPeriod?.month})</div><div style={{ fontSize: 20, fontWeight: 800, color: G7 }}>{money(f.nextPeriod?.projectedNetCents ?? 0)}</div></div>
                    <div className="panel" style={{ padding: 12 }}><div style={{ fontSize: 10, color: 'var(--muted)' }}>RANGE (±1σ)</div><div style={{ fontSize: 13, fontWeight: 700 }}>{money(f.nextPeriod?.lowCents ?? 0)} – {money(f.nextPeriod?.highCents ?? 0)}</div></div>
                    <div className="panel" style={{ padding: 12 }}><div style={{ fontSize: 10, color: 'var(--muted)' }}>MONTHLY TREND</div><div style={{ fontSize: 20, fontWeight: 800, color: (f.monthlyGrowthPct ?? 0) >= 0 ? OK : DANGER }}>{(f.monthlyGrowthPct ?? 0) >= 0 ? '+' : ''}{f.monthlyGrowthPct}%</div></div>
                  </div>
                  {chart}
                  <div style={{ display: 'flex', gap: 16, fontSize: 10, color: 'var(--muted)', margin: '2px 0 12px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, height: 2, background: OK, display: 'inline-block' }} />Actual net</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, height: 2, background: G7, display: 'inline-block' }} />Projected net</span>
                  </div>
                  {f.byProcessor && f.byProcessor.length > 0 && (
                    <>
                      <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--soft)', margin: '4px 0 6px' }}>Projected next period by processor</div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                        <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}><th style={{ padding: '4px' }}>Processor</th><th style={{ padding: '4px', textAlign: 'right' }}>Share</th><th style={{ padding: '4px', textAlign: 'right' }}>Projected Net</th></tr></thead>
                        <tbody>{f.byProcessor.map((p, i) => (
                          <tr key={i} style={{ borderTop: '1px solid var(--line)' }}>
                            <td style={{ padding: '4px', fontWeight: 600 }}>{p.processor}</td>
                            <td style={{ padding: '4px', textAlign: 'right' }}>{p.sharePct}%</td>
                            <td style={{ padding: '4px', textAlign: 'right', whiteSpace: 'nowrap' }}>{money(p.projectedNetCents)}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </>
                  )}
                </>
              )}
      </div>
    </div>
  );
}

function ExportJobsModal({ onClose }: { onClose: () => void }) {
  const [jobs, setJobs] = useState<ExportJob[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => listExportJobs().then((r) => setJobs(r.jobs)).catch(() => setJobs([]));
  useEffect(() => {
    load();
    const t = setInterval(() => { listExportJobs().then((r) => setJobs(r.jobs)).catch(() => undefined); }, 1500);
    return () => clearInterval(t);
  }, []);
  const pending = jobs?.some((j) => j.status === 'queued' || j.status === 'running');

  async function download(id: string) {
    setMsg(null);
    try { const r = await getExportJob(id); if (r.job && r.job.status === 'completed') { downloadExportJobResult(r.job); setMsg(`Downloaded ${r.job.filename}.`); } else setMsg('That job is not ready yet.'); }
    catch (e: any) { setMsg(e?.message ?? 'Download failed.'); }
  }
  const tone = (s: string) => s === 'completed' ? OK : s === 'failed' ? DANGER : s === 'running' ? INFO : WARN;
  return (
    <div role="dialog" aria-label="Background Export Jobs" style={{ position: 'fixed', inset: 0, background: 'rgba(30,22,14,.42)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '5vh 16px', overflow: 'auto' }} onClick={onClose}>
      <div className="card" style={{ width: 'min(720px, 96vw)', padding: 18 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Background Export Jobs</h2>
          <button className="btn" style={{ padding: '2px 9px' }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>Large exports run off the request path. This list refreshes automatically; completed jobs can be downloaded here.{pending ? ' A job is processing…' : ''}</div>
        {msg && <div className="panel" style={{ marginBottom: 12, fontSize: 12, border: '1px solid var(--ok)', background: 'color-mix(in srgb, var(--ok) 12%, transparent)' }}>{msg}</div>}
        {!jobs ? <div className="state" style={{ fontSize: 12 }}>Loading…</div>
          : jobs.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No export jobs yet.</div>
            : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}>{['Dataset', 'Format', 'Rows', 'Status', 'Created', ''].map((h, i) => <th key={i} style={{ padding: '5px 4px', fontWeight: 600 }}>{h}</th>)}</tr></thead>
                <tbody>{jobs.map((j) => (
                  <tr key={j.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: '5px 4px', fontWeight: 600 }}>{j.dataset}</td>
                    <td style={{ padding: '5px 4px', textTransform: 'uppercase' }}>{j.format}</td>
                    <td style={{ padding: '5px 4px' }}>{j.status === 'completed' ? j.rowCount : '—'}</td>
                    <td style={{ padding: '5px 4px' }}><span style={{ fontSize: 10, fontWeight: 700, color: tone(j.status), background: tone(j.status) + '18', borderRadius: 4, padding: '1px 6px' }}>{j.status}</span>{j.error ? <span style={{ color: DANGER, fontSize: 10, marginLeft: 6 }}>{j.error}</span> : null}</td>
                    <td style={{ padding: '5px 4px', whiteSpace: 'nowrap', color: 'var(--muted)' }}>{j.createdAt ? j.createdAt.replace('T', ' ') : '—'}</td>
                    <td style={{ padding: '5px 4px' }}>{j.status === 'completed' ? <button className="btn primary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => download(j.id)}>Download</button> : null}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
      </div>
    </div>
  );
}

function TrendChart({ data }: { data: { date: string; grossCents: number; netCents: number }[] }) {
  const W = 320, H = 120, pad = 6;
  const max = Math.max(1, ...data.map((d) => Math.max(d.grossCents, d.netCents)));
  const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, data.length - 1);
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  const line = (key: 'grossCents' | 'netCents') => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="120" role="img" aria-label="Revenue trend: gross and net revenue over the period">
      <path d={line('grossCents')} fill="none" stroke="var(--info)" strokeWidth="2" />
      <path d={line('netCents')} fill="none" stroke="var(--g7)" strokeWidth="2" />
      {data.map((d, i) => <g key={i}><circle cx={x(i)} cy={y(d.grossCents)} r="2.5" fill="var(--info)" /><circle cx={x(i)} cy={y(d.netCents)} r="2.5" fill="var(--g7)" /></g>)}
    </svg>
  );
}
