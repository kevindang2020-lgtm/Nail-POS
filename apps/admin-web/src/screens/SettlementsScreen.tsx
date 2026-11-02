import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { superAdminSettlementsApi, type SettlementsOverview, type SettlementRow, type SettlementStatus, type ReconciliationStatus } from '../api/superAdminSettlementsApi';
import { Donut, MiniBars, AreaLine, money, moneyK, dd, NotConnected } from './_chartkit';

// SettlementsScreen.tsx — Super Admin › Payments & Revenue › Settlements & Deposits.
// Bound to the live GET /super-admin/settlements/overview over payment_settlements (Fiserv/CardPointe/Clover only).
// Funding accounts are masked (•••• 1234) by the backend. Read-oriented oversight: filter/select/inspect + note/export/case actions.
// Original processor/bank data is never mutated here. Honest empties render as "—"/NotConnected.

const PROC = (p: string | null) => (p ? ({ fiserv: 'Fiserv', cardpointe: 'CardPointe', clover: 'Clover', bolt: 'Bolt' } as Record<string, string>)[p] ?? p : '—');
const PROC_COLOR: Record<string, string> = { fiserv: '#E07B39', cardpointe: '#3C7FB6', clover: '#3E8F57', bolt: '#7C3AED' };
const TITLE = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const money0 = (c: number | null | undefined) => (c == null ? '—' : money(c));
const signed = (c: number | null) => (c == null ? '—' : (c > 0 ? '+' : '') + money(c));

const SETTLE_PILL: Record<SettlementStatus, { bg: string; fg: string }> = {
  settled: { bg: '#E7F5EC', fg: '#1F9254' },
  pending: { bg: '#FBF0DC', fg: '#B7791F' },
  processing: { bg: '#EAF1FF', fg: '#2F6FED' },
  partially_settled: { bg: '#EAF1FF', fg: '#2F6FED' },
  delayed: { bg: '#FDF0E6', fg: '#D07A2A' },
  failed: { bg: '#FBE7E4', fg: '#C0392B' },
  held: { bg: '#F0EFF4', fg: '#6B7280' },
  cancelled: { bg: '#F0EFF4', fg: '#6B7280' },
  reversed: { bg: '#FBE7E4', fg: '#C0392B' },
  unknown: { bg: '#F0EFF4', fg: '#6B7280' },
};

const RECON_PILL: Record<ReconciliationStatus, { bg: string; fg: string }> = {
  reconciled: { bg: '#E7F5EC', fg: '#1F9254' },
  resolved: { bg: '#E7F5EC', fg: '#1F9254' },
  matched: { bg: '#E7F5EC', fg: '#1F9254' },
  in_review: { bg: '#FBF0DC', fg: '#B7791F' },
  pending: { bg: '#FBF0DC', fg: '#B7791F' },
  partially_reconciled: { bg: '#FBF0DC', fg: '#B7791F' },
  discrepancy_found: { bg: '#FDF0E6', fg: '#D07A2A' },
  escalated: { bg: '#FBE7E4', fg: '#C0392B' },
  failed: { bg: '#FBE7E4', fg: '#C0392B' },
  not_started: { bg: '#F0EFF4', fg: '#6B7280' },
};

