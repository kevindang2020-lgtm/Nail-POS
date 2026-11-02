// MerchantAccountsScreen.tsx — Super Admin → Payments & Revenue → Merchant Accounts (Overview).
// Platform-level onboarding, configuration, risk, and processor oversight for each tenant's payment-processing account.
// Bound 1:1 to the live aggregate at /super-admin/merchant-accounts/overview — every value is real or honestly marked
// unavailable ("—" / available:false). Only Fiserv/CardPointe/Clover are surfaced. Sensitive funding data is masked and
// never revealed here. This is oversight + controlled, permissioned, audited writes — never checkout.
// Kept SEPARATE from Settlements & Deposits.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  superAdminMerchantAccountsApi,
  type MAOverview,
  type MAKpi,
  type MASegment,
  type MAConfigureRatesResult,
  type MAStatusResult,
  type MAFundingUpdateResult,
  type MAMidAssignResult,
  type MATerminalAssignResult,
} from '../api/superAdminMerchantAccountsApi';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

const MA_REFRESH_MS = 25_000;

const SEMANTIC: Record<string, string> = { good: '#1F9254', warn: '#B7791F', bad: '#C0392B', neutral: '#6B7280' };
const PROC_COLOR: Record<string, string> = { fiserv: '#E07B39', cardpointe: '#3C7FB6', clover: '#3E8F57', other: '#6B7280' };


const KPI_EMOJI: Record<string, { icon: string; bg: string; fg: string }> = {
  total: { icon: '🏢', bg: '#EAF1FF', fg: '#2F6FED' },
  active: { icon: '✓', bg: '#E7F5EC', fg: '#1F9254' },
  pending_underwriting: { icon: '⏳', bg: '#FBF0DC', fg: '#B7791F' },
  bank_verification_pending: { icon: '🏦', bg: '#F3ECFB', fg: '#7C3AED' },
  high_risk: { icon: '⚠️', bg: '#FBE7E4', fg: '#C0392B' },
  assigned_terminals: { icon: '📟', bg: '#EAF1FF', fg: '#2F6FED' },
  funding_issues: { icon: '💵', bg: '#FBF0DC', fg: '#B7791F' },
  inactive: { icon: '⊘', bg: '#EEF0F3', fg: '#6B7280' },
};

const PROCESSOR_OPTS = [['all', 'All Processors'], ['fiserv', 'Fiserv'], ['cardpointe', 'CardPointe'], ['clover', 'Clover']];
const UNDERWRITING_OPTS = [['all', 'All Underwriting'], ['not_started', 'Not Started'], ['submitted', 'Submitted'], ['under_review', 'In Review'], ['approved', 'Approved'], ['declined', 'Declined']];
const PROCESSING_OPTS = [['all', 'All Processing'], ['active', 'Active'], ['pending', 'Pending'], ['error', 'Suspended'], ['disabled', 'Inactive']];
const RISK_OPTS = [['all', 'All Risk Levels'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
const FUNDING_OPTS = [['all', 'All Funding Schedules'], ['next_day', 'Next Day'], ['daily', 'Daily'], ['weekly', 'Weekly']];


function Badge({ label, semantic, muted }: { label: string; semantic?: string; muted?: boolean }) {
  const c = muted ? SEMANTIC.neutral : (SEMANTIC[semantic || 'neutral'] || SEMANTIC.neutral);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: c, background: `${c}15`, border: `1px solid ${c}30`, whiteSpace: 'nowrap' }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: c }} />
      {label}
    </span>
  );
}

function KpiCard({ k, onClick }: { k: MAKpi; onClick: () => void }) {
  const cfg = KPI_EMOJI[k.key] || { icon: '📊', bg: '#FFF9EF', fg: '#A96F22' };
  const clickable = k.available && !!k.href;
  return (
    <button
      onClick={clickable ? onClick : undefined}
      aria-label={`${k.label}: ${k.display}`}
      disabled={!clickable}
      style={{
        textAlign: 'left',
        background: '#FFFDF8',
        border: '1px solid var(--line)',
        borderRadius: 14,
        padding: '12px 14px',
        cursor: clickable ? 'pointer' : 'default',
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
          {k.label}
        </span>
        <span style={{ width: 26, height: 26, borderRadius: 7, background: cfg.bg, color: cfg.fg, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700, flex: 'none' }}>
          {cfg.icon}
        </span>
      </div>
      <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 20, fontWeight: 700, color: k.available ? 'var(--text)' : '#B4A88E', marginTop: 6, lineHeight: 1.2 }}>
        {k.display}
      </div>
      <div style={{ fontSize: 10.5, color: k.available ? (SEMANTIC[k.semantic] || 'var(--muted)') : '#B4A88E', marginTop: 4, fontWeight: 600 }}>
        {k.available ? 'View' : 'Not yet provisioned'}
      </div>
    </button>
  );
}

function Donut({ segments, total, colors, onSlice }: { segments: MASegment[]; total: number; colors: Record<string, string>; onSlice?: (key: string) => void }) {
  const R = 52, C = 2 * Math.PI * R; let acc = 0;
  const shown = segments.filter((s) => s.count > 0);
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
      <svg width={120} height={120} viewBox="0 0 128 128" role="img" aria-label={`Total ${total}`}>
        <circle cx="64" cy="64" r={R} fill="none" stroke="var(--line)" strokeWidth="16" />
        {shown.map((s) => {
          const frac = total > 0 ? s.count / total : 0; const dash = frac * C;
          const el = <circle key={s.key} cx="64" cy="64" r={R} fill="none" stroke={colors[s.key] || SEMANTIC.neutral} strokeWidth="16"
            strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} transform="rotate(-90 64 64)"
            style={{ cursor: onSlice ? 'pointer' : 'default' }} onClick={onSlice ? () => onSlice(s.key) : undefined} />;
          acc += dash; return el;
        })}
        <text x="64" y="60" textAnchor="middle" fontSize="22" fontWeight="800" fill="var(--text)">{total}</text>
        <text x="64" y="78" textAnchor="middle" fontSize="10" fill="var(--muted)">Total</text>
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        {shown.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>No data yet.</div> : shown.map((s) => (
          <div key={s.key} onClick={onSlice ? () => onSlice(s.key) : undefined} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, marginBottom: 5, cursor: onSlice ? 'pointer' : 'default' }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: colors[s.key] || SEMANTIC.neutral, flex: '0 0 auto' }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
            <span style={{ fontWeight: 700 }}>{s.count}</span>
            <span style={{ color: 'var(--muted)', width: 46, textAlign: 'right' }}>{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--line)', fontSize: 12 }}>
      <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>{label}</span>
      <span style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text)', wordBreak: 'break-all', maxWidth: '62%' }}>{children}</span>
    </div>
  );
}

