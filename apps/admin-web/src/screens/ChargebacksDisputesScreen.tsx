import { useEffect, useMemo, useRef, useState } from 'react';
import { disputesApi, type DisputeOverview, type DisputeListResult, type DisputeDetail } from '../api/superAdminApi';
import { Donut, money, dd } from './_chartkit';
import { ReviewDisputeModal, CollectEvidenceModal, UploadEvidenceModal } from './DisputeEvidenceModals';
import { SubmitEvidenceModal, NotifyTenantModal, RecordOutcomeModal, TrackDeadlinesModal, AnalyzePatternsModal, FlagRiskModal } from './DisputeActionModals';

// ChargebacksDisputesScreen — Super Admin → Payments & Revenue → Chargebacks & Disputes.
// 8 KPIs, two-row filters, tenant-boundary banner, disputes table + selected-details panel,
// ten Super Admin Actions, approaching deadlines, funds summary, dispute trend,
// reason-code + processor-decision donuts, recent activity, high-risk merchants, pagination.

const STATUS_LABEL: Record<string, string> = {
  open: 'Open', needs_evidence: 'Needs Evidence', evidence_collecting: 'Evidence Collecting', submitted: 'Submitted',
  under_review: 'Under Review', won: 'Won', lost: 'Lost', expired: 'Expired', withdrawn: 'Withdrawn', cancelled: 'Cancelled',
  reopened: 'Reopened', escalated: 'Escalated', closed: 'Closed', needs_response: 'Needs Response', refunded: 'Refunded',
};
const DECISION_LABEL: Record<string, string> = { none: 'None', under_review: 'Under Review', won: 'Won', lost: 'Lost', partially_won: 'Partially Won', reversed: 'Reversed', expired: 'Expired', withdrawn: 'Withdrawn', unknown: 'Unknown' };
const REASON_LABEL: Record<string, string> = {
  '10.4': '10.4 — Fraud — Card Absent', '10.5': '10.5 — Fraud — Card Present', '11.3': '11.3 — Cardholder Disagreement',
  '12.1': '12.1 — Cancellation', '12.2': '12.2 — Credit Not Processed', '13.1': '13.1 — Merchandise/Services Not Received', '13.2': '13.2 — Not as Described',
};

const statusTone = (s: string): [string, string] => {
  if (['won'].includes(s)) return ['#E7F5EC', '#1F9254'];
  if (['lost', 'expired'].includes(s)) return ['#FBE7E4', '#C0392B'];
  if (['open', 'needs_evidence', 'needs_response'].includes(s)) return ['#FBF0DC', '#B7791F'];
  if (['submitted'].includes(s)) return ['#EAF1FF', '#2F6FED'];
  if (['under_review', 'escalated', 'reopened'].includes(s)) return ['#F3ECFB', '#7C3AED'];
  return ['#F0EFF4', '#6B7280'];
};

const riskTone = (r: string): [string, string] =>
  r === 'critical' || r === 'high' ? ['#FBE7E4', '#C0392B'] : r === 'medium' ? ['#FBF0DC', '#B7791F'] : r === 'under_review' ? ['#F3ECFB', '#7C3AED'] : ['#E7F5EC', '#1F9254'];

function Badge({ text, tone }: { text: string; tone: [string, string] }) {
  return (
    <span style={{ background: tone[0], color: tone[1], padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, border: `1px solid ${tone[1]}30`, whiteSpace: 'nowrap' }}>
      {text}
    </span>
  );
}

const SUPER_ADMIN_ACTIONS = [
  'Review Disputes', 'Notify Tenants', 'Collect Supporting Evidence', 'Upload Receipts & Records',
  'Submit Evidence to the Processor', 'Track Deadlines', 'Record Outcomes', 'Analyze Dispute Patterns',
  'Flag High-Risk Merchants', 'Export Chargeback Reports',
];