function Pill({ label, tone }: { label: string; tone: { bg: string; fg: string } }) {
  return (
    <span style={{ background: tone.bg, color: tone.fg, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, border: `1px solid ${tone.fg}30`, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

const EXC_LABEL: Record<string, string> = { delayed_deposit: 'Delayed Deposits', failed_deposit: 'Failed Deposits', large_difference: 'Large Differences', missing_deposit: 'Missing Deposits' };
const STATUS_OPTS: SettlementStatus[] = ['pending', 'processing', 'settled', 'partially_settled', 'delayed', 'failed', 'held', 'cancelled', 'reversed'];
const RECON_OPTS: ReconciliationStatus[] = ['not_started', 'pending', 'matched', 'in_review', 'discrepancy_found', 'partially_reconciled', 'reconciled', 'resolved', 'escalated', 'failed'];

export function SettlementsScreen() {
  const [data, setData] = useState<SettlementsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlashMsg] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState({ search: '', processor: '', settlementStatus: '', reconciliationStatus: '', fundingLast4: '' });
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pageSize] = useState(10);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteCat, setNoteCat] = useState('reconciliation');
  const [matchOpen, setMatchOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const flashT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashMsg = useCallback((m: string) => { setFlashMsg(m); if (flashT.current) clearTimeout(flashT.current); flashT.current = setTimeout(() => setFlashMsg(null), 4000); }, []);

  const load = useCallback(() => {
    superAdminSettlementsApi.overview({ page, pageSize, ...(applied.search ? { search: applied.search } : {}), ...(applied.processor ? { processor: applied.processor } : {}), ...(applied.settlementStatus ? { settlementStatus: applied.settlementStatus } : {}), ...(applied.reconciliationStatus ? { reconciliationStatus: applied.reconciliationStatus } : {}), ...(applied.fundingLast4 ? { fundingLast4: applied.fundingLast4 } : {}), ...(selectedId ? { selectedId } : {}) })
      .then((d) => { setData(d); setError(null); })
      .catch((e: any) => setError(e?.message || 'Failed to load settlements.'));
  }, [page, pageSize, applied, selectedId]);
  useEffect(load, [load]);

  const doExport = useCallback(async (fmt: 'csv' | 'xlsx') => {
    try {
      const blob = await (fmt === 'csv' ? superAdminSettlementsApi.exportCsv : superAdminSettlementsApi.exportXlsx)({ ...(applied.search ? { search: applied.search } : {}), ...(applied.processor ? { processor: applied.processor } : {}), ...(applied.settlementStatus ? { settlementStatus: applied.settlementStatus } : {}) });
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `settlements-${new Date().toISOString().slice(0, 10)}.${fmt}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      flashMsg(`Exported the current settlement view to ${fmt.toUpperCase()} — masked funding only, audited server-side.`);
    } catch { flashMsg('Export was unavailable — please retry.'); }
  }, [applied, flashMsg]);

  const openNote = useCallback(() => { if (!selectedId) { flashMsg('Select a batch first to add a reconciliation note.'); return; } setNoteOpen(true); }, [selectedId, flashMsg]);
  const openMatch = useCallback(() => { if (!selectedId) { flashMsg('Select a batch first to match a deposit.'); return; } setMatchOpen(true); }, [selectedId, flashMsg]);
  const openResolve = useCallback(() => { if (!selectedId) { flashMsg('Select a batch with a discrepancy first.'); return; } setResolveOpen(true); }, [selectedId, flashMsg]);
  const submitMatch = useCallback(async (actualCents: number, actualDate: string, depositRef: string) => {
    if (!selectedId) return;
    try {
      const r = await superAdminSettlementsApi.matchDeposit(selectedId, { actualCents, actualDate: actualDate || undefined, depositRef: depositRef || undefined });
      if (r.ok) { setMatchOpen(false); flashMsg((r as any).idempotent ? 'Deposit already matched — no change (idempotent).' : `Deposit recorded; reconciliation ${(r as any).reconciliationStatus === 'reconciled' ? 'matched exactly' : 'flagged for review'}. Original processor amounts unchanged.`); load(); }
      else flashMsg('Could not record the deposit match.');
    } catch { flashMsg('Could not record the deposit match.'); }
  }, [selectedId, flashMsg, load]);
  const submitResolve = useCallback(async (category: string, reason: string) => {
    if (!selectedId || !reason.trim()) return;
    try {
      const r = await superAdminSettlementsApi.resolve(selectedId, { resolutionCategory: category, reason: reason.trim() });
      if (r.ok) { setResolveOpen(false); flashMsg('Discrepancy marked resolved — original expected/actual amounts preserved, audit logged.'); load(); }
      else flashMsg('Could not resolve the discrepancy.');
    } catch { flashMsg('Could not resolve the discrepancy.'); }
  }, [selectedId, flashMsg, load]);
  const saveNote = useCallback(async () => {
    if (!selectedId || !noteText.trim()) return;
    try {
      const r = await superAdminSettlementsApi.addNote(selectedId, { category: noteCat, body: noteText.trim() });
      if (r.ok) { setNoteOpen(false); setNoteText(''); flashMsg('Reconciliation note saved (append-only, audited).'); load(); }
      else flashMsg('Could not save the note.');
    } catch { flashMsg('Could not save the note.'); }
  }, [selectedId, noteText, noteCat, flashMsg, load]);

  const apply = () => { setApplied((a) => ({ ...a, search })); setPage(1); };
  const reset = () => { setSearch(''); setApplied({ search: '', processor: '', settlementStatus: '', reconciliationStatus: '', fundingLast4: '' }); setPage(1); };
  const setFilter = (k: keyof typeof applied, v: string) => { setApplied((a) => ({ ...a, [k]: v })); setPage(1); };
  const scrollTable = () => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (error) return (
    <div className="work" style={{ padding: 24, textAlign: 'center' }}>
      <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 24 }}>
        <div style={{ color: '#C0392B', fontWeight: 700, marginBottom: 8, fontSize: 15 }}>{error}</div>
        <button className="btn" onClick={load}>Retry</button>
      </div>
    </div>
  );
  if (!data) return (
    <div className="work" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
      Loading settlements…
    </div>
  );

  const k = data.kpis;
  const kpis = [
    { l: 'Total Batches', v: k.totalBatches.toLocaleString(), fg: '#2F6FED', icon: '📦', bg: '#EAF1FF', onClick: scrollTable },
    { l: 'Gross Settlements', v: moneyK(k.grossCents), fg: '#1F9254', icon: '💵', bg: '#E7F5EC', onClick: scrollTable },
    { l: 'Net Deposits', v: moneyK(k.netCents), fg: '#1F9254', icon: '🏦', bg: '#E7F5EC', onClick: () => setFilter('settlementStatus', 'settled') },
    { l: 'Pending Deposits', v: moneyK(k.pendingDepositsCents), fg: '#B7791F', icon: '⏳', bg: '#FBF0DC', onClick: () => setFilter('settlementStatus', 'pending') },
    { l: 'Reconciliation Differences', v: money(k.reconDiffCents), fg: '#C0392B', icon: '⚖️', bg: '#FBE7E4', onClick: () => setFilter('reconciliationStatus', 'in_review') },
    { l: 'Processing Fees', v: moneyK(k.feesCents), fg: '#7C3AED', icon: '💳', bg: '#F3ECFB', onClick: scrollTable },
    { l: 'Chargeback Impact', v: money(k.chargebackCents), fg: '#C0392B', icon: '⚠️', bg: '#FBE7E4', onClick: scrollTable },
    { l: 'Funding Exceptions', v: k.fundingExceptions.toLocaleString(), fg: '#D07A2A', icon: '🚨', bg: '#FDF0E6', onClick: scrollTable },
  ];

  const sel = data.selectedBatch;
  const trend = data.settlementTrend;
  const funding = data.dailyFunding;

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflowY: 'auto' }}>
      {/* HEADER BAR */}
      <div className="vh" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            Settlements &amp; Deposits
          </h1>
          <div className="sub" style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
            Tracks processor settlement batches, bank deposits, and reconciliation differences.{data.meta.scope === 'tenant' ? ' · tenant scope' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn ghost" onClick={() => doExport('csv')} style={{ fontWeight: 700 }}>Export Settlement Reports</button>
          <button className="btn" onClick={openNote} style={{ fontWeight: 800 }}>+ Add Note</button>
        </div>
      </div>

      {flash && (
        <div role="status" style={{ fontSize: 12.5, color: '#8B5A18', background: '#FFF9EF', border: '1px solid #E2C686', borderRadius: 10, padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>ℹ️</span> {flash}
        </div>
      )}

      {/* 8 LUXURY KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        {kpis.map((c) => (
          <button
            key={c.l}
            className="kpi"
            onClick={c.onClick}
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
              <span style={{ width: 26, height: 26, borderRadius: 7, background: c.bg, color: c.fg, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700, flex: 'none' }}>
                {c.icon}
              </span>
            </div>
            <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 20, fontWeight: 700, color: 'var(--text)', marginTop: 6, lineHeight: 1.2 }}>
              {c.v}
            </div>
            <div style={{ fontSize: 10.5, color: c.fg, marginTop: 4, fontWeight: 600 }}>
              Inspect
            </div>
          </button>
        ))}
      </div>

      {/* FILTER BAR PANEL */}
      <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && apply()}
            placeholder="Search settlements..."
            aria-label="Search settlements"
            style={{ ...inp, height: 38, padding: '0 12px', fontSize: 13 }}
          />
          <input
            disabled
            value="All dates"
            style={{ ...inp, height: 38, opacity: 0.7 }}
            title="A settlement date-range filter is not available yet — the list shows every date"
            aria-label="Date range"
          />
          <select value={applied.processor} onChange={(e) => setFilter('processor', e.target.value)} aria-label="Processor" style={{ ...inp, height: 38 }}>
            <option value="">All Processors</option>
            {['fiserv', 'cardpointe', 'clover'].map((p) => <option key={p} value={p}>{PROC(p)}</option>)}
          </select>
          <select value={applied.fundingLast4} onChange={(e) => setFilter('fundingLast4', e.target.value)} aria-label="Funding Bank Account" style={{ ...inp, height: 38 }}>
            <option value="">All Accounts</option>
            {[...new Set(data.batches.rows.map((r) => r.fundingMasked).filter(Boolean))].map((m) => <option key={m!} value={m!.replace(/\D/g, '')}>{m}</option>)}
          </select>
          <select value={applied.settlementStatus} onChange={(e) => setFilter('settlementStatus', e.target.value)} aria-label="Settlement Status" style={{ ...inp, height: 38 }}>
            <option value="">All Settlement Statuses</option>
            {STATUS_OPTS.map((s) => <option key={s} value={s}>{TITLE(s)}</option>)}
          </select>
          <select value={applied.reconciliationStatus} onChange={(e) => setFilter('reconciliationStatus', e.target.value)} aria-label="Reconciliation Status" style={{ ...inp, height: 38 }}>
            <option value="">All Reconciliation Statuses</option>
            {RECON_OPTS.map((s) => <option key={s} value={s}>{TITLE(s)}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 }}>
          <button className="btn ghost" onClick={reset} style={{ height: 36, padding: '0 14px' }}>Reset Filters</button>
          <button className="btn" onClick={apply} style={{ height: 36, padding: '0 16px', fontWeight: 800 }}>Apply Filters</button>
        </div>
      </section>

      {/* MAIN: BATCHES TABLE + RIGHT RAIL */}
      <div
        className={`grid grid-cols-1 ${sel
            ? 'lg:grid-cols-[minmax(0,1fr)_360px]'
            : 'lg:grid-cols-[minmax(0,1fr)_320px]'
          } gap-4 items-start`}
      >
        {/* Table Panel */}
        <section ref={tableRef} className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 0, overflow: 'hidden', boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', display: 'flex', flexDirection: 'column' }}>
          <div className="hd" style={{ background: '#FFF9EF', padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
              Settlement Batches ({data.batches.total})
            </h2>
            <button className="btn ghost sm" onClick={load} aria-label="Refresh" style={{ padding: '2px 8px' }}>↻ Refresh</button>
          </div>

          <div style={{ overflowX: 'auto', width: '100%' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 1100 }}>
              <thead>
                <tr style={{ background: '#FFFBF2', borderBottom: '1px solid var(--line)', textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {['', 'Batch ID', 'Tenant', 'Branch', 'Processor', 'Gross', 'Refunds', 'Chargebacks', 'Fees', 'Net Deposit', 'Expected', 'Actual', 'Funding', 'Status', 'Difference'].map((h) => (
                    <th key={h} style={{ padding: '12px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.batches.rows.length === 0 ? (
                  <tr><td colSpan={15} style={{ padding: 36, textAlign: 'center', color: 'var(--muted)' }}>No settlement batches match the current filters.</td></tr>
                ) : data.batches.rows.map((r, idx) => {
                  const isSel = selectedId === r.id;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      style={{
                        cursor: 'pointer',
                        borderBottom: '1px solid var(--line)',
                        background: isSel ? '#FFF3E9' : idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = '#FFF9EF'; }}
                      onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF'; }}
                    >
                      <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => setSelectedId(isSel ? null : r.id)}
                          aria-label={`Select ${r.batchRef}`}
                        />
                      </td>
                      <td style={{ padding: '12px 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5, background: '#FFF9EF', border: '1px solid #E2C686', padding: '2px 6px', borderRadius: 6, color: '#8B5A18' }}>
                          {r.batchRef ?? '—'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 12px', whiteSpace: 'nowrap', fontWeight: 700, color: 'var(--text)' }}>
                        🏪 {r.tenantName ?? '—'}
                      </td>
                      <td style={{ padding: '12px 12px', whiteSpace: 'nowrap', color: 'var(--muted)' }}>
                        {r.branchName ?? '—'}
                      </td>
                      <td style={{ padding: '12px 12px', whiteSpace: 'nowrap', fontWeight: 700, color: PROC_COLOR[r.processor || ''] || '#6B7280' }}>
                        {PROC(r.processor)}
                      </td>
                      <td style={{ padding: '12px 12px', whiteSpace: 'nowrap', fontWeight: 600 }}>{money(r.grossCents)}</td>
                      <td style={{ padding: '12px 12px', whiteSpace: 'nowrap', color: '#C0392B' }}>{r.refundsCents ? '-' + money(r.refundsCents) : money(0)}</td>
                      <td style={{ padding: '12px 12px', whiteSpace: 'nowrap', color: '#C0392B' }}>{r.chargebacksCents ? '-' + money(r.chargebacksCents) : money(0)}</td>
                      <td style={{ padding: '12px 12px', whiteSpace: 'nowrap', color: '#C0392B' }}>{r.feesCents ? '-' + money(r.feesCents) : money(0)}</td>
                      <td style={{ padding: '12px 12px', whiteSpace: 'nowrap', fontWeight: 800, color: '#1F9254' }}>{money(r.netCents)}</td>
                      <td style={{ padding: '12px 12px', whiteSpace: 'nowrap', color: 'var(--muted)' }}>{dd(r.expectedDepositDate)}</td>
                      <td style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>{r.actualDepositDate ? dd(r.actualDepositDate) : <span style={{ color: '#B4A88E' }}>—</span>}</td>
                      <td style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, background: '#F0EFF4', padding: '2px 6px', borderRadius: 4 }}>
                          {r.fundingMasked ?? '—'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 12px' }}><Pill label={TITLE(r.settlementStatus)} tone={SETTLE_PILL[r.settlementStatus]} /></td>
                      <td style={{ padding: '12px 12px', whiteSpace: 'nowrap', fontWeight: 700, color: r.differenceCents ? '#C0392B' : '#1F9254' }}>
                        {r.differenceCents ? signed(r.differenceCents) : money(0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: '#FFF9EF', borderTop: '1px solid var(--line)', fontSize: 12, color: 'var(--muted)' }}>
            <span>Showing <strong>{data.batches.total === 0 ? 0 : (data.batches.page - 1) * pageSize + 1}</strong> to <strong>{Math.min(data.batches.page * pageSize, data.batches.total)}</strong> of <strong>{data.batches.total}</strong> results</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="btn ghost sm" disabled={data.batches.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} style={{ padding: '2px 8px' }}>‹</button>
              <span style={{ fontWeight: 700 }}>{data.batches.page}</span><span style={{ color: 'var(--muted)' }}>/ {data.batches.totalPages}</span>
              <button className="btn ghost sm" disabled={data.batches.page >= data.batches.totalPages} onClick={() => setPage((p) => p + 1)} style={{ padding: '2px 8px' }}>›</button>
            </div>
          </div>
        </section>

        {/* Right Rail: Selected Details + Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SelectedBatchPanel batch={sel} onClose={() => setSelectedId(null)} onAddNote={openNote} />
          <ActionsPanel
            onReviewDaily={scrollTable}
            onMatch={openMatch}
            onMissing={() => setFilter('settlementStatus', 'delayed')}
            onDiscrepancies={() => setFilter('reconciliationStatus', 'in_review')}
            onExport={() => doExport('xlsx')}
            onCase={async () => { if (!sel) { flashMsg('Select a batch first to open a processor-support case.'); return; } const r = await superAdminSettlementsApi.processorCase(sel.id, { category: 'settlement_issue', severity: 'high' }); flashMsg(r.ok ? `Processor-support case opened for ${sel.batchRef} (${PROC(sel.processor)}).` : 'Could not open the case.'); }}
            onResolve={openResolve}
            onNote={openNote}
          />
        </div>
      </div>

      {/* NOTE MODAL */}
      {noteOpen && sel && (
        <div role="dialog" aria-label="Add Internal Reconciliation Note" onClick={() => setNoteOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(20, 16, 10, 0.65)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ background: '#FFFDF8', borderRadius: 14, padding: 20, width: 480, maxWidth: '92vw', boxShadow: '0 24px 70px rgba(0,0,0,0.45)', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Add Reconciliation Note — {sel.batchRef}</h2>
              <button className="btn ghost sm" onClick={() => setNoteOpen(false)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>
                Note Category
                <select value={noteCat} onChange={(e) => setNoteCat(e.target.value)} style={{ ...inp, marginTop: 4 }} aria-label="Note category">
                  {['reconciliation', 'missing_deposit', 'funding_delay', 'processor_communication', 'adjustment_explanation', 'chargeback_impact', 'refund_explanation', 'resolution', 'general'].map((c) => <option key={c} value={c}>{TITLE(c)}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>
                Note Text
                <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Internal reconciliation note (append-only)…" rows={3} style={{ ...inp, marginTop: 4, resize: 'vertical' }} aria-label="Note text" />
              </label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn ghost" onClick={() => setNoteOpen(false)}>Cancel</button>
                <button className="btn" disabled={!noteText.trim()} onClick={saveNote} style={{ fontWeight: 800 }}>Save Note</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MATCH MODAL */}
      {matchOpen && sel && (
        <div role="dialog" aria-label="Match deposit" onClick={() => setMatchOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(20, 16, 10, 0.65)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ background: '#FFFDF8', borderRadius: 14, padding: 20, width: 480, maxWidth: '92vw', boxShadow: '0 24px 70px rgba(0,0,0,0.45)', border: '1px solid var(--line)' }}>
            <MatchModalContent batch={sel} onCancel={() => setMatchOpen(false)} onSubmit={submitMatch} />
          </div>
        </div>
      )}

      {/* RESOLVE MODAL */}
      {resolveOpen && sel && (
        <div role="dialog" aria-label="Resolve discrepancy" onClick={() => setResolveOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(20, 16, 10, 0.65)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ background: '#FFFDF8', borderRadius: 14, padding: 20, width: 480, maxWidth: '92vw', boxShadow: '0 24px 70px rgba(0,0,0,0.45)', border: '1px solid var(--line)' }}>
            <ResolveModalContent batch={sel} onCancel={() => setResolveOpen(false)} onSubmit={submitResolve} />
          </div>
        </div>
      )}

      {/* LOWER ANALYSIS MODULES */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        <Module title="Settlement Trend">
          {trend.length === 0 ? <NotConnected>No settlements in range.</NotConnected> : <AreaLine series={trend.map((t) => ({ label: t.date.slice(5), valueCents: t.grossCents }))} height={130} />}
          <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12 }}>
            <div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>Gross Total</div><div style={{ fontWeight: 700, color: '#2F6FED' }}>{money(data.settlementTrendTotals.grossCents)}</div></div>
            <div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>Net Total</div><div style={{ fontWeight: 700, color: '#1F9254' }}>{money(data.settlementTrendTotals.netCents)}</div></div>
          </div>
        </Module>

        <Module title="Deposit Status">
          <Donut data={data.depositStatus.slices.map((s) => ({ label: TITLE(s.status), value: s.count }))} centerLabel={`${data.depositStatus.total} Batches`} />
          <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12 }}>
            <div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>Settled Amount</div><div style={{ fontWeight: 700, color: '#1F9254' }}>{money(data.depositStatus.settledAmountCents)}</div></div>
            <div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>Pending Amount</div><div style={{ fontWeight: 700, color: '#B7791F' }}>{money(data.depositStatus.pendingAmountCents)}</div></div>
          </div>
        </Module>

        <Module title="Reconciliation Differences">
          {data.reconciliationDifferences.rows.length === 0 ? <NotConnected>No differences.</NotConnected> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <tbody>{data.reconciliationDifferences.rows.map((r) => (
                <tr key={r.id} onClick={() => setSelectedId(r.id)} style={{ borderTop: '1px solid var(--line)', cursor: 'pointer' }}>
                  <td style={{ padding: '6px 4px', fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{r.batchRef ?? '—'}</td>
                  <td style={{ padding: '6px 4px', color: '#C0392B', fontWeight: 700 }}>{signed(r.differenceCents)}</td>
                  <td style={{ padding: '6px 4px' }}><Pill label={TITLE(r.status)} tone={RECON_PILL[r.status]} /></td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <div style={{ marginTop: 8, fontSize: 12 }}><span style={{ fontSize: 10.5, color: 'var(--muted)' }}>Total Differences</span><div style={{ fontWeight: 700, color: '#C0392B' }}>{money(data.reconciliationDifferences.totalCents)}</div></div>
        </Module>

        <Module title="Daily Funding Overview">
          {funding.length === 0 ? <NotConnected>No funding in range.</NotConnected> : <MiniBars data={funding.map((f) => ({ label: f.date.slice(5), value: Math.round(f.actualCents / 100), tip: `${f.date}: expected ${money(f.expectedCents)}, actual ${money(f.actualCents)}` }))} />}
          <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12 }}>
            <div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>Expected</div><div style={{ fontWeight: 700 }}>{money(data.dailyFundingTotals.expectedCents)}</div></div>
            <div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>Actual</div><div style={{ fontWeight: 700, color: '#1F9254' }}>{money(data.dailyFundingTotals.actualCents)}</div></div>
            <div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>Variance</div><div style={{ fontWeight: 700, color: data.dailyFundingTotals.varianceCents < 0 ? '#C0392B' : '#1F9254' }}>{signed(data.dailyFundingTotals.varianceCents)}</div></div>
          </div>
        </Module>

        <Module title="Recent Settlement Activity">
          {data.recentActivity.length === 0 ? <NotConnected>No recent activity.</NotConnected> : data.recentActivity.map((a) => (
            <div key={a.id} onClick={() => setSelectedId(a.id)} style={{ display: 'flex', gap: 8, padding: '7px 0', borderTop: '1px solid var(--line)', cursor: 'pointer', fontSize: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{a.batchRef} <Pill label={TITLE(a.status)} tone={SETTLE_PILL[a.status]} /></div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{a.tenantName} · {a.branchName} · {money0(a.amountCents)}</div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{new Date(a.atMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
            </div>
          ))}
        </Module>

        <Module title="Funding Exceptions">
          {data.fundingExceptions.categories.length === 0 ? <NotConnected>No funding exceptions.</NotConnected> : data.fundingExceptions.categories.map((c) => (
            <div key={c.type} onClick={() => c.type === 'delayed_deposit' ? setFilter('settlementStatus', 'delayed') : c.type === 'failed_deposit' ? setFilter('settlementStatus', 'failed') : setFilter('reconciliationStatus', 'in_review')} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--line)', cursor: 'pointer', fontSize: 12.5 }}>
              <span>{EXC_LABEL[c.type] ?? TITLE(c.type)}</span><span style={{ fontWeight: 700 }}>{c.count} batch{c.count === 1 ? '' : 'es'}</span>
            </div>
          ))}
          <div style={{ marginTop: 8, fontSize: 12 }}><span style={{ fontSize: 10.5, color: 'var(--muted)' }}>Total Exceptions</span><div style={{ fontWeight: 700, color: '#D07A2A' }}>{data.fundingExceptions.total}</div></div>
        </Module>
      </div>

      <div style={{ background: '#FFF9EF', border: '1px solid #E2C686', borderRadius: 12, padding: '12px 16px', fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
        <strong style={{ color: '#A96F22' }}>Super Admin Monitoring Boundary</strong> — reviews settlements and supports resolution. Original processor and bank data is never altered here; matching, resolution, notes, cases, and exports are permission-checked, tenant-isolated, and audit logged. Funding accounts are masked.
      </div>
    </div>
  );
}

const inp: React.CSSProperties = { width: '100%', height: 36, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5, boxSizing: 'border-box', background: '#FFFFFF', color: 'var(--text)' };

function Module({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, minWidth: 0, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}><h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{title}</h2></div>
      {children}
    </section>
  );
}

function SelectedBatchPanel({ batch, onClose, onAddNote }: { batch: (SettlementRow & { notes: { id: string; category: string; body: string; authorRole: string | null; createdAt: string }[] }) | null; onClose: () => void; onAddNote: () => void }) {
  if (!batch) return (
    <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, textAlign: 'center', fontSize: 12.5, color: 'var(--muted)' }}>
      <div style={{ fontSize: 24, marginBottom: 6 }}>👆</div>
      <h2 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Selected Batch Details</h2>
      Select a settlement batch to view its details and reconciliation notes.
    </section>
  );

  const rows: [string, React.ReactNode][] = [
    ['Batch ID', batch.batchRef ?? '—'], ['Processor', <span style={{ color: PROC_COLOR[batch.processor || ''] || '#6B7280', fontWeight: 700 }}>{PROC(batch.processor)}</span>],
    ['Tenant', batch.tenantName ?? '—'], ['Branch', batch.branchName ?? '—'],
    ['Funding Bank Account', batch.fundingMasked ?? '—'],
    ['Gross Transactions', money(batch.grossCents)],
    ['Refunds', <span style={{ color: '#C0392B' }}>{batch.refundsCents ? '-' + money(batch.refundsCents) : money(0)}</span>],
    ['Chargebacks', <span style={{ color: '#C0392B' }}>{batch.chargebacksCents ? '-' + money(batch.chargebacksCents) : money(0)}</span>],
    ['Processing Fees', <span style={{ color: '#C0392B' }}>{batch.feesCents ? '-' + money(batch.feesCents) : money(0)}</span>],
    ['Adjustments', money(batch.adjustmentsCents)],
    ['Net Deposit', <span style={{ fontWeight: 800, color: '#1F9254' }}>{money(batch.netCents)}</span>],
    ['Expected Deposit Date', dd(batch.expectedDepositDate)],
    ['Actual Deposit Date', batch.actualDepositDate ? dd(batch.actualDepositDate) : '—'],
    ['Settlement Status', <Pill label={TITLE(batch.settlementStatus)} tone={SETTLE_PILL[batch.settlementStatus]} />],
    ['Reconciliation Differences', <span style={{ color: batch.differenceCents ? '#C0392B' : '#1F9254', fontWeight: 700 }}>{batch.differenceCents ? signed(batch.differenceCents) : money(0)}</span>],
  ];

  return (
    <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}>Selected Batch Details</h2>
        <button className="btn ghost sm" onClick={onClose} aria-label="Close details" style={{ padding: '2px 8px' }}>✕</button>
      </div>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 10px', fontSize: 12 }}>
        {rows.map(([label, val], i) => (
          <Fragment key={i}>
            <dt style={{ color: 'var(--muted)', fontSize: 11.5 }}>{label}</dt>
            <dd style={{ margin: 0, textAlign: 'right', fontWeight: 600 }}>{val}</dd>
          </Fragment>
        ))}
      </dl>
      <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: 12.5, color: 'var(--text)' }}>Internal Reconciliation Notes</strong>
          <button className="btn ghost sm" onClick={onAddNote} aria-label="Add note" style={{ padding: '2px 8px' }}>✎ Add</button>
        </div>
        {batch.notes.length === 0 ? <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>No reconciliation notes yet.</div> : (
          <div style={{ marginTop: 6, fontSize: 12, background: '#FFF9EF', border: '1px solid #E2C686', borderRadius: 8, padding: 8 }}>
            <div>{batch.notes[0].body}</div>
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 3 }}>— {TITLE(batch.notes[0].authorRole ?? 'note')} · {new Date(batch.notes[0].createdAt).toLocaleString()}</div>
          </div>
        )}
      </div>
    </section>
  );
}

function ActionsPanel(p: { onReviewDaily: () => void; onMatch: () => void; onMissing: () => void; onDiscrepancies: () => void; onExport: () => void; onCase: () => void; onResolve: () => void; onNote: () => void }) {
  const actions = [
    ['Review Daily Batches', p.onReviewDaily], ['Match Deposits to Transactions', p.onMatch], ['Identify Missing Deposits', p.onMissing], ['Identify Settlement Discrepancies', p.onDiscrepancies],
    ['Export Settlement Reports', p.onExport], ['Open a Processor-Support Case', p.onCase], ['Mark Discrepancies as Resolved', p.onResolve], ['Add Internal Reconciliation Notes', p.onNote],
  ] as const;
  return (
    <section className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
      <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Super Admin Actions</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {actions.map(([label, fn]) => (
          <button
            key={label}
            onClick={fn}
            className="btn ghost sm"
            style={{ textAlign: 'left', padding: '6px 10px', fontSize: 11.5, height: 'auto', minHeight: 34, lineHeight: 1.2 }}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

function MatchModalContent({ batch, onCancel, onSubmit }: { batch: SettlementRow; onCancel: () => void; onSubmit: (actualCents: number, actualDate: string, ref: string) => void }) {
  const [amount, setAmount] = useState((batch.expectedNetCents / 100).toFixed(2));
  const [date, setDate] = useState(batch.expectedDepositDate ?? '');
  const [ref, setRef] = useState('');
  const cents = (parseDollarsToCents(amount || '0') ?? 0);
  const diff = Number.isFinite(cents) ? cents - batch.expectedNetCents : 0;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Match Deposit — {batch.batchRef}</h2>
        <button className="btn ghost sm" onClick={onCancel}>✕</button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
        Expected net {money(batch.expectedNetCents)} · funding {batch.fundingMasked ?? '—'}. Recording the observed deposit recomputes the signed difference; original processor amounts are never changed.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>Actual deposit amount (USD)<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" style={{ ...inp, marginTop: 4 }} aria-label="Actual deposit amount" /></label>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>Actual deposit date<input value={date} onChange={(e) => setDate(e.target.value)} placeholder="YYYY-MM-DD" style={{ ...inp, marginTop: 4 }} aria-label="Actual deposit date" /></label>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>Deposit reference (optional)<input value={ref} onChange={(e) => setRef(e.target.value)} style={{ ...inp, marginTop: 4 }} aria-label="Deposit reference" /></label>
        <div style={{ fontSize: 12, margin: '4px 0' }}>Computed difference: <strong style={{ color: diff === 0 ? '#1F9254' : '#C0392B' }}>{signed(diff)}</strong> {diff === 0 ? '(matches exactly)' : '(flagged for review)'}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn" disabled={!Number.isFinite(cents)} onClick={() => onSubmit(cents, date, ref)} style={{ fontWeight: 800 }}>Record Match</button>
        </div>
      </div>
    </div>
  );
}

function ResolveModalContent({ batch, onCancel, onSubmit }: { batch: SettlementRow; onCancel: () => void; onSubmit: (category: string, reason: string) => void }) {
  const [category, setCategory] = useState('processor_adjustment_confirmed');
  const [reason, setReason] = useState('');
  const CATS = ['processor_adjustment_confirmed', 'bank_timing_difference', 'expected_fee_confirmed', 'refund_timing_difference', 'chargeback_timing_difference', 'deposit_split', 'rounding_tolerance', 'corrected_matching', 'false_positive', 'other'];
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Mark Discrepancy Resolved — {batch.batchRef}</h2>
        <button className="btn ghost sm" onClick={onCancel}>✕</button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
        Difference {signed(batch.differenceCents)}. Resolving records a resolution note and flips reconciliation status only — the original expected and actual amounts are preserved and audit logged.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>Resolution category<select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...inp, marginTop: 4 }} aria-label="Resolution category">{CATS.map((c) => <option key={c} value={c}>{TITLE(c)}</option>)}</select></label>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>Reason / evidence (required)<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} style={{ ...inp, marginTop: 4, resize: 'vertical' }} aria-label="Resolution reason" /></label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn" disabled={!reason.trim()} onClick={() => onSubmit(category, reason)} style={{ fontWeight: 800 }}>Mark Resolved</button>
        </div>
      </div>
    </div>
  );
}