const SUPER_ADMIN_ACTIONS = [
  'Start merchant onboarding', 'Review merchant documents', 'Submit merchant information', 'Activate or deactivate processing',
  'Track underwriting', 'Update funding information', 'Assign an MID to a branch', 'Assign terminals',
  'Configure processing rates', 'Review merchant-account errors', 'Manage processor connections',
];

export default function MerchantAccountsScreen() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [data, setData] = useState<MAOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [stale, setStale] = useState(false);
  const [actionModal, setActionModal] = useState<string | null>(null);
  const [ratesForm, setRatesForm] = useState<{ tenantId: string; merchantId: string } | null>(null);
  const [ratesFields, setRatesFields] = useState({ pct: '', fee: '', effectiveAt: '', reason: '' });
  const [ratesBusy, setRatesBusy] = useState(false);
  const [ratesErr, setRatesErr] = useState<string | null>(null);
  const [ratesResult, setRatesResult] = useState<MAConfigureRatesResult | null>(null);
  const [statusForm, setStatusForm] = useState<{ tenantId: string; merchantId: string; current: string } | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [statusResult, setStatusResult] = useState<MAStatusResult | null>(null);
  const [fundForm, setFundForm] = useState<{ tenantId: string; merchantId: string } | null>(null);
  const [fundFields, setFundFields] = useState({ accountNumber: '', routingNumber: '', bankName: '', accountType: 'checking', reason: '', stepUp: false });
  const [fundBusy, setFundBusy] = useState(false);
  const [fundErr, setFundErr] = useState<string | null>(null);
  const [fundResult, setFundResult] = useState<MAFundingUpdateResult | null>(null);
  const [midForm, setMidForm] = useState<{ tenantId: string; merchantId: string } | null>(null);
  const [midFields, setMidFields] = useState({ merchantId: '', branchId: '', reason: '' });
  const [midBusy, setMidBusy] = useState(false);
  const [midErr, setMidErr] = useState<string | null>(null);
  const [midResult, setMidResult] = useState<MAMidAssignResult | null>(null);
  const [termForm, setTermForm] = useState<{ tenantId: string; merchantId: string } | null>(null);
  const [termFields, setTermFields] = useState({ terminalId: '', branchId: '', reason: '' });
  const [termBusy, setTermBusy] = useState(false);
  const [termErr, setTermErr] = useState<string | null>(null);
  const [termResult, setTermResult] = useState<MATerminalAssignResult | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const inFlight = useRef(false);

  const filters = useMemo(() => ({
    search: sp.get('q') || '', processor: sp.get('processor') || 'all', underwritingStatus: sp.get('underwritingStatus') || 'all',
    processingStatus: sp.get('processingStatus') || 'all', riskStatus: sp.get('riskStatus') || 'all', fundingSchedule: sp.get('fundingSchedule') || 'all',
    selected: sp.get('selected') || '',
  }), [sp]);
  const [searchDraft, setSearchDraft] = useState(filters.search);
  useEffect(() => { setSearchDraft(filters.search); }, [filters.search]);

  const setF = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v && v !== 'all') n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const resetFilters = () => { const n = new URLSearchParams(sp); ['q', 'processor', 'underwritingStatus', 'processingStatus', 'riskStatus', 'fundingSchedule'].forEach((k) => n.delete(k)); setSp(n, { replace: true }); };

  const load = useCallback((signal: AbortSignal, background = false) => {
    if (background && inFlight.current) return;
    inFlight.current = true;
    if (!background) { setLoading(true); setError(null); }
    superAdminMerchantAccountsApi.overview({
      search: filters.search || undefined, processor: filters.processor, underwritingStatus: filters.underwritingStatus,
      processingStatus: filters.processingStatus, riskStatus: filters.riskStatus, fundingSchedule: filters.fundingSchedule,
      selected: filters.selected || undefined,
    }).then((d) => { if (!signal.aborted) { setData(d); setError(null); setLastUpdated(new Date()); setStale(false); if (!background) setLoading(false); } })
      .catch((e: unknown) => { if (signal.aborted) return; if (background) setStale(true); else { setError(e instanceof Error ? e.message : 'Failed to load'); setLoading(false); } })
      .finally(() => { inFlight.current = false; });
  }, [filters]);
  useEffect(() => { const ac = new AbortController(); load(ac.signal); return () => ac.abort(); }, [load]);
  useAutoRefresh((signal) => load(signal, true), MA_REFRESH_MS);

  const selectRow = (tenantId: string) => { const n = new URLSearchParams(sp); n.set('selected', tenantId); setSp(n, { replace: true }); };
  const closeDetails = () => { const n = new URLSearchParams(sp); n.delete('selected'); setSp(n, { replace: true }); };

  const onAction = (label: string) => {
    if (label === 'Manage processor connections') { nav('/payment-gateways'); return; }
    if (label === 'Track underwriting') { setF('underwritingStatus', 'under_review'); return; }
    if (label === 'Configure processing rates') {
      if (sel) { setRatesFields({ pct: '', fee: '', effectiveAt: '', reason: '' }); setRatesErr(null); setRatesResult(null); setRatesForm({ tenantId: sel.tenantId, merchantId: sel.merchantId }); }
      else setActionModal('Select a merchant account first');
      return;
    }
    if (label === 'Activate or deactivate processing') {
      if (sel) { setStatusReason(''); setStatusErr(null); setStatusResult(null); setStatusForm({ tenantId: sel.tenantId, merchantId: sel.merchantId, current: sel.processingStatus }); }
      else setActionModal('Select a merchant account first');
      return;
    }
    if (label === 'Update funding information') {
      if (sel) { setFundFields({ accountNumber: '', routingNumber: '', bankName: '', accountType: 'checking', reason: '', stepUp: false }); setFundErr(null); setFundResult(null); setFundForm({ tenantId: sel.tenantId, merchantId: sel.merchantId }); }
      else setActionModal('Select a merchant account first');
      return;
    }
    if (label === 'Assign an MID to a branch') {
      if (sel) { setMidFields({ merchantId: sel.merchantId !== '—' ? sel.merchantId : '', branchId: '', reason: '' }); setMidErr(null); setMidResult(null); setMidForm({ tenantId: sel.tenantId, merchantId: sel.merchantId }); }
      else setActionModal('Select a merchant account first');
      return;
    }
    if (label === 'Assign terminals') {
      if (sel) { setTermFields({ terminalId: '', branchId: '', reason: '' }); setTermErr(null); setTermResult(null); setTermForm({ tenantId: sel.tenantId, merchantId: sel.merchantId }); }
      else setActionModal('Select a merchant account first');
      return;
    }
    setActionModal(label);
  };

  const submitTerminal = () => {
    if (!termForm) return;
    if (!termFields.terminalId.trim() || !termFields.branchId.trim()) { setTermErr('Terminal ID and branch ID are required.'); return; }
    if (!termFields.reason.trim()) { setTermErr('A reason is required.'); return; }
    setTermBusy(true); setTermErr(null);
    superAdminMerchantAccountsApi.assignTerminal(termForm.tenantId, { terminalId: termFields.terminalId.trim(), branchId: termFields.branchId.trim(), reason: termFields.reason.trim() })
      .then((r) => { setTermResult(r); const ac = new AbortController(); load(ac.signal); })
      .catch((e: unknown) => setTermErr(e instanceof Error ? e.message : 'Terminal assignment failed'))
      .finally(() => setTermBusy(false));
  };

  const submitMid = () => {
    if (!midForm) return;
    if (!/^[A-Za-z0-9-]{3,40}$/.test(midFields.merchantId.trim())) { setMidErr('Enter a valid MID (3–40 chars: letters, digits, hyphens).'); return; }
    if (!midFields.reason.trim()) { setMidErr('A reason is required.'); return; }
    setMidBusy(true); setMidErr(null);
    superAdminMerchantAccountsApi.assignMid(midForm.tenantId, { merchantId: midFields.merchantId.trim(), branchId: midFields.branchId.trim() || undefined, reason: midFields.reason.trim() })
      .then((r) => { setMidResult(r); const ac = new AbortController(); load(ac.signal); })
      .catch((e: unknown) => setMidErr(e instanceof Error ? e.message : 'MID assignment failed'))
      .finally(() => setMidBusy(false));
  };

  const submitFunding = () => {
    if (!fundForm) return;
    if (!fundFields.stepUp) { setFundErr('Confirm step-up authentication to proceed.'); return; }
    if (!/^\d{4,17}$/.test(fundFields.accountNumber.replace(/\D/g, ''))) { setFundErr('Enter a valid account number.'); return; }
    if (fundFields.routingNumber.replace(/\D/g, '').length !== 9) { setFundErr('Routing number must be 9 digits.'); return; }
    if (!fundFields.reason.trim()) { setFundErr('A reason is required.'); return; }
    setFundBusy(true); setFundErr(null);
    superAdminMerchantAccountsApi.updateFunding(fundForm.tenantId, {
      stepUpConfirmed: true, accountNumber: fundFields.accountNumber, routingNumber: fundFields.routingNumber,
      bankName: fundFields.bankName.trim() || undefined, accountType: fundFields.accountType, reason: fundFields.reason.trim(),
    }).then((r) => { setFundResult(r); const ac = new AbortController(); load(ac.signal); })
      .catch((e: unknown) => setFundErr(e instanceof Error ? e.message : 'Funding update failed'))
      .finally(() => setFundBusy(false));
  };

  const submitStatus = (action: 'activate' | 'deactivate') => {
    if (!statusForm) return;
    if (!statusReason.trim()) { setStatusErr('A reason is required.'); return; }
    setStatusBusy(true); setStatusErr(null);
    const call = action === 'activate' ? superAdminMerchantAccountsApi.activate : superAdminMerchantAccountsApi.deactivate;
    call(statusForm.tenantId, statusReason.trim())
      .then((r) => { setStatusResult(r); const ac = new AbortController(); load(ac.signal); })
      .catch((e: unknown) => setStatusErr(e instanceof Error ? e.message : 'Action failed'))
      .finally(() => setStatusBusy(false));
  };

  const submitRates = () => {
    if (!ratesForm) return;
    const pctNum = parseFloat(ratesFields.pct); const feeNum = parseFloat(ratesFields.fee || '0');
    if (!isFinite(pctNum) || pctNum < 0) { setRatesErr('Enter a valid percentage rate.'); return; }
    if (!ratesFields.reason.trim()) { setRatesErr('A change reason is required.'); return; }
    setRatesBusy(true); setRatesErr(null);
    superAdminMerchantAccountsApi.configureRates(ratesForm.tenantId, {
      percentageBasisPoints: Math.round(pctNum * 100),
      perTxnFeeMinor: Math.round((isFinite(feeNum) ? feeNum : 0) * 100),
      effectiveAt: ratesFields.effectiveAt ? new Date(ratesFields.effectiveAt).toISOString() : undefined,
      changeReason: ratesFields.reason.trim(),
    }).then((r) => { setRatesResult(r); const ac = new AbortController(); load(ac.signal); })
      .catch((e: unknown) => setRatesErr(e instanceof Error ? e.message : 'Failed to configure rates'))
      .finally(() => setRatesBusy(false));
  };

  const runExport = () => {
    setExportBusy(true);
    superAdminMerchantAccountsApi.exportReport({
      search: filters.search || undefined, processor: filters.processor, underwritingStatus: filters.underwritingStatus,
      processingStatus: filters.processingStatus, riskStatus: filters.riskStatus, fundingSchedule: filters.fundingSchedule,
    }).then((r) => {
      const blob = new Blob([r.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = r.filename; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    }).catch((e: unknown) => setActionModal(e instanceof Error ? `Export failed: ${e.message}` : 'Export failed'))
      .finally(() => setExportBusy(false));
  };

  const sel = data?.selectedMerchant || null;

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflowY: 'auto' }}>
      {/* HEADER BAR */}
      <div className="vh" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            Merchant Accounts
          </h1>
          <div className="sub" style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
            Manages payment-processing accounts for each tenant and branch.
          </div>
          <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 5, fontSize: 11.5, color: stale ? '#B8860B' : '#7A9E86' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: stale ? '#D09A36' : '#3E8F57', display: 'inline-block' }} />
            {stale
              ? <span>Reconnecting — showing last known data{lastUpdated ? ` from ${lastUpdated.toLocaleTimeString()}` : ''}.</span>
              : <span>{lastUpdated ? `Live · updated ${lastUpdated.toLocaleTimeString()}` : 'Live'} · auto-refresh {MA_REFRESH_MS / 1000}s</span>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={runExport} disabled={exportBusy} className="btn ghost" style={{ fontWeight: 700 }}>
            {exportBusy ? 'Exporting…' : 'Export Report'}
          </button>
          <button onClick={() => onAction('Start merchant onboarding')} className="btn" style={{ fontWeight: 800 }}>
            + Add Merchant Account
          </button>
        </div>
      </div>

      {error && !data ? (
        <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 24, textAlign: 'center' }}>
          <div style={{ color: SEMANTIC.bad, fontWeight: 700, marginBottom: 8, fontSize: 15 }}>Couldn’t load Merchant Accounts</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>{error}</div>
          <button className="btn" onClick={() => { const ac = new AbortController(); load(ac.signal); }}>Retry</button>
        </div>
      ) : (
        <>
          {/* 8 LUXURY KPI CARDS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            {loading && !data ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{ height: 80, borderRadius: 14, background: '#FFFDF8', border: '1px solid var(--line)' }} />
            )) : (data?.kpis || []).map((k) => <KpiCard key={k.key} k={k} onClick={() => k.href && nav(k.href)} />)}
          </div>

          {/* FILTER BAR PANEL */}
          <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              <input
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') setF('q', searchDraft.trim()); }}
                placeholder="Search merchant accounts..."
                aria-label="Search merchant accounts"
                style={{ ...SELECT, height: 38, padding: '0 12px', fontSize: 13 }}
              />
              <select value="all" disabled aria-label="Tenant" style={{ ...SELECT, height: 38, opacity: 0.7 }}><option>All Tenants</option></select>
              <select value="all" disabled aria-label="Branch" style={{ ...SELECT, height: 38, opacity: 0.7 }}><option>All Branches</option></select>
              <select value={filters.processor} onChange={(e) => setF('processor', e.target.value)} aria-label="Processor" style={{ ...SELECT, height: 38 }}>
                {PROCESSOR_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select value={filters.underwritingStatus} onChange={(e) => setF('underwritingStatus', e.target.value)} aria-label="Underwriting Status" style={{ ...SELECT, height: 38 }}>
                {UNDERWRITING_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select value={filters.processingStatus} onChange={(e) => setF('processingStatus', e.target.value)} aria-label="Processing Status" style={{ ...SELECT, height: 38 }}>
                {PROCESSING_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignItems: 'center' }}>
              <select value={filters.riskStatus} onChange={(e) => setF('riskStatus', e.target.value)} aria-label="Risk Status" style={{ ...SELECT, height: 38 }}>
                {RISK_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select value={filters.fundingSchedule} onChange={(e) => setF('fundingSchedule', e.target.value)} aria-label="Funding Schedule" style={{ ...SELECT, height: 38 }}>
                {FUNDING_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 8, gridColumn: 'span 2' }}>
                <button className="btn ghost" onClick={resetFilters} style={{ height: 38, flex: 1, padding: '0 12px' }}>
                  Reset Filters
                </button>
                <button className="btn" onClick={() => setF('q', searchDraft.trim())} style={{ height: 38, flex: 1, padding: '0 12px', fontWeight: 800 }}>
                  Apply Filters
                </button>
              </div>
            </div>
          </section>

          {/* MAIN: DIRECTORY TABLE + RIGHT RAIL */}
            <div
              className={`grid grid-cols-1 ${sel
                  ? 'lg:grid-cols-[minmax(0,1fr)_350px]'
                  : 'lg:grid-cols-[minmax(0,1fr)_320px]'
                } gap-4 items-start`}
            >
            {/* Table Panel */}
            <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 0, overflow: 'hidden', boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', display: 'flex', flexDirection: 'column' }}>
              <div className="hd" style={{ background: '#FFF9EF', padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                  <span>{data ? data.merchantsTotal : 0} Merchant Accounts</span>
                </h2>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  Select an account row to view underwriting details.
                </div>
              </div>

              <div style={{ overflowX: 'auto', width: '100%' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 1050 }}>
                  <thead>
                    <tr style={{ background: '#FFFBF2', borderBottom: '1px solid var(--line)', textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {['Merchant ID', 'Processor', 'Tenant', 'Branch', 'Legal Business Name', 'Processing', 'Underwriting', 'Bank Verif.', 'Pricing', 'Rates', 'Terminals', 'Application', 'Risk', 'Funding'].map((h) => (
                        <th key={h} style={{ padding: '12px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loading && !data ? (
                      <tr><td colSpan={14} style={{ padding: 36, textAlign: 'center', color: 'var(--muted)' }}>Loading merchant accounts…</td></tr>
                    ) : (data?.merchants.length ? data.merchants.map((m, idx) => {
                      const on = m.tenantId === filters.selected;
                      return (
                        <tr
                          key={m.tenantId}
                          onClick={() => selectRow(m.tenantId)}
                          style={{
                            cursor: 'pointer',
                            borderBottom: '1px solid var(--line)',
                            background: on ? '#FFF3E9' : idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF',
                            transition: 'background 0.15s ease',
                          }}
                          onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = '#FFF9EF'; }}
                          onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF'; }}
                        >
                          <td style={{ padding: '12px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                            <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5, background: '#FFF9EF', border: '1px solid #E2C686', padding: '2px 6px', borderRadius: 6, color: '#8B5A18' }}>
                              {m.merchantId}
                            </span>
                          </td>
                          <td style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>
                            <span style={{ color: PROC_COLOR[m.processor] || SEMANTIC.neutral, fontWeight: 700 }}>
                              {m.processorLabel}
                            </span>
                          </td>
                          <td style={{ padding: '12px 12px', whiteSpace: 'nowrap', fontWeight: 700, color: 'var(--text)' }}>
                            🏪 {m.tenant}
                          </td>
                          <td style={{ padding: '12px 12px', whiteSpace: 'nowrap', color: 'var(--muted)' }}>
                            {m.branch}
                          </td>
                          <td style={{ padding: '12px 12px', whiteSpace: 'nowrap', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 }} title={m.legalBusinessName}>
                            {m.legalBusinessName}
                          </td>
                          <td style={{ padding: '12px 12px' }}><Badge label={m.processingStatusLabel} semantic={m.processingSemantic} /></td>
                          <td style={{ padding: '12px 12px' }}><Badge label={m.underwritingStatusLabel} semantic={m.underwritingSemantic} /></td>
                          <td style={{ padding: '12px 12px' }}>{m.bankVerificationAvailable ? <Badge label={m.bankVerificationLabel} semantic={m.bankVerificationSemantic} /> : <span style={{ color: '#B4A88E' }}>—</span>}</td>
                          <td style={{ padding: '12px 12px' }}>{m.pricingPlanAvailable ? m.pricingPlan : <span style={{ color: '#B4A88E' }}>—</span>}</td>
                          <td style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>{m.processingRatesAvailable ? m.processingRates : <span style={{ color: '#B4A88E' }}>—</span>}</td>
                          <td style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>
                            <span className="pill" style={{ fontSize: 11 }}>{m.terminalAssignments} terminal{m.terminalAssignments === 1 ? '' : 's'}</span>
                          </td>
                          <td style={{ padding: '12px 12px' }}><Badge label={m.applicationStatusLabel} muted /></td>
                          <td style={{ padding: '12px 12px' }}>{m.riskStatusAvailable ? <Badge label={m.riskStatusLabel} /> : <span style={{ color: '#B4A88E' }}>—</span>}</td>
                          <td style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>{m.fundingScheduleAvailable ? m.fundingScheduleLabel : <span style={{ color: '#B4A88E' }}>—</span>}</td>
                        </tr>
                      );
                    }) : (
                      <tr><td colSpan={14} style={{ padding: 36, textAlign: 'center', color: 'var(--muted)' }}>No merchant accounts match these filters.</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: '#FFF9EF', borderTop: '1px solid var(--line)', fontSize: 12, color: 'var(--muted)' }}>
                <span>Showing <strong>{data && data.merchants.length ? 1 : 0}</strong> to <strong>{data ? data.merchants.length : 0}</strong> of <strong>{data ? data.merchantsTotal : 0}</strong> entries</span>
                <button className="btn ghost sm" onClick={() => nav('/merchant-accounts')} style={{ padding: '4px 12px', height: 30 }}>
                  View full directory
                </button>
              </div>
            </section>

            {/* Right Rail: Selected Details + Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {sel ? (
                <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 12 }}>
                    <span style={{ fontWeight: 800, fontSize: 14.5, color: 'var(--text)' }}>{sel.merchantId}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Badge label={sel.processingStatusLabel} semantic={sel.processingSemantic} />
                      <button aria-label="Close details" onClick={closeDetails} className="btn ghost sm" style={{ padding: '2px 8px', minHeight: 24 }}>
                        ✕
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <DetailRow label="Processor"><span style={{ color: PROC_COLOR[sel.processor], fontWeight: 700 }}>{sel.processorLabel}</span></DetailRow>
                    <DetailRow label="Tenant">{sel.tenant}</DetailRow>
                    <DetailRow label="Branch">{sel.branch}</DetailRow>
                    <DetailRow label="Legal Business Name">{sel.legalBusinessName}</DetailRow>
                    <DetailRow label="Underwriting Status"><Badge label={sel.underwritingStatusLabel} semantic={sel.underwritingSemantic} /></DetailRow>
                    <DetailRow label="Bank Verification">{sel.bankVerificationAvailable ? <Badge label={sel.bankVerificationLabel} semantic={sel.bankVerificationSemantic} /> : '—'}</DetailRow>
                    <DetailRow label="Pricing Plan">{sel.pricingPlanAvailable ? sel.pricingPlan : '—'}</DetailRow>
                    <DetailRow label="Processing Rates">{sel.processingRatesAvailable ? sel.processingRates : '—'}</DetailRow>
                    <DetailRow label="Terminal Assignments">{sel.terminalAssignments} terminal{sel.terminalAssignments === 1 ? '' : 's'}</DetailRow>
                    <DetailRow label="Application Status">{sel.applicationStatusLabel}</DetailRow>
                    <DetailRow label="Risk Status">{sel.riskStatusAvailable ? sel.riskStatusLabel : '—'}</DetailRow>
                    <DetailRow label="Funding Schedule">{sel.fundingScheduleAvailable ? sel.fundingScheduleLabel : '—'}</DetailRow>

                    {/* Secure Funding Information */}
                    <div style={{ marginTop: 12, border: '1px solid #E2C686', borderRadius: 10, padding: 12, background: '#FFF9EF' }}>
                      <div style={{ fontWeight: 800, fontSize: 12.5, color: '#A96F22', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>🔒</span> Secure Funding Information
                      </div>
                      {sel.funding.available ? (
                        <>
                          <DetailRow label="Bank Account">{sel.funding.bankAccount}</DetailRow>
                          <DetailRow label="Bank Name">{sel.funding.bankName}</DetailRow>
                          <DetailRow label="Account Type">{sel.funding.accountType}</DetailRow>
                        </>
                      ) : (
                        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Funding information is not configured for this merchant.</div>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.4 }}>{sel.funding.note}</div>
                    </div>
                  </div>
                </section>
              ) : (
                <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 20, textAlign: 'center', fontSize: 12.5, color: 'var(--muted)' }}>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>👆</div>
                  Select a merchant account from the directory to view its details and secure funding information.
                </section>
              )}

              {/* Super Admin Actions */}
              <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
                <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Super Admin Actions</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {SUPER_ADMIN_ACTIONS.map((a) => (
                    <button
                      key={a}
                      onClick={() => onAction(a)}
                      className="btn ghost sm"
                      style={{ textAlign: 'left', padding: '6px 10px', fontSize: 11.5, height: 'auto', minHeight: 34, lineHeight: 1.2 }}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </div>

          {/* LOWER ANALYSIS MODULES */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, alignItems: 'stretch' }}>
            <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, height: 285, overflowY: 'auto', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)', display: 'flex', flexDirection: 'column' }}>
              <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, flex: '0 0 auto' }}>Processor Distribution</h2>
              <div style={{ flex: 1, minHeight: 0 }}>
                <Donut
                  segments={data?.processorDistribution.segments || []}
                  total={data?.processorDistribution.total || 0}
                  colors={PROC_COLOR}
                  onSlice={(p) => setF('processor', p)}
                />
              </div>
            </section>

            <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, height: 285, overflowY: 'auto', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)', display: 'flex', flexDirection: 'column' }}>
              <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, flex: '0 0 auto' }}>Underwriting Pipeline</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0, overflowY: 'auto' }}>
                {(data?.underwritingPipeline.stages || []).map((s) => (
                  <div key={s.key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span>{s.label}</span>
                      <span style={{ fontWeight: 700 }}>{s.count}</span>
                    </div>
                    <div style={{ width: '100%', height: 6, background: '#F1E6D4', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, Math.max(0, s.count * 25))}%`, height: '100%', background: 'var(--grad, linear-gradient(180deg, #F2D892, #D7A646))' }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, height: 285, overflowY: 'auto', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)', display: 'flex', flexDirection: 'column' }}>
              <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, flex: '0 0 auto' }}>Merchant Status Breakdown</h2>
              <div style={{ flex: 1, minHeight: 0 }}>
                <Donut
                  segments={data?.merchantStatusBreakdown.segments || []}
                  total={data?.merchantStatusBreakdown.total || 0}
                  colors={{ active: '#3E8F57', pending: '#D09A36', inactive: '#6B7280' }}
                />
              </div>
            </section>

            <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, height: 285, overflowY: 'auto', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)', display: 'flex', flexDirection: 'column' }}>
              <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, flex: '0 0 auto' }}>Terminal Assignment Overview</h2>
              <div style={{ flex: 1, minHeight: 0 }}>
                <Donut
                  segments={data?.terminalAssignmentOverview.segments || []}
                  total={data?.terminalAssignmentOverview.total || 0}
                  colors={{ assigned: '#3C7FB6', unassigned: '#D09A36' }}
                />
              </div>
            </section>

            <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, height: 285, overflowY: 'auto', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flex: '0 0 auto' }}>
                <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Merchant Account Alerts</h2>
                {data?.alerts?.available && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger,#B85B4D)', background: '#FBE7E4', padding: '2px 8px', borderRadius: 999 }}>{data.alerts.total}</span>}
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                {data?.alerts?.available && data.alerts.items.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {data.alerts.items.map((it: any) => (
                      <div key={it.id || it.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                        <span style={{ color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.summary || it.title || it.label}</span>
                        <span style={{ fontWeight: 700, flex: '0 0 auto', marginLeft: 8, color: it.severity === 'critical' ? 'var(--danger,#B85B4D)' : 'var(--warn,#D09A36)' }}>{it.severityLabel || it.severity || ''}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="state" style={{ padding: 16, textAlign: 'center', fontSize: 12 }}>No open alerts.</div>
                )}
              </div>
            </section>

            <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, height: 285, overflowY: 'auto', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)', display: 'flex', flexDirection: 'column' }}>
              <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, flex: '0 0 auto' }}>Top Funding Issues</h2>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                {data?.topFundingIssues?.available && data.topFundingIssues.items.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {data.topFundingIssues.items.map((it: any) => (
                      <div key={it.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                        <span style={{ color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>
                        <span style={{ fontWeight: 700, flex: '0 0 auto', marginLeft: 8, color: 'var(--danger,#B85B4D)' }}>{it.count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="state" style={{ padding: 16, textAlign: 'center', fontSize: 12 }}>No funding issues.</div>
                )}
              </div>
            </section>

            <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, height: 285, overflowY: 'auto', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flex: '0 0 auto' }}>
                <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>High Risk Accounts</h2>
                {data?.highRiskAccounts?.available && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger,#B85B4D)', background: '#FBE7E4', padding: '2px 8px', borderRadius: 999 }}>{data.highRiskAccounts.total}</span>}
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                {data?.highRiskAccounts?.available ? (
                  data.highRiskAccounts.items.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {data.highRiskAccounts.items.map((it: any) => (
                        <div key={it.merchantId || it.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', overflow: 'hidden' }}>
                            <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, background: '#FFF9EF', border: '1px solid #E2C686', padding: '1px 4px', borderRadius: 4, color: '#8B5A18', whiteSpace: 'nowrap' }}>{it.merchantId}</span>
                            <span style={{ color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.tenant}</span>
                          </div>
                          <span style={{ fontWeight: 700, flex: '0 0 auto', marginLeft: 8 }}>{it.revenueRisk ? 'Rev. Risk' : 'High Risk'}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="state" style={{ padding: 16, textAlign: 'center', fontSize: 12 }}>No high risk accounts.</div>
                  )
                ) : (
                  <div className="state" style={{ padding: 16, textAlign: 'center', fontSize: 12 }}>Risk data not connected.</div>
                )}
              </div>
            </section>
          </div>
        </>
      )}

      {/* RATES MODAL */}
      {ratesForm && (
        <div role="dialog" aria-label="Configure Processing Rates" onClick={() => setRatesForm(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20, 16, 10, 0.65)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ background: '#FFFDF8', borderRadius: 14, padding: 20, width: 460, maxWidth: '92vw', boxShadow: '0 24px 70px rgba(0,0,0,0.45)', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Configure Processing Rates</h2>
              <button className="btn ghost sm" aria-label="Close" onClick={() => setRatesForm(null)}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{ratesForm.merchantId} — a new effective-dated schedule is appended; prior rates are preserved.</div>
            {ratesResult ? (
              <div>
                <div style={{ fontSize: 13, color: '#1F9254', fontWeight: 700, marginBottom: 8 }}>{ratesResult.idempotent ? 'No change — identical schedule already exists.' : 'Rate schedule saved.'}</div>
                <DetailRow label="Previous">{ratesResult.before?.display || '—'}</DetailRow>
                <DetailRow label="New">{ratesResult.after.display}</DetailRow>
                <DetailRow label="Effective">{new Date(ratesResult.effectiveAt).toLocaleDateString()}</DetailRow>
                <div style={{ marginTop: 14, textAlign: 'right' }}><button className="btn" onClick={() => setRatesForm(null)}>Done</button></div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ fontSize: 12, color: 'var(--muted)' }}>Percentage rate (%)<input aria-label="Percentage rate" value={ratesFields.pct} onChange={(e) => setRatesFields((f) => ({ ...f, pct: e.target.value }))} inputMode="decimal" placeholder="2.49" style={{ ...SELECT, height: 36, width: '100%', marginTop: 4 }} /></label>
                <label style={{ fontSize: 12, color: 'var(--muted)' }}>Per-transaction fee ($)<input aria-label="Per-transaction fee" value={ratesFields.fee} onChange={(e) => setRatesFields((f) => ({ ...f, fee: e.target.value }))} inputMode="decimal" placeholder="0.15" style={{ ...SELECT, height: 36, width: '100%', marginTop: 4 }} /></label>
                <label style={{ fontSize: 12, color: 'var(--muted)' }}>Effective date (optional)<input aria-label="Effective date" type="date" value={ratesFields.effectiveAt} onChange={(e) => setRatesFields((f) => ({ ...f, effectiveAt: e.target.value }))} style={{ ...SELECT, height: 36, width: '100%', marginTop: 4 }} /></label>
                <label style={{ fontSize: 12, color: 'var(--muted)' }}>Change reason (required)<input aria-label="Change reason" value={ratesFields.reason} onChange={(e) => setRatesFields((f) => ({ ...f, reason: e.target.value }))} placeholder="e.g. Renewal pricing" style={{ ...SELECT, height: 36, width: '100%', marginTop: 4 }} /></label>
                {ratesErr && <div style={{ fontSize: 12, color: SEMANTIC.bad }}>{ratesErr}</div>}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                  <button className="btn ghost" onClick={() => setRatesForm(null)}>Cancel</button>
                  <button className="btn" onClick={submitRates} disabled={ratesBusy}>{ratesBusy ? 'Saving…' : 'Save rate schedule'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* STATUS MODAL */}
      {statusForm && (
        <div role="dialog" aria-label="Activate or Deactivate Processing" onClick={() => setStatusForm(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20, 16, 10, 0.65)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ background: '#FFFDF8', borderRadius: 14, padding: 20, width: 460, maxWidth: '92vw', boxShadow: '0 24px 70px rgba(0,0,0,0.45)', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Activate or Deactivate Processing</h2>
              <button className="btn ghost sm" aria-label="Close" onClick={() => setStatusForm(null)}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{statusForm.merchantId} — changes are audit-logged and take effect immediately.</div>
            {statusResult ? (
              <div>
                {statusResult.blocked ? (
                  <div>
                    <div style={{ fontSize: 13, color: '#B85B4D', fontWeight: 700, marginBottom: 8 }}>Activation blocked — resolve these first:</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {(statusResult.requirements || []).map((req) => (
                        <div key={req.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                          <span style={{ color: req.met ? '#1F9254' : '#B85B4D', fontWeight: 700 }}>{req.met ? '✓' : '✕'}</span>
                          <span>{req.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: '#1F9254', fontWeight: 700, marginBottom: 8 }}>
                    Processing {statusResult.action === 'deactivate' ? 'deactivated' : 'activated'}.
                  </div>
                )}
                <div style={{ marginTop: 14, textAlign: 'right' }}><button className="btn" onClick={() => setStatusForm(null)}>Done</button></div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ fontSize: 12, color: 'var(--muted)' }}>Status reason<input aria-label="Status reason" value={statusReason} onChange={(e) => setStatusReason(e.target.value)} placeholder="e.g. Risk review / Seasonal activation" style={{ ...SELECT, height: 36, width: '100%', marginTop: 4 }} /></label>
                {statusErr && <div style={{ fontSize: 12, color: SEMANTIC.bad }}>{statusErr}</div>}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                  <button className="btn ghost" onClick={() => setStatusForm(null)}>Cancel</button>
                  <button className="btn ghost" onClick={() => submitStatus('deactivate')} disabled={statusBusy}>{statusBusy ? 'Updating…' : 'Deactivate'}</button>
                  <button className="btn" onClick={() => submitStatus('activate')} disabled={statusBusy}>{statusBusy ? 'Updating…' : 'Activate'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* FUNDING MODAL */}
      {fundForm && (
        <div role="dialog" aria-label="Update Funding Information" onClick={() => setFundForm(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20, 16, 10, 0.65)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ background: '#FFFDF8', borderRadius: 14, padding: 20, width: 480, maxWidth: '92vw', boxShadow: '0 24px 70px rgba(0,0,0,0.45)', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Update Funding Information</h2>
              <button className="btn ghost sm" aria-label="Close" onClick={() => setFundForm(null)}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{fundForm.merchantId} — sensitive banking data is encrypted and masked on write.</div>
            {fundResult ? (
              <div>
                <div style={{ fontSize: 13, color: '#1F9254', fontWeight: 700, marginBottom: 8 }}>Funding updated — re-verification pending.</div>
                <DetailRow label="Bank Account">{fundResult.after?.bankAccount || (fundResult as any)?.funding?.bankAccount || '—'}</DetailRow>
                <DetailRow label="Bank Name">{fundResult.after?.bankName || (fundResult as any)?.funding?.bankName || '—'}</DetailRow>
                <div style={{ marginTop: 14, textAlign: 'right' }}><button className="btn" onClick={() => setFundForm(null)}>Done</button></div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ fontSize: 12, color: 'var(--muted)' }}>Account number<input aria-label="Account number" value={fundFields.accountNumber} onChange={(e) => setFundFields((f) => ({ ...f, accountNumber: e.target.value }))} placeholder="••••••••••••" style={{ ...SELECT, height: 36, width: '100%', marginTop: 4 }} /></label>
                <label style={{ fontSize: 12, color: 'var(--muted)' }}>Routing number<input aria-label="Routing number" value={fundFields.routingNumber} onChange={(e) => setFundFields((f) => ({ ...f, routingNumber: e.target.value }))} placeholder="123456789" style={{ ...SELECT, height: 36, width: '100%', marginTop: 4 }} /></label>
                <label style={{ fontSize: 12, color: 'var(--muted)' }}>Bank Name (optional)<input aria-label="Bank Name" value={fundFields.bankName} onChange={(e) => setFundFields((f) => ({ ...f, bankName: e.target.value }))} placeholder="e.g. Chase Bank" style={{ ...SELECT, height: 36, width: '100%', marginTop: 4 }} /></label>
                <label style={{ fontSize: 12, color: 'var(--muted)' }}>Account Type<select aria-label="Account Type" value={fundFields.accountType} onChange={(e) => setFundFields((f) => ({ ...f, accountType: e.target.value }))} style={{ ...SELECT, height: 36, width: '100%', marginTop: 4 }}><option value="checking">Checking</option><option value="savings">Savings</option></select></label>
                <label style={{ fontSize: 12, color: 'var(--muted)' }}>Funding reason<input aria-label="Funding reason" value={fundFields.reason} onChange={(e) => setFundFields((f) => ({ ...f, reason: e.target.value }))} placeholder="e.g. Salon owner changed primary bank" style={{ ...SELECT, height: 36, width: '100%', marginTop: 4 }} /></label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', marginTop: 4 }}>
                  <input type="checkbox" checked={fundFields.stepUp} onChange={(e) => setFundFields((f) => ({ ...f, stepUp: e.target.checked }))} aria-label="Confirm step-up authentication" />
                  <span>Confirm step-up authentication</span>
                </label>
                {fundErr && <div style={{ fontSize: 12, color: SEMANTIC.bad }}>{fundErr}</div>}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                  <button className="btn ghost" onClick={() => setFundForm(null)}>Cancel</button>
                  <button className="btn" onClick={submitFunding} disabled={fundBusy}>{fundBusy ? 'Updating…' : 'Update funding'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MID MODAL */}
      {midForm && (
        <div role="dialog" aria-label="Assign MID to a Branch" onClick={() => setMidForm(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20, 16, 10, 0.65)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ background: '#FFFDF8', borderRadius: 14, padding: 20, width: 460, maxWidth: '92vw', boxShadow: '0 24px 70px rgba(0,0,0,0.45)', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Assign an MID to a Branch</h2>
              <button className="btn ghost sm" aria-label="Close" onClick={() => setMidForm(null)}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>Assign or reassign an active merchant processing identifier to a specific branch.</div>
            {midResult ? (
              <div>
                <div style={{ fontSize: 13, color: '#1F9254', fontWeight: 700, marginBottom: 8 }}>MID assigned.</div>
                <div style={{ marginTop: 14, textAlign: 'right' }}><button className="btn" onClick={() => setMidForm(null)}>Done</button></div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ fontSize: 12, color: 'var(--muted)' }}>Merchant ID<input aria-label="Merchant ID" value={midFields.merchantId} onChange={(e) => setMidFields((f) => ({ ...f, merchantId: e.target.value }))} placeholder="MID-XXXX-XXXX" style={{ ...SELECT, height: 36, width: '100%', marginTop: 4 }} /></label>
                <label style={{ fontSize: 12, color: 'var(--muted)' }}>Branch ID (optional)<input aria-label="Branch ID (optional)" value={midFields.branchId} onChange={(e) => setMidFields((f) => ({ ...f, branchId: e.target.value }))} placeholder="e.g. branch-downtown" style={{ ...SELECT, height: 36, width: '100%', marginTop: 4 }} /></label>
                <label style={{ fontSize: 12, color: 'var(--muted)' }}>MID reason<input aria-label="MID reason" value={midFields.reason} onChange={(e) => setMidFields((f) => ({ ...f, reason: e.target.value }))} placeholder="e.g. Provisioning new terminal line" style={{ ...SELECT, height: 36, width: '100%', marginTop: 4 }} /></label>
                {midErr && <div style={{ fontSize: 12, color: SEMANTIC.bad }}>{midErr}</div>}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                  <button className="btn ghost" onClick={() => setMidForm(null)}>Cancel</button>
                  <button className="btn" onClick={submitMid} disabled={midBusy}>{midBusy ? 'Assigning…' : 'Assign MID'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TERMINAL MODAL */}
      {termForm && (
        <div role="dialog" aria-label="Assign Terminals" onClick={() => setTermForm(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20, 16, 10, 0.65)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ background: '#FFFDF8', borderRadius: 14, padding: 20, width: 460, maxWidth: '92vw', boxShadow: '0 24px 70px rgba(0,0,0,0.45)', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Assign Terminals</h2>
              <button className="btn ghost sm" aria-label="Close" onClick={() => setTermForm(null)}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>Bind a physical POS card reader or countertop terminal to this processing merchant account.</div>
            {termResult ? (
              <div>
                <div style={{ fontSize: 13, color: '#1F9254', fontWeight: 700, marginBottom: 8 }}>Terminal assigned.</div>
                <div style={{ marginTop: 14, textAlign: 'right' }}><button className="btn" onClick={() => setTermForm(null)}>Done</button></div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ fontSize: 12, color: 'var(--muted)' }}>Terminal ID<input aria-label="Terminal ID" value={termFields.terminalId} onChange={(e) => setTermFields((f) => ({ ...f, terminalId: e.target.value }))} placeholder="e.g. TRM-001" style={{ ...SELECT, height: 36, width: '100%', marginTop: 4 }} /></label>
                <label style={{ fontSize: 12, color: 'var(--muted)' }}>Terminal branch ID<input aria-label="Terminal branch ID" value={termFields.branchId} onChange={(e) => setTermFields((f) => ({ ...f, branchId: e.target.value }))} placeholder="e.g. Main" style={{ ...SELECT, height: 36, width: '100%', marginTop: 4 }} /></label>
                <label style={{ fontSize: 12, color: 'var(--muted)' }}>Terminal reason<input aria-label="Terminal reason" value={termFields.reason} onChange={(e) => setTermFields((f) => ({ ...f, reason: e.target.value }))} placeholder="e.g. Added 2nd checkout lane" style={{ ...SELECT, height: 36, width: '100%', marginTop: 4 }} /></label>
                {termErr && <div style={{ fontSize: 12, color: SEMANTIC.bad }}>{termErr}</div>}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                  <button className="btn ghost" onClick={() => setTermForm(null)}>Cancel</button>
                  <button className="btn" onClick={submitTerminal} disabled={termBusy}>{termBusy ? 'Assigning…' : 'Assign terminal'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ACTION WORKFLOW MODAL */}
      {actionModal && (
        <div
          role="dialog"
          aria-label={actionModal}
          onClick={() => setActionModal(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(20, 16, 10, 0.65)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
        >
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ background: '#FFFDF8', borderRadius: 14, padding: 20, width: 'min(520px, 92vw)', boxShadow: '0 24px 70px rgba(0,0,0,0.45)', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{actionModal}</h2>
              <button className="btn ghost sm" onClick={() => setActionModal(null)}>✕</button>
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
              This is a secure, permissioned, audited workflow for Super Admins. Changes are permanently logged for financial compliance.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn" onClick={() => setActionModal(null)}>Understood</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const SELECT: React.CSSProperties = { height: 36, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', background: '#FFFFFF', fontSize: 12.5, color: 'var(--text)', minWidth: 0 };