function MultiLine({ series }: { series: { date: string; open: number; submitted: number; won: number; lost: number }[] }) {
  const W = 520, H = 140, pad = 8;
  if (series.length === 0) return <div className="state" style={{ padding: 16, textAlign: 'center', fontSize: 12 }}>No trend data.</div>;
  const keys = ['open', 'submitted', 'won', 'lost'] as const;
  const colors: Record<string, string> = { open: '#B7791F', submitted: '#2F6FED', won: '#1F9254', lost: '#C0392B' };
  const max = Math.max(1, ...series.flatMap((p) => keys.map((k) => p[k])));
  const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, series.length - 1);
  const y = (v: number) => H - pad - (v * (H - 2 * pad)) / max;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 140 }}>
        {keys.map((k) => (
          <polyline key={k} fill="none" stroke={colors[k]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" points={series.map((p, i) => `${x(i)},${y(p[k])}`).join(' ')} />
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--muted)', marginTop: 4, justifyContent: 'center' }}>
        {keys.map((k) => (
          <span key={k} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <span style={{ width: 10, height: 4, background: colors[k], borderRadius: 2 }} />
            {k[0].toUpperCase() + k.slice(1)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function ChargebacksDisputesScreen() {
  const [ov, setOv] = useState<DisputeOverview | null>(null);
  const [ovErr, setOvErr] = useState<string | null>(null);
  const [list, setList] = useState<DisputeListResult | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<DisputeDetail | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [modal, setModal] = useState<null | 'review' | 'collect' | 'upload' | 'submit' | 'notify' | 'outcome' | 'deadlines' | 'patterns' | 'flag'>(null);

  // filters
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [currentStatus, setCurrentStatus] = useState('');
  const [processorDecision, setProcessorDecision] = useState('');
  const [riskLevel, setRiskLevel] = useState('');
  const [deadlineStart, setDeadlineStart] = useState('');
  const [deadlineEnd, setDeadlineEnd] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [applied, setApplied] = useState(0);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [hiddenPanels, setHiddenPanels] = useState<Set<string>>(new Set());
  const [widgetMenu, setWidgetMenu] = useState(false);
  const [exporting, setExporting] = useState(false);

  const currentFilters = () => ({
    ...(debounced ? { search: debounced } : {}), ...(tenantId ? { tenantId } : {}), ...(branchId ? { branchId } : {}),
    ...(reasonCode ? { reasonCode } : {}), ...(currentStatus ? { currentStatus } : {}), ...(processorDecision ? { processorDecision } : {}),
    ...(riskLevel ? { riskLevel } : {}), ...(deadlineStart ? { deadlineStart } : {}), ...(deadlineEnd ? { deadlineEnd } : {}),
  });

  const doExport = async () => {
    setExporting(true); setNotice(null);
    try {
      const { filename, csv } = await disputesApi.exportCsv(currentFilters());
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      setNotice(`Exported ${filename} with the current filters (audited, no card or evidence data).`);
    } catch (e: any) { setNotice(e?.message || 'Export failed'); }
    finally { setExporting(false); }
  };

  const togglePanel = (k: string) => setHiddenPanels((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const debTimer = useRef<any>(null);
  useEffect(() => { clearTimeout(debTimer.current); debTimer.current = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(debTimer.current); }, [search]);

  const loadOverview = () => { setOvErr(null); disputesApi.overview().then((d) => setOv(d as DisputeOverview)).catch((e: any) => setOvErr(e?.message || 'Failed to load overview')); };
  useEffect(() => { loadOverview(); }, []);

  const query = useMemo(() => ({
    page, pageSize,
    ...(debounced ? { search: debounced } : {}), ...(tenantId ? { tenantId } : {}), ...(branchId ? { branchId } : {}),
    ...(reasonCode ? { reasonCode } : {}), ...(currentStatus ? { currentStatus } : {}), ...(processorDecision ? { processorDecision } : {}),
    ...(riskLevel ? { riskLevel } : {}), ...(deadlineStart ? { deadlineStart } : {}), ...(deadlineEnd ? { deadlineEnd } : {}),
  }), [page, pageSize, debounced, tenantId, branchId, reasonCode, currentStatus, processorDecision, riskLevel, deadlineStart, deadlineEnd, applied]);

  useEffect(() => {
    let live = true; setListErr(null);
    disputesApi.list(query).then((d) => { if (live) { setList(d as DisputeListResult); setLastRefreshed(new Date()); } }).catch((e: any) => { if (live) setListErr(e?.message || 'Failed to load disputes'); });
    return () => { live = false; };
  }, [query]);

  const openDispute = async (ref: string) => {
    try { const d = await disputesApi.detail(ref); setSelected(d as DisputeDetail); setPanelOpen(true); }
    catch (e: any) { setNotice(e?.message || 'Failed to load dispute'); }
  };

  const resetFilters = () => { setSearch(''); setDebounced(''); setTenantId(''); setBranchId(''); setReasonCode(''); setCurrentStatus(''); setProcessorDecision(''); setRiskLevel(''); setDeadlineStart(''); setDeadlineEnd(''); setPage(1); setApplied((a) => a + 1); };
  const tenants = useMemo(() => { const m = new Map<string, string>(); (ov?.highRiskMerchants ?? []).forEach((r) => m.set(r.tenantId, r.tenantName)); (list?.rows ?? []).forEach((r) => m.set(r.tenantId, r.tenantName)); return [...m.entries()]; }, [ov, list]);

  const k = ov?.kpis;
  const kpiCards = [
    { l: 'Total Open Disputes', v: k ? String(k.totalOpenDisputes) : '—', t: '+12.4% vs last week', icon: '⚖️', tone: '#B7791F', bg: '#FBF0DC', onClick: () => { setCurrentStatus(''); setNotice('Filtered to open disputes.'); } },
    { l: 'Dispute Amount at Risk', v: k ? money(k.amountAtRiskCents) : '—', t: 'Active exposure', icon: '💸', tone: '#7C3AED', bg: '#F3ECFB', onClick: () => setNotice('Active dispute exposure.') },
    { l: 'Response Deadlines This Week', v: k ? String(k.responseDeadlinesThisWeek) : '—', t: 'Due within 7 days', icon: '⏳', tone: '#2F6FED', bg: '#EAF1FF', onClick: () => setNotice('See Approaching Deadlines.') },
    { l: 'Evidence Submitted', v: k ? String(k.evidenceSubmitted) : '—', t: 'Submitted / accepted', icon: '📁', tone: '#1F9254', bg: '#E7F5EC', onClick: () => { setProcessorDecision(''); setNotice('Disputes with evidence submitted.'); } },
    { l: 'Won Disputes', v: k ? String(k.wonDisputes) : '—', t: 'Processor won', icon: '✓', tone: '#1F9254', bg: '#E7F5EC', onClick: () => { setCurrentStatus('won'); setPage(1); } },
    { l: 'Lost Disputes', v: k ? String(k.lostDisputes) : '—', t: 'Processor lost', icon: '✕', tone: '#C0392B', bg: '#FBE7E4', onClick: () => { setCurrentStatus('lost'); setPage(1); } },
    { l: 'Funds Withdrawn', v: k ? money(k.fundsWithdrawnCents) : '—', t: 'By processor', icon: '📉', tone: '#C0392B', bg: '#FBE7E4', onClick: () => setNotice('Funds-withdrawn reporting.') },
    { l: 'Funds Recovered', v: k ? money(k.fundsRecoveredCents) : '—', t: 'Recovered', icon: '📈', tone: '#1F9254', bg: '#E7F5EC', onClick: () => setNotice('Recovered-funds reporting.') },
  ];

  const totalPages = list ? Math.max(1, Math.ceil(list.total / pageSize)) : 1;
  const fs = ov?.fundsSummary;

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflowY: 'auto' }}>
      {/* HEADER BAR */}
      <div className="vh" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            Chargebacks &amp; Disputes <span style={{ color: 'var(--gold, #A96F22)' }}>★</span>
          </h1>
          <div className="sub" style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
            Manages payment disputes and evidence workflows.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', position: 'relative' }}>
          <button className="btn ghost" disabled={exporting} onClick={doExport} style={{ fontWeight: 700 }}>
            {exporting ? 'Exporting…' : 'Export Report'}
          </button>
          <button className="btn" onClick={() => setWidgetMenu((v) => !v)} style={{ fontWeight: 800 }}>
            + Add Widget
          </button>
          {widgetMenu && (
            <div className="panel" style={{ position: 'absolute', top: 42, right: 0, zIndex: 30, width: 240, background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 12, padding: 12, boxShadow: '0 8px 30px rgba(0,0,0,0.12)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>Show / hide panels</div>
              {[['trend', 'Dispute Trend'], ['reason', 'Disputes by Reason Code'], ['processor', 'Processor Decision Breakdown'], ['activity', 'Recent Dispute Activity'], ['highrisk', 'High-Risk Merchants']].map(([k, label]) => (
                <label key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, padding: '3px 0', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!hiddenPanels.has(k)} onChange={() => togglePanel(k)} /> {label}
                </label>
              ))}
              <button className="btn sm" style={{ height: 26, width: '100%', marginTop: 8 }} onClick={() => setWidgetMenu(false)}>Done</button>
            </div>
          )}
        </div>
      </div>

      {notice && (
        <div style={{ padding: '9px 14px', borderRadius: 10, background: '#FFF9EF', color: '#8B5A18', border: '1px solid #E2C686', fontSize: 12.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>ℹ️ {notice}</span>
          <button className="btn ghost sm" style={{ height: 24, padding: '0 8px' }} onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {/* 8 LUXURY KPI CARDS */}
      {ovErr ? (
        <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 20, textAlign: 'center' }}>
          Couldn’t load KPIs. <button className="btn ghost" onClick={loadOverview}>Retry</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          {kpiCards.map((c) => (
            <button
              key={c.l}
              onClick={c.onClick}
              title={c.l}
              style={{
                textAlign: 'left',
                background: '#FFFDF8',
                border: '1px solid var(--line)',
                borderRadius: 14,
                padding: '12px 14px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)',
                minWidth: 0,
                height: '100%',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <span style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.l}
                </span>
                <span style={{ width: 26, height: 26, borderRadius: 7, background: c.bg, color: c.tone, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700, flex: 'none' }}>
                  {c.icon}
                </span>
              </div>
              <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 20, fontWeight: 700, color: 'var(--text)', marginTop: 6, lineHeight: 1.2 }}>
                {c.v}
              </div>
              <div style={{ fontSize: 10.5, color: c.tone, marginTop: 4, fontWeight: 600 }}>
                {c.t}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* FILTER BAR + SELECTED DISPUTE DETAILS */}
      <div
        className={`grid grid-cols-1 ${selected
            ? 'xl:grid-cols-[minmax(0,1fr)_350px]'
            : 'xl:grid-cols-[minmax(0,1fr)_320px]'
          } gap-4 items-start`}
      >
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Search Disputes</label>
              <input placeholder="Search by ID, transaction, email..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ ...INPUT, height: 36 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Tenant</label>
              <select value={tenantId} onChange={(e) => { setTenantId(e.target.value); setPage(1); }} style={{ ...INPUT, height: 36 }}>
                <option value="">All Tenants</option>
                {tenants.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Branch</label>
              <select value={branchId} onChange={(e) => { setBranchId(e.target.value); setPage(1); }} style={{ ...INPUT, height: 36 }}>
                <option value="">All Branches</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Reason Code</label>
              <select value={reasonCode} onChange={(e) => { setReasonCode(e.target.value); setPage(1); }} style={{ ...INPUT, height: 36 }}>
                <option value="">All Reason Codes</option>
                {Object.entries(REASON_LABEL).map(([c, l]) => <option key={c} value={c}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Current Status</label>
              <select value={currentStatus} onChange={(e) => { setCurrentStatus(e.target.value); setPage(1); }} style={{ ...INPUT, height: 36 }}>
                <option value="">All Statuses</option>
                {Object.entries(STATUS_LABEL).map(([c, l]) => <option key={c} value={c}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Processor Decision</label>
              <select value={processorDecision} onChange={(e) => { setProcessorDecision(e.target.value); setPage(1); }} style={{ ...INPUT, height: 36 }}>
                <option value="">All Decisions</option>
                {Object.entries(DECISION_LABEL).map(([c, l]) => <option key={c} value={c}>{l}</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap w-full whitespace-nowrap gap-2.5 items-end">
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Response Deadline</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="date" value={deadlineStart} onChange={(e) => setDeadlineStart(e.target.value)} style={{ ...INPUT, height: 36 }} />
                <input type="date" value={deadlineEnd} onChange={(e) => setDeadlineEnd(e.target.value)} style={{ ...INPUT, height: 36 }} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Risk Level</label>
              <select value={riskLevel} onChange={(e) => { setRiskLevel(e.target.value); setPage(1); }} style={{ ...INPUT, height: 36 }}>
                <option value="">All Risk Levels</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
                <option value="under_review">Under Review</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn ghost !min-h-[38px] !h-8 flex items-center self-end" onClick={resetFilters} >Reset Filters</button>
              <button className="btn !min-h-[38px] !h-8 flex items-center self-end" onClick={() => { setPage(1); setApplied((a) => a + 1); }} style={{ flex: 1, fontWeight: 800 }}>Apply Filters</button>
            </div>
          </div>

          {/* Tenant boundary banner */}
          <div role="note" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 14px', borderRadius: 10, background: '#EAF1FF', border: '1px solid #BFD8F2', color: '#2F6FED', fontSize: 12.5 }}>
            <span aria-hidden style={{ fontWeight: 700, fontSize: 14 }}>ⓘ</span>
            <span><strong>Tenant boundary:</strong> Tenants should only see their own disputes. Platform risk administrators may see aggregated dispute information.</span>
          </div>

          {/* Disputes table */}
          <div style={{ overflowX: 'auto', width: '100%', marginTop: 4 }}>
            {listErr ? (
              <div className="state" style={{ padding: 24, textAlign: 'center' }}>
                Couldn’t load disputes. <button className="btn ghost" onClick={() => setApplied((a) => a + 1)}>Retry</button>
              </div>
            ) : !list ? (
              <div className="state" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>Loading disputes…</div>
            ) : list.rows.length === 0 ? (
              <div className="state" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No disputes match these filters.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 960 }}>
                <thead>
                  <tr style={{ background: '#FFFBF2', borderBottom: '1px solid var(--line)', textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    <th style={{ width: 28, padding: '12px 8px' }}></th>
                    <th style={{ padding: '12px 10px', fontWeight: 700 }}>Dispute ID</th>
                    <th style={{ padding: '12px 10px', fontWeight: 700 }}>Amount</th>
                    <th style={{ padding: '12px 10px', fontWeight: 700 }}>Reason</th>
                    <th style={{ padding: '12px 10px', fontWeight: 700 }}>Tenant</th>
                    <th style={{ padding: '12px 10px', fontWeight: 700 }}>Branch</th>
                    <th style={{ padding: '12px 10px', fontWeight: 700 }}>Transaction</th>
                    <th style={{ padding: '12px 10px', fontWeight: 700 }}>Deadline</th>
                    <th style={{ padding: '12px 10px', fontWeight: 700 }}>Status</th>
                    <th style={{ padding: '12px 10px', fontWeight: 700 }}>Evid.</th>
                    <th style={{ padding: '12px 10px', fontWeight: 700 }}>Decision</th>
                    <th style={{ padding: '12px 10px', fontWeight: 700 }}>Withdrawn</th>
                    <th style={{ padding: '12px 10px', fontWeight: 700 }}>Recovered</th>
                    <th style={{ padding: '12px 8px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((r, idx) => {
                    const isSel = selected?.disputeReference === r.disputeReference;
                    const overdue = r.dueBy && new Date(r.dueBy).getTime() < Date.now();
                    return (
                      <tr
                        key={r.disputeReference}
                        onClick={() => openDispute(r.disputeReference)}
                        style={{
                          borderBottom: '1px solid var(--line)',
                          background: isSel ? '#FFF3E9' : idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF',
                          cursor: 'pointer',
                          transition: 'background 0.15s ease',
                        }}
                        onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = '#FFF9EF'; }}
                        onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF'; }}
                      >
                        <td style={{ textAlign: 'center', padding: '12px 8px' }}>
                          <input type="radio" readOnly checked={isSel} aria-label={`Select ${r.disputeReference}`} />
                        </td>
                        <td style={{ padding: '12px 10px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5, background: '#FFF9EF', border: '1px solid #E2C686', padding: '2px 6px', borderRadius: 6, color: '#8B5A18' }}>
                            {r.disputeReference}
                          </span>
                        </td>
                        <td style={{ padding: '12px 10px', fontWeight: 800, color: 'var(--text)' }}>{money(r.amountCents)}</td>
                        <td style={{ padding: '12px 10px', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={REASON_LABEL[r.reasonCode ?? ''] ?? r.reason ?? ''}>
                          {r.reasonCode ?? '—'}
                        </td>
                        <td style={{ padding: '12px 10px', whiteSpace: 'nowrap', fontWeight: 600 }}>🏪 {r.tenantName}</td>
                        <td style={{ padding: '12px 10px', whiteSpace: 'nowrap', color: 'var(--muted)' }}>{r.branchName ?? '—'}</td>
                        <td style={{ padding: '12px 10px', fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--muted)' }}>{r.transactionRef ?? '—'}</td>
                        <td style={{ padding: '12px 10px', whiteSpace: 'nowrap', fontWeight: overdue ? 700 : 400, color: overdue ? '#C0392B' : 'inherit' }}>{dd(r.dueBy)}</td>
                        <td style={{ padding: '12px 10px' }}><Badge text={STATUS_LABEL[r.status] ?? r.status} tone={statusTone(r.status)} /></td>
                        <td style={{ padding: '12px 10px' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: ['submitted', 'accepted'].includes(r.evidenceStatus) ? '#1F9254' : '#6B7280' }}>
                            {['submitted', 'accepted'].includes(r.evidenceStatus) ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 10px', whiteSpace: 'nowrap' }}>{r.processorDecision === 'none' ? '—' : DECISION_LABEL[r.processorDecision] ?? r.processorDecision}</td>
                        <td style={{ padding: '12px 10px', color: '#C0392B', fontWeight: 600 }}>{money(r.fundsWithdrawnCents)}</td>
                        <td style={{ padding: '12px 10px', color: '#1F9254', fontWeight: 600 }}>{money(r.fundsRecoveredCents)}</td>
                        <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                          <button className="btn ghost sm" style={{ height: 26, padding: '0 8px' }} onClick={(e) => { e.stopPropagation(); openDispute(r.disputeReference); }}>⋯</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {list && list.total > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
              <span>Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, list.total)} of {list.total} disputes{lastRefreshed ? ` · updated ${lastRefreshed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}` : ''}</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button className="btn ghost sm" style={{ height: 28 }} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                <span>Page {page} / {totalPages}</span>
                <button className="btn ghost sm" style={{ height: 28 }} disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
                <select value={pageSize} onChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }} style={{ ...INPUT, height: 28, width: 64, padding: '0 6px', fontSize: 11.5 }}>
                  {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
          )}
        </section>

        {/* Selected Dispute Details Panel */}
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}>Selected Dispute Details</h2>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn ghost sm !w-10" style={{ minHeight: 24, padding: '0 6px' }} onClick={() => setPanelOpen((v) => !v)} aria-label="Expand">⤢</button>
              <button className="btn ghost sm !w-10" style={{ height: 24, padding: '0 6px' }} onClick={() => setSelected(null)} aria-label="Close">✕</button>
            </div>
          </div>

          {!selected ? (
            <div className="state" style={{ padding: 24, textAlign: 'center', fontSize: 12.5, color: 'var(--muted)' }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>👆</div>
              Select a dispute to see details.
            </div>
          ) : panelOpen && (
            <div style={{ display: 'grid', gap: 6, fontSize: 12 }}>
              {([
                ['Dispute ID', selected.disputeReference], ['Dispute Amount', `${money(selected.amountCents)} ${selected.currency}`],
                ['Reason Code', REASON_LABEL[selected.reasonCode ?? ''] ?? selected.reason ?? '—'], ['Tenant', selected.tenantName],
                ['Branch', selected.branchName ?? '—'], ['Transaction Reference', selected.transactionRef ?? '—'],
              ] as [string, string][]).map(([l, v]) => <Row key={l} l={l} v={v} />)}
              <Row l="Response Deadline" v={dd(selected.dueBy)} danger={!!selected.dueBy && new Date(selected.dueBy).getTime() < Date.now() + 3 * 86400000} />
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--line)' }}><span style={{ color: 'var(--muted)' }}>Current Status</span><Badge text={STATUS_LABEL[selected.status] ?? selected.status} tone={statusTone(selected.status)} /></div>
              <Row l="Evidence Submitted" v={['submitted', 'accepted'].includes(selected.evidenceStatus) ? 'Yes' : 'No'} />
              <Row l="Processor Decision" v={selected.processorDecision === 'none' ? '—' : DECISION_LABEL[selected.processorDecision] ?? selected.processorDecision} />
              <Row l="Funds Withdrawn" v={money(selected.fundsWithdrawnCents)} />
              <Row l="Funds Recovered" v={money(selected.fundsRecoveredCents)} />
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--line)' }}><span style={{ color: 'var(--muted)' }}>Risk Level</span><Badge text={selected.riskLevel[0].toUpperCase() + selected.riskLevel.slice(1)} tone={riskTone(selected.riskLevel)} /></div>
              <Row l="Notes" v={selected.notes ?? '—'} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, fontSize: 11.5 }}>
                {selected.transactionRef && <a className="linklike" href={`/payments-transactions?ref=${encodeURIComponent(selected.transactionRef)}`}>Open transaction ↗</a>}
                <a className="linklike" href={`/payment-gateways?tenant=${encodeURIComponent(selected.tenantId)}`}>Open merchant account ↗</a>
                {selected.fundsEvents.some((f) => f.settlementId) && <a className="linklike" href={`/settlements?tenant=${encodeURIComponent(selected.tenantId)}`}>Open settlement ↗</a>}
              </div>
              {selected.fundsEvents.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 11, background: '#FFF9EF', padding: 8, borderRadius: 8, border: '1px solid #E2C686' }}>
                  <span style={{ fontWeight: 700, color: '#8B5A18' }}>Funds events:</span> {selected.fundsEvents.map((f, i) => <span key={i}>{f.kind} {money(f.amountCents)}{i < selected.fundsEvents.length - 1 ? ' · ' : ''}</span>)}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* SUPER ADMIN ACTIONS PANEL */}
      <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Super Admin Actions</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
          {SUPER_ADMIN_ACTIONS.map((a) => {
            const needsSel = ['Review Disputes', 'Collect Supporting Evidence', 'Upload Receipts & Records', 'Submit Evidence to the Processor', 'Notify Tenants', 'Record Outcomes'].includes(a);
            const onClick = () => {
              if (a === 'Track Deadlines') return setModal('deadlines');
              if (a === 'Analyze Dispute Patterns') return setModal('patterns');
              if (a === 'Flag High-Risk Merchants') return setModal('flag');
              if (a === 'Export Chargeback Reports') return doExport();
              if (needsSel && !selected) { setNotice('Select a dispute in the table first, then choose this action.'); return; }
              if (a === 'Review Disputes') return setModal('review');
              if (a === 'Collect Supporting Evidence') return setModal('collect');
              if (a === 'Upload Receipts & Records') return setModal('upload');
              if (a === 'Submit Evidence to the Processor') return setModal('submit');
              if (a === 'Notify Tenants') return setModal('notify');
              if (a === 'Record Outcomes') return setModal('outcome');
              setNotice(`"${a}" workflow is wired in an upcoming unit.`);
            };
            return (
              <button
                key={a}
                className="btn ghost sm"
                style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11.5, height: 'auto', minHeight: 36, lineHeight: 1.25 }}
                onClick={onClick}
              >
                {a}
              </button>
            );
          })}
        </div>
      </section>

      {/* ANALYTICS + RIGHT RAIL MODULES */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start pb-6">
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            {!hiddenPanels.has('trend') && (
              <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
                <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Dispute Trend</h2>
                <MultiLine series={ov?.trend ?? []} />
              </div>
            )}
            {!hiddenPanels.has('reason') && (
              <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
                <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Disputes by Reason Code</h2>
                <Donut data={(ov?.reasonDistribution ?? []).map((r) => ({ label: r.code, value: r.count }))} centerLabel={`${ov?.counts.total ?? 0} Total`} />
              </div>
            )}
            {!hiddenPanels.has('processor') && (
              <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
                <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Processor Decision Breakdown</h2>
                <Donut data={ov ? [{ label: 'Won', value: ov.processorDecisionBreakdown.won }, { label: 'Under Review', value: ov.processorDecisionBreakdown.underReview }, { label: 'Lost', value: ov.processorDecisionBreakdown.lost }] : []} centerLabel={`${ov?.processorDecisionBreakdown.total ?? 0} Total`} />
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
            {!hiddenPanels.has('activity') && (
              <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
                <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Recent Dispute Activity</h2>
                <div style={{ display: 'grid', gap: 6 }}>
                  {(ov?.recentActivity ?? []).map((a, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5, padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                      <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{new Date(a.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                      <span style={{ flex: 1 }}>{a.action} — <button className="linklike" onClick={() => openDispute(a.disputeRef)}>{a.disputeRef}</button></span>
                      <Badge text={STATUS_LABEL[a.status] ?? a.status} tone={statusTone(a.status)} />
                    </div>
                  ))}
                  {(ov?.recentActivity ?? []).length === 0 && <div className="state" style={{ padding: 16, textAlign: 'center', fontSize: 12 }}>No recent activity.</div>}
                </div>
              </div>
            )}

            {!hiddenPanels.has('highrisk') && (
              <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
                <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>High-Risk Merchants</h2>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, marginTop: 4 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5, borderBottom: '1px solid var(--line)' }}>
                      <th style={{ padding: '6px 4px' }}>Tenant</th>
                      <th style={{ padding: '6px 4px' }}>Open</th>
                      <th style={{ padding: '6px 4px' }}>At Risk</th>
                      <th style={{ padding: '6px 4px' }}>Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ov?.highRiskMerchants ?? []).map((r) => (
                      <tr key={r.tenantId} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '6px 4px', fontWeight: 600 }}>{r.tenantName}</td>
                        <td style={{ padding: '6px 4px' }}>{r.openDisputes}</td>
                        <td style={{ padding: '6px 4px', fontWeight: 700 }}>{money(r.amountAtRiskCents)}</td>
                        <td style={{ padding: '6px 4px' }}><Badge text={r.riskLevel[0].toUpperCase() + r.riskLevel.slice(1)} tone={riskTone(r.riskLevel)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="linklike" style={{ marginTop: 8, fontSize: 12 }} onClick={() => setModal('flag')}>View All High-Risk Merchants</button>
              </div>
            )}
          </div>
        </div>

        {/* Right Rail Modules */}
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Approaching Deadlines</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5, borderBottom: '1px solid var(--line)' }}>
                  <th style={{ padding: '6px 4px' }}>Dispute</th>
                  <th style={{ padding: '6px 4px' }}>Days</th>
                  <th style={{ padding: '6px 4px' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {(ov?.approachingDeadlines ?? []).map((d) => (
                  <tr key={d.disputeRef} onClick={() => openDispute(d.disputeRef)} style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer' }}>
                    <td style={{ padding: '6px 4px', fontWeight: 700 }}>{d.disputeRef}</td>
                    <td style={{ padding: '6px 4px', color: d.daysLeft <= 2 ? '#C0392B' : '#B7791F', fontWeight: 700 }}>{d.daysLeft}d</td>
                    <td style={{ padding: '6px 4px', fontWeight: 700 }}>{money(d.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(ov?.approachingDeadlines ?? []).length === 0 && <div className="state" style={{ padding: 16, textAlign: 'center', fontSize: 12 }}>None in the next 7 days.</div>}
            <button className="linklike" style={{ marginTop: 8, fontSize: 12 }} onClick={() => setModal('deadlines')}>View All Approaching Deadlines</button>
          </div>

          <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Funds Summary</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Metric l="Funds Withdrawn" v={fs ? money(fs.fundsWithdrawnCents) : '—'} />
              <Metric l="Funds Recovered" v={fs ? money(fs.fundsRecoveredCents) : '—'} good />
              <Metric l="Net Lost" v={fs ? money(fs.netLostCents) : '—'} />
              <Metric l="Recovery Rate" v={fs ? `${fs.recoveryRatePct.toFixed(2)}%` : '—'} good />
            </div>
          </div>
        </div>
      </div>

      {modal === 'deadlines' && <TrackDeadlinesModal onClose={() => setModal(null)} onOpenDispute={(ref) => { setModal(null); openDispute(ref); }} />}
      {modal === 'patterns' && <AnalyzePatternsModal onClose={() => setModal(null)} />}
      {modal === 'flag' && <FlagRiskModal onClose={() => setModal(null)} onChanged={() => { loadOverview(); }} />}

      {modal && modal !== 'deadlines' && selected && (() => {
        const refresh = () => { loadOverview(); setApplied((a) => a + 1); disputesApi.detail(selected.disputeReference).then((d) => setSelected(d as DisputeDetail)).catch(() => { }); };
        const close = () => setModal(null);
        if (modal === 'review') return <ReviewDisputeModal disputeRef={selected.disputeReference} onClose={close} onChanged={refresh} />;
        if (modal === 'collect') return <CollectEvidenceModal disputeRef={selected.disputeReference} onClose={close} onChanged={refresh} />;
        if (modal === 'upload') return <UploadEvidenceModal disputeRef={selected.disputeReference} onClose={close} onChanged={refresh} />;
        if (modal === 'submit') return <SubmitEvidenceModal disputeRef={selected.disputeReference} onClose={close} onChanged={refresh} />;
        if (modal === 'notify') return <NotifyTenantModal disputeRef={selected.disputeReference} tenantName={selected.tenantName} onClose={close} onChanged={refresh} />;
        return <RecordOutcomeModal dispute={selected} onClose={close} onChanged={refresh} />;
      })()}
    </div>
  );
}

function Row({ l, v, danger }: { l: string; v: string; danger?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
      <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>{l}</span>
      <span style={{ textAlign: 'right', color: danger ? '#C0392B' : 'inherit', fontWeight: danger ? 700 : 500 }}>{v}</span>
    </div>
  );
}

function Metric({ l, v, good }: { l: string; v: string; good?: boolean }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, background: '#FFFBF2' }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700 }}>{l}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: good ? '#1F9254' : 'var(--text)', marginTop: 4 }}>{v}</div>
    </div>
  );
}

const INPUT: React.CSSProperties = {
  width: '100%',
  height: 36,
  padding: '0 10px',
  border: '1px solid var(--line)',
  borderRadius: 8,
  fontSize: 12.5,
  background: '#FFFFFF',
  color: 'var(--text)',
  boxSizing: 'border-box',
};
