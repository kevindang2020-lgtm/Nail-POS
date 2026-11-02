import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { superAdminApi } from '../api/superAdminApi';
import { Donut, money, dt, NotConnected } from './_chartkit';

// PaymentsScreen.tsx — Super Admin › Payments & Revenue › Payments & Transactions. A searchable platform-level view of
// payment activity over the real `payments` table (GET /super-admin/platform/payments-transactions). Every figure is
// real or an honest gap. SECURITY: only masked cards ("Brand •••• 1234") + tokens are ever shown — never a PAN, which
// is not stored anywhere. Backend enforces the masking; the UI only formats what the API returns.

type Kpi = { value: number | null; available: boolean };
type TxnRow = {
  id: string; tenant: string | null; branch: string | null; merchant: string | null; customer: string;
  amountCents: number; tipCents: number; taxCents: number; discountCents: number; surchargeCents: number; totalChargedCents: number;
  method: string; card: string; status: string; statusLabel: string; statusTone: 'ok' | 'warn' | 'danger' | 'muted';
  refundStatus: string; settlementStatus: string; processor: string | null; reference: string | null; createdAt: string | null;
};
type Result = {
  total: number; rows: TxnRow[];
  kpis: { totalTransactions: Kpi; grossVolumeCents: Kpi; approved: Kpi; failedDeclined: Kpi; refundsVoids: Kpi; settled: Kpi; processingFeesCents: Kpi; duplicateAlerts: Kpi };
  byMethod: { method: string; count: number; cents: number }[];
  trend: { day: string; cents: number }[];
  failed: { id: string; amountCents: number; reason: string; createdAt: string | null }[];
  processors: { processor: string; lastSyncAt: string | null; events: number }[];
};
type Detail = {
  id: string; tenant: string | null; branch: string | null; merchant: string | null; authorizationCode: string | null;
  refundStatus: string; settlementStatus: string; processorResponse: string; deviceUsed: string | null; method: string; card: string;
  tokenReference: string | null; customer: string; email: string; phone: string; amountCents: number; tipCents: number; taxCents: number;
  discountCents: number; surchargeCents: number; totalChargedCents: number; statusLabel: string; createdAt: string | null;
};
type AuthEvent = { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted'; processor: string | null; processorTransactionId: string | null; correlationId: string | null; signatureValid: boolean; processed: boolean; at: string | null };
type AuthHistory = { id: string; events: AuthEvent[] };

const STATUS_OPTIONS = ['Pending', 'Authorized', 'Approved', 'Captured', 'Declined', 'Failed', 'Cancelled', 'Voided', 'Partially Refunded', 'Refunded', 'Reversed', 'Disputed', 'Chargeback'];
const REFUND_OPTIONS = ['No Refund', 'Refund Pending', 'Partially Refunded', 'Fully Refunded', 'Refund Failed'];
const SETTLE_OPTIONS = ['Unsettled', 'Pending Settlement', 'Settled', 'Partially Settled', 'Settlement Failed', 'Held', 'Reconciled'];
const toneColor: Record<string, string> = { ok: '#1F9254', warn: '#B7791F', danger: '#C0392B', muted: '#6B7280' };
const toneBg: Record<string, string> = { ok: '#E7F5EC', warn: '#FBF0DC', danger: '#FBE7E4', muted: '#EEF0F3' };
const csvCell = (v: unknown) => { const s = String(v ?? ''); const g = /^[=+\-@]/.test(s) ? "'" + s : s; return '"' + g.replace(/"/g, '""') + '"'; };
const rel = (iso: string | null) => { if (!iso) return '—'; const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return s < 1 ? 'just now' : s < 60 ? `${s}m ago` : s < 1440 ? `${Math.round(s / 60)}h ago` : `${Math.round(s / 1440)}d ago`; };

function Field({ l, v, mono, highlight }: { l: string; v: React.ReactNode; mono?: boolean; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--line,#E9DAC4)', fontSize: 12.5 }}>
      <span className="muted" style={{ fontSize: 12, color: 'var(--muted)' }}>{l}</span>
      <span style={{ fontWeight: highlight ? 700 : 600, color: highlight ? 'var(--g7, #A96F22)' : 'var(--text)', fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit', textAlign: 'right', fontSize: highlight ? 14 : 12.5, wordBreak: 'break-all', maxWidth: '62%' }}>
        {v}
      </span>
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: toneColor[tone] || toneColor.muted, background: toneBg[tone] || toneBg.muted, border: `1px solid ${toneColor[tone]}22`, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: toneColor[tone] || toneColor.muted }} />
      {label}
    </span>
  );
}

function Trend({ data }: { data: { day: string; cents: number }[] }) {
  if (!data.length) return <NotConnected>No volume in range.</NotConnected>;
  const w = 320, h = 120, pad = 6; const max = Math.max(1, ...data.map((d) => d.cents));
  const pts = data.map((d, i) => `${pad + (i * (w - 2 * pad)) / Math.max(1, data.length - 1)},${h - pad - (d.cents / max) * (h - 2 * pad)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="120" role="img" aria-label="Gross payment volume trend">
      <polyline points={pts} fill="none" stroke="#2F6FED" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => { const [x, y] = pts.split(' ')[i].split(',').map(Number); return <circle key={i} cx={x} cy={y} r={2.5} fill="#2F6FED" />; })}
    </svg>
  );
}

const EMPTY = { search: '', tenant: '', branch: '', merchant: '', customer: '', method: '', status: '', refundStatus: '', settlementStatus: '', startDate: '', endDate: '', device: '' };

export function PaymentsScreen() {
  const [st, setSt] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ ...EMPTY });
  const [applied, setApplied] = useState({ ...EMPTY });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [authHistory, setAuthHistory] = useState<AuthHistory | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof EMPTY, v: string) => setF((p) => ({ ...p, [k]: v }));

  const openAuthHistory = () => {
    if (!selected) { setNotice('Select a transaction first, then view its authorization history.'); return; }
    setAuthOpen(true); setAuthHistory(null);
    (superAdminApi.paymentAuthorizationHistory(selected) as Promise<AuthHistory>).then(setAuthHistory).catch(() => setAuthHistory({ id: selected, events: [] }));
  };

  const load = useCallback(() => {
    const q: Record<string, unknown> = { page, pageSize };
    if (applied.search) q.search = applied.search;
    if (applied.tenant) q.tenantId = applied.tenant;
    if (applied.branch) q.branchId = applied.branch;
    if (applied.customer) q.customerId = applied.customer;
    if (applied.method) q.method = applied.method;
    if (applied.status) q.status = applied.status;
    if (applied.refundStatus) q.refundStatus = applied.refundStatus;
    if (applied.settlementStatus) q.settlementStatus = applied.settlementStatus;
    if (applied.startDate) q.startDate = applied.startDate;
    if (applied.endDate) q.endDate = applied.endDate;
    (superAdminApi.paymentsTransactions(q) as Promise<Result>).then(setSt).catch((e: any) => setError(e?.message || 'Failed to load transactions.'));
  }, [applied, page, pageSize]);
  useEffect(load, [load]);

  const selectRow = (id: string) => {
    setSelected(id); setDetail(null);
    (superAdminApi.paymentTransactionDetail(id) as Promise<Detail>).then(setDetail).catch(() => setDetail(null));
  };
  const applyFilters = () => { setApplied({ ...f }); setPage(1); };
  const reset = () => { setF({ ...EMPTY }); setApplied({ ...EMPTY }); setPage(1); };

  const tenants = useMemo(() => Array.from(new Set((st?.rows || []).map((r) => r.tenant).filter(Boolean))) as string[], [st]);
  const branches = useMemo(() => Array.from(new Set((st?.rows || []).map((r) => r.branch).filter(Boolean))) as string[], [st]);
  const methods = useMemo(() => Array.from(new Set((st?.byMethod || []).map((m) => m.method))), [st]);

  const exportCsv = () => {
    const rows = st?.rows || [];
    const head = ['Transaction ID', 'Tenant', 'Branch', 'Merchant', 'Customer', 'Amount', 'Tip', 'Tax', 'Discount', 'Processing Fee', 'Total Charged', 'Payment Method', 'Status', 'Refund', 'Settlement', 'Date'];
    const body = rows.map((r) => [r.id, r.tenant, r.branch, r.merchant, r.customer, money(r.amountCents), money(r.tipCents), money(r.taxCents), money(r.discountCents), money(r.surchargeCents), money(r.totalChargedCents), r.card, r.statusLabel, r.refundStatus, r.settlementStatus, dt(r.createdAt)].map(csvCell).join(','));
    const csv = [head.map(csvCell).join(','), ...body].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `payments-transactions-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
    setNotice('Exported the current filtered view (masked card details only).');
  };

  const grossVolume = st?.kpis.grossVolumeCents.value ?? 0;
  const kpiCards = st ? [
    { l: 'Total Transactions', k: st.kpis.totalTransactions, fmt: (v: number) => v.toLocaleString(), icon: '📋', bg: '#EAF1FF', fg: '#2F6FED', onClick: () => reset() },
    { l: 'Gross Payment Volume', k: st.kpis.grossVolumeCents, fmt: money, icon: '💵', bg: '#E7F5EC', fg: '#1F9254' },
    { l: 'Approved Transactions', k: st.kpis.approved, fmt: (v: number) => v.toLocaleString(), icon: '✓', bg: '#E7F5EC', fg: '#1F9254', onClick: () => { setF((p) => ({ ...p, status: 'Approved' })); setApplied((p) => ({ ...p, status: 'Approved' })); setPage(1); } },
    { l: 'Failed / Declined Payments', k: st.kpis.failedDeclined, fmt: (v: number) => v.toLocaleString(), icon: '✕', bg: '#FBE7E4', fg: '#C0392B', onClick: () => { setF((p) => ({ ...p, status: 'Failed' })); setApplied((p) => ({ ...p, status: 'Failed' })); setPage(1); } },
    { l: 'Refunds & Voids', k: st.kpis.refundsVoids, fmt: (v: number) => v.toLocaleString(), icon: '↺', bg: '#F3ECFB', fg: '#7C3AED' },
    { l: 'Settled Transactions', k: st.kpis.settled, fmt: (v: number) => v.toLocaleString(), icon: '🏦', bg: '#E7F5EC', fg: '#1F9254' },
    { l: 'Processing Fees', k: st.kpis.processingFeesCents, fmt: money, icon: '🏷️', bg: '#FBF0DC', fg: '#B7791F' },
    { l: 'Duplicate Charge Alerts', k: st.kpis.duplicateAlerts, fmt: (v: number) => v.toLocaleString(), icon: '⚠️', bg: '#FBF0DC', fg: '#B7791F', onClick: () => setNotice('Duplicate-charge review opens candidate comparisons; automatic refund/void is never performed. Same amount alone is not treated as a duplicate.') },
  ] : [];

  const actions: { l: string; fn: () => void }[] = [
    { l: 'Search Transactions', fn: () => searchRef.current?.focus() },
    { l: 'View Authorization History', fn: openAuthHistory },
    { l: 'Investigate Failed Payments', fn: () => { setF((p) => ({ ...p, status: 'Failed' })); setApplied((p) => ({ ...p, status: 'Failed' })); setPage(1); } },
    { l: 'Review Refunds', fn: () => { setF((p) => ({ ...p, refundStatus: 'Fully Refunded' })); setApplied((p) => ({ ...p, refundStatus: 'Fully Refunded' })); setPage(1); } },
    { l: 'Review Voids', fn: () => { setF((p) => ({ ...p, status: 'Voided' })); setApplied((p) => ({ ...p, status: 'Voided' })); setPage(1); } },
    { l: 'Review Duplicate Charges', fn: () => setNotice('Duplicate-charge review compares candidate transactions for a reviewer. It never auto-refunds or auto-voids.') },
    { l: 'Review Processor Errors', fn: () => setNotice('Normalized processor-error review needs the processor-error feed, which is not yet connected.') },
    { l: 'Export Transaction Reports', fn: exportCsv },
    { l: 'Retry Supported Synchronization', fn: () => setNotice('Retry re-runs a safe technical sync/reconciliation only — it never recharges a customer. No eligible sync event is queued in this build.') },
    { l: 'Escalate Processing Problems', fn: () => setNotice(selected ? 'Escalation would open a support incident carrying this transaction, tenant, branch, processor, and error context.' : 'Select a transaction to escalate with full context.') },
  ];

  if (error) return <div className="work"><div className="err">{error}</div></div>;
  if (!st) return <div className="work"><div className="state">Loading payments…</div></div>;

  const from = st.total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, st.total);
  const pages = Math.max(1, Math.ceil(st.total / pageSize));

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflowY: 'auto' }}>
      {/* HEADER SECTION */}
      <div className="vh" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: '#FFF6E5', border: '1px solid #E2C686', fontSize: 11, fontWeight: 700, color: 'var(--g7, #A96F22)', marginBottom: 6 }}>
            <span>💳 Platform Payment Gateway &amp; Audit</span>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--ok, #3E8F57)' }} />
          </div>
          <br />
          <h1 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>
            Payments &amp; Transactions <span style={{ color: '#F0820B', fontSize: 20 }}>★</span>
          </h1>
          <div className="sub" style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
            Provides a searchable platform-level view of payment activity.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={exportCsv} style={{ fontWeight: 700 }}>
            Export Transaction Reports
          </button>
          <button
            className="btn"
            onClick={() => setNotice('Add Widget uses the per-user widget preference system, which is not yet connected on this surface.')}
            style={{ fontWeight: 800 }}
          >
            + Add Widget
          </button>
        </div>
      </div>

      {notice && (
        <div
          className="state"
          role="status"
          style={{
            fontSize: 12.5,
            background: '#FFF9EF',
            border: '1px solid #E2C686',
            borderRadius: 10,
            padding: '10px 14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            color: 'var(--text)',
            boxShadow: '0 2px 8px rgba(169, 111, 34, 0.06)',
          }}
        >
          <span>💡 {notice}</span>
          <button className="btn ghost sm" onClick={() => setNotice(null)} style={{ padding: '2px 10px', minHeight: 26 }}>
            Dismiss
          </button>
        </div>
      )}

      {/* 8 LUXURY KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        {kpiCards.map((c) => (
          <div
            className="panel"
            key={c.l}
            onClick={c.onClick}
            style={{
              cursor: c.onClick ? 'pointer' : 'default',
              background: '#FFFDF8',
              border: '1px solid var(--line)',
              borderRadius: 14,
              padding: '13px 14px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
            }}
            role={c.onClick ? 'button' : undefined}
            tabIndex={c.onClick ? 0 : undefined}
            aria-label={`${c.l}: ${c.k.available ? c.fmt(c.k.value as number) : 'not connected'}`}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="l" style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted)' }}>
                {c.l}
              </span>
              <span style={{ width: 24, height: 24, borderRadius: 6, background: c.bg, color: c.fg, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>
                {c.icon}
              </span>
            </div>
            <div className="v" style={{ fontFamily: 'Playfair Display, serif', fontSize: 20, fontWeight: 700, color: 'var(--text)', marginTop: 6 }}>
              {c.k.available ? c.fmt(c.k.value as number) : <NotConnected>Not connected</NotConnected>}
            </div>
          </div>
        ))}
      </div>

      {/* FILTER BAR PANEL */}
      <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          <input
            ref={searchRef}
            className="inp"
            aria-label="Search transactions"
            placeholder="Search transactions..."
            value={f.search}
            onChange={(e) => set('search', e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
            style={{ ...inp, height: 38, background: '#FFFFFF', padding: '0 12px', fontSize: 13 }}
          />
          <select className="inp" aria-label="Tenant" value={f.tenant} onChange={(e) => set('tenant', e.target.value)} style={{ ...inp, height: 38, background: '#FFFFFF' }}>
            <option value="">All Tenants</option>
            {tenants.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="inp" aria-label="Branch" value={f.branch} onChange={(e) => set('branch', e.target.value)} style={{ ...inp, height: 38, background: '#FFFFFF' }}>
            <option value="">All Branches</option>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select className="inp" aria-label="Merchant Account" value={f.merchant} onChange={(e) => set('merchant', e.target.value)} style={{ ...inp, height: 38, background: '#FFFFFF' }}>
            <option value="">All Merchant Accounts</option>
          </select>
          <select className="inp" aria-label="Customer" value={f.customer} onChange={(e) => set('customer', e.target.value)} style={{ ...inp, height: 38, background: '#FFFFFF' }}>
            <option value="">All Customers</option>
          </select>
          <select className="inp" aria-label="Payment Method" value={f.method} onChange={(e) => set('method', e.target.value)} style={{ ...inp, height: 38, background: '#FFFFFF' }}>
            <option value="">All Methods</option>
            {methods.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignItems: 'center' }}>
          <select className="inp" aria-label="Transaction Status" value={f.status} onChange={(e) => set('status', e.target.value)} style={{ ...inp, height: 38, background: '#FFFFFF' }}>
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="inp" aria-label="Refund Status" value={f.refundStatus} onChange={(e) => set('refundStatus', e.target.value)} style={{ ...inp, height: 38, background: '#FFFFFF' }}>
            <option value="">All Statuses</option>
            {REFUND_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="inp" aria-label="Settlement Status" value={f.settlementStatus} onChange={(e) => set('settlementStatus', e.target.value)} style={{ ...inp, height: 38, background: '#FFFFFF' }}>
            <option value="">All Statuses</option>
            {SETTLE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input className="inp" aria-label="Start date" type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} style={{ ...inp, height: 38, background: '#FFFFFF' }} />
          <input className="inp" aria-label="End date" type="date" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} style={{ ...inp, height: 38, background: '#FFFFFF' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" onClick={reset} style={{ height: 38, flex: 1, padding: '0 12px' }}>
              Reset Filters
            </button>
            <button className="btn" onClick={applyFilters} style={{ height: 38, flex: 1, padding: '0 12px', fontWeight: 800 }}>
              Filter
            </button>
          </div>
        </div>
      </section>

      {/* MAIN CONTENT: TRANSACTIONS TABLE + DETAIL PANEL */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
        {/* Table Panel */}
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 0, overflow: 'hidden', boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', display: 'flex', flexDirection: 'column' }}>
          <div className="hd" style={{ background: '#FFF9EF', padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
              Transactions <span className="muted" style={{ fontWeight: 500, fontSize: 13 }}>({st.total.toLocaleString()})</span>
            </h2>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Click any row to inspect full transaction audit details.
            </div>
          </div>

          {st.rows.length === 0 ? (
            <div className="state" style={{ padding: 48, textAlign: 'center' }}>
              <div style={{ fontSize: 26, marginBottom: 6 }}>🔍</div>
              <div style={{ fontWeight: 600 }}>No transactions match the current filters.</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Try clearing or adjusting your search filters.</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto', width: '100%' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 1000 }}>
                <thead>
                  <tr style={{ background: '#FFFBF2', borderBottom: '1px solid var(--line)', textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    <th style={{ width: 36, padding: '12px 14px' }}></th>
                    <th style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>Transaction ID</th>
                    <th style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>Tenant</th>
                    <th style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>Branch</th>
                    <th style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>Merchant</th>
                    <th style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>Customer</th>
                    <th style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>Amount</th>
                    <th style={{ padding: '12px 10px', whiteSpace: 'nowrap' }}>Tip</th>
                    <th style={{ padding: '12px 10px', whiteSpace: 'nowrap' }}>Tax</th>
                    <th style={{ padding: '12px 10px', whiteSpace: 'nowrap' }}>Discount</th>
                    <th style={{ padding: '12px 10px', whiteSpace: 'nowrap' }}>Processing Fee</th>
                    <th style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>Payment Method</th>
                    <th style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>Status</th>
                    <th style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>Date &amp; Time</th>
                  </tr>
                </thead>
                <tbody>
                  {st.rows.map((r, idx) => {
                    const isSelected = selected === r.id;
                    return (
                      <tr
                        key={r.id}
                        onClick={() => selectRow(r.id)}
                        style={{
                          cursor: 'pointer',
                          background: isSelected ? '#FFF3E9' : idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF',
                          borderBottom: '1px solid var(--line)',
                          transition: 'background 0.15s ease',
                        }}
                        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#FFF9EF'; }}
                        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF'; }}
                      >
                        <td style={{ padding: '12px 14px' }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => selectRow(r.id)}
                            aria-label={`Select ${r.id}`}
                            style={{ cursor: 'pointer' }}
                          />
                        </td>
                        <td style={{ padding: '12px 12px' }}>
                          <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, background: '#FFF9EF', border: '1px solid #E2C686', padding: '2px 6px', borderRadius: 6, color: '#8B5A18', whiteSpace: 'nowrap' }}>
                            {r.id.slice(0, 18)}
                          </span>
                        </td>
                        <td style={{ padding: '12px 12px', fontWeight: 700, color: 'var(--text)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>🏪</span>
                            <span>{r.tenant || '—'}</span>
                          </div>
                        </td>
                        <td style={{ padding: '12px 12px', color: 'var(--muted)' }}>
                          {r.branch ? <span className="pill" style={{ fontSize: 11 }}>{r.branch}</span> : '—'}
                        </td>
                        <td style={{ padding: '12px 12px', color: 'var(--muted)', fontSize: 11.5 }}>
                          {r.merchant || '—'}
                        </td>
                        <td style={{ padding: '12px 12px', fontWeight: 600 }}>
                          {r.customer}
                        </td>
                        <td style={{ padding: '12px 12px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                          {money(r.amountCents)}
                        </td>
                        <td style={{ padding: '12px 10px', color: 'var(--muted)' }}>
                          {r.tipCents ? money(r.tipCents) : '—'}
                        </td>
                        <td style={{ padding: '12px 10px', color: 'var(--muted)' }}>
                          {money(r.taxCents)}
                        </td>
                        <td style={{ padding: '12px 10px', color: 'var(--muted)' }}>
                          {r.discountCents ? money(r.discountCents) : '—'}
                        </td>
                        <td style={{ padding: '12px 10px', color: 'var(--muted)' }}>
                          {money(r.surchargeCents)}
                        </td>
                        <td style={{ padding: '12px 12px', whiteSpace: 'nowrap', fontWeight: 600 }}>
                          {r.card}
                        </td>
                        <td style={{ padding: '12px 12px' }}>
                          <Badge label={r.statusLabel} tone={r.statusTone} />
                        </td>
                        <td style={{ padding: '12px 16px', color: 'var(--muted)', fontSize: 11.5, whiteSpace: 'nowrap' }}>
                          {dt(r.createdAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Table Pagination Footer */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: '#FFF9EF', borderTop: '1px solid var(--line)', fontSize: 12, flexWrap: 'wrap', gap: 10 }}>
            <span className="muted">
              Showing <strong>{from}</strong> to <strong>{to}</strong> of <strong>{st.total.toLocaleString()}</strong> entries
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Prev
              </button>
              <span style={{ fontWeight: 600 }}>
                Page {page} / {pages}
              </span>
              <button className="btn ghost sm" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
                Next
              </button>
              <select
                className="inp"
                aria-label="Rows per page"
                value={pageSize}
                onChange={(e) => { setPageSize(+e.target.value); setPage(1); }}
                style={{ ...inp, height: 30, width: 95, padding: '0 6px', borderRadius: 6 }}
              >
                {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
              </select>
            </div>
          </div>
        </section>

        {/* Selected Transaction Details Panel */}
        <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', position: 'sticky', top: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: 'var(--text)' }}>Selected Transaction Details</h2>
            {selected && (
              <button className="btn ghost sm" aria-label="Close details" onClick={() => { setSelected(null); setDetail(null); }} style={{ padding: '2px 8px', minHeight: 26 }}>
                ✕
              </button>
            )}
          </div>

          {!selected ? (
            <div className="state" style={{ padding: '36px 12px', textAlign: 'center', fontSize: 12.5 }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>👆</div>
              Select a transaction to see masked details.
            </div>
          ) : !detail ? (
            <div className="state" style={{ padding: 24, textAlign: 'center' }}>Loading…</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <Field l="Salon / Tenant" v={detail.tenant || '—'} highlight />
              <Field l="Branch" v={detail.branch || '—'} />
              <Field l="Transaction ID" v={detail.id.slice(0, 18)} mono />
              <Field l="Authorization Code" v={detail.authorizationCode || '—'} mono />
              <Field l="Refund Status" v={<Badge label={detail.refundStatus} tone={detail.refundStatus === 'No Refund' ? 'muted' : 'warn'} />} />
              <Field l="Settlement Status" v={<Badge label={detail.settlementStatus} tone={detail.settlementStatus === 'Settled' ? 'ok' : 'muted'} />} />
              <Field l="Processor Response" v={detail.processorResponse} />
              <Field l="Device Used" v={detail.deviceUsed || '—'} />
              <Field l="Payment Method" v={detail.card} />
              <Field l="Token / Reference" v={detail.tokenReference || '—'} mono />
              <Field l="Customer" v={detail.customer} />
              <Field l="Email" v={detail.email} />
              <Field l="Phone" v={detail.phone} />
              <Field l="Amount" v={money(detail.amountCents)} />
              <Field l="Tip" v={money(detail.tipCents)} />
              <Field l="Tax" v={money(detail.taxCents)} />
              <Field l="Discount" v={money(detail.discountCents)} />
              <Field l="Processing Fee" v={money(detail.surchargeCents)} />
              <Field l="Total Charged" v={money(detail.totalChargedCents)} highlight />
              <Field l="Date & Time" v={dt(detail.createdAt)} />

              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, padding: '10px 12px', background: '#FFF9EF', border: '1px solid #E2C686', borderRadius: 9, fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>
                <span aria-hidden style={{ fontSize: 14 }}>🔒</span>
                <span>Masked and tokenized card details only. Full card numbers are never displayed.</span>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* CHARTS + PROCESSOR STATUS + SUPER ADMIN ACTIONS */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start pb-6">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
          {/* Chart 1: Volume Trend */}
          <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Payment Volume Trend</h2>
            <Trend data={st.trend} />
            <div className="muted" style={{ fontSize: 11, marginTop: 6, color: 'var(--muted)' }}>
              Gross Payment Volume (USD) · last 7 days
            </div>
          </section>

          {/* Chart 2: Top Payment Methods */}
          <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Top Payment Methods</h2>
            {st.byMethod.length === 0 ? (
              <NotConnected>No approved volume yet.</NotConnected>
            ) : (
              <Donut
                data={st.byMethod.map((m) => ({
                  label: m.method,
                  value: Math.round(m.cents / 100),
                }))}
                centerLabel={money(grossVolume)}
              />
            )}
          </section>

          {/* Chart 3: Failed Payments */}
          <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Failed Payments</h2>
            {st.failed.length === 0 ? (
              <div className="state" style={{ padding: 24, textAlign: 'center', fontSize: 12 }}>
                No failed payments in range.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {st.failed.map((x) => (
                  <div
                    key={x.id}
                    onClick={() => selectRow(x.id)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 10px',
                      background: '#FFFDF8',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    <span className="muted" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10.5 }}>
                      {x.id.slice(0, 16)}
                    </span>
                    <span style={{ fontWeight: 700 }}>{money(x.amountCents)}</span>
                    <Badge label={x.reason} tone="danger" />
                    <span className="muted" style={{ fontSize: 11 }}>{dt(x.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right Stack: Processor Status + Super Admin Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Processor &amp; Sync Status</h2>
            {st.processors.length === 0 ? (
              <NotConnected>No processor events yet.</NotConnected>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {st.processors.map((p) => (
                  <div
                    key={p.processor}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 10px',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      background: '#FFFDF8',
                      fontSize: 12.5,
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: p.lastSyncAt ? '#1F9254' : '#B7791F', flex: 'none' }} />
                    <span style={{ flex: 1, fontWeight: 700 }}>{p.processor}</span>
                    <span className="muted" style={{ fontSize: 11.5 }}>Synced {rel(p.lastSyncAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Super Admin Actions</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {actions.map((a) => (
                <button
                  key={a.l}
                  className="btn ghost sm"
                  onClick={a.fn}
                  style={{ fontSize: 11.5, textAlign: 'left', padding: '6px 10px', height: 'auto', minHeight: 34, lineHeight: 1.2 }}
                >
                  {a.l}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* AUTHORIZATION HISTORY MODAL */}
      {authOpen && (
        <div
          role="dialog"
          aria-label="Authorization History"
          onClick={() => setAuthOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(20, 16, 10, 0.65)',
            backdropFilter: 'blur(5px)',
            WebkitBackdropFilter: 'blur(5px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{
              background: '#FFFDF8',
              borderRadius: 14,
              padding: 20,
              width: 'min(620px, 92vw)',
              maxHeight: '82vh',
              overflow: 'auto',
              boxShadow: '0 24px 70px rgba(0,0,0,0.45)',
              border: '1px solid var(--line)',
            }}
          >
            <div className="hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottom: '1px solid var(--line)', background: '#FFF9EF', margin: '-20px -20px 14px -20px', padding: '14px 20px' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Authorization History</h2>
              <button className="btn ghost sm" aria-label="Close" onClick={() => setAuthOpen(false)} style={{ padding: '2px 8px', minHeight: 28 }}>
                ✕
              </button>
            </div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
              Read-only processor event sequence — labels, correlation ids, and signature status only. No payloads or card data.
            </div>
            {!authHistory ? (
              <div className="state" style={{ fontSize: 12, padding: 24, textAlign: 'center' }}>Loading…</div>
            ) : authHistory.events.length === 0 ? (
              <div className="state" style={{ fontSize: 12, padding: 24, textAlign: 'center' }}>No processor events recorded for this transaction yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {authHistory.events.map((e, i) => (
                  <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 12, background: '#FFFFFF' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <Badge label={e.label} tone={e.tone} />
                      <span className="muted" style={{ fontSize: 11 }}>{dt(e.at)}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                      {e.processor || '—'}
                      {e.processorTransactionId ? ` · ${e.processorTransactionId}` : ''}
                      {e.correlationId ? ` · ${e.correlationId}` : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11.5 }}>
                      <span style={{ color: e.signatureValid ? '#1F9254' : '#B7791F', fontWeight: 600 }}>
                        {e.signatureValid ? '✓ signature valid' : '⚠ signature unverified'}
                      </span>
                      <span className="muted">{e.processed ? 'processed' : 'recorded (not processed)'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn ghost" onClick={() => setAuthOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inp: React.CSSProperties = { height: 36, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff', minWidth: 0 };
