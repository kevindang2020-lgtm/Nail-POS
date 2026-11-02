// HardwarePaymentReportsScreen.tsx — Super-Admin reporting for Hardware Payment Recovery (build doc §16). Monthly
// platform totals across all tenants: card volume, hardware credit issued, amount due, shortfall, amount collected,
// and collection rate, with paid/failed counts. Exportable to CSV. Reads GET /super-admin/hardware-payment/reports.
import { useEffect, useMemo, useState } from 'react';
import { superAdminApi as A, type HwReportRow } from '../api/superAdminApi';

const money = (c: any) => '$' + (Number(c || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = (c: any) => '$' + Math.round(Number(c || 0) / 100).toLocaleString();

export function HardwarePaymentReportsScreen() {
  const [rows, setRows] = useState<HwReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadData = () => {
    setLoading(true);
    A.hwReports()
      .then((d) => {
        setRows(d || []);
        setErr(null);
      })
      .catch((e: any) => setErr(e?.message || 'Failed to load reports.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const totals = useMemo(() => rows.reduce((t, r) => ({
    invoiceCount: t.invoiceCount + (r.invoiceCount || 0),
    cardVolumeCents: t.cardVolumeCents + (r.cardVolumeCents || 0),
    hardwareCreditCents: t.hardwareCreditCents + (r.hardwareCreditCents || 0),
    shortfallCents: t.shortfallCents + (r.shortfallCents || 0),
    chargedCents: t.chargedCents + (r.chargedCents || 0),
    paidCount: t.paidCount + (r.paidCount || 0),
    failedCount: t.failedCount + (r.failedCount || 0),
  }), { invoiceCount: 0, cardVolumeCents: 0, hardwareCreditCents: 0, shortfallCents: 0, chargedCents: 0, paidCount: 0, failedCount: 0 }), [rows]);

  const overallRate = totals.shortfallCents > 0 ? Math.round((totals.chargedCents / totals.shortfallCents) * 100) : 100;

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    return rows.filter((r) => r.billingMonth.toLowerCase().includes(search.toLowerCase().trim()));
  }, [rows, search]);

  const exportCsv = () => {
    const head = ['Month', 'Invoices', 'Card Volume', 'Hardware Credit', 'Amount Due', 'Shortfall', 'Collected', 'Collection %', 'Paid', 'Failed'];
    const lines = [head.join(',')].concat(rows.map((r) => [
      r.billingMonth,
      r.invoiceCount,
      (r.cardVolumeCents / 100).toFixed(2),
      (r.hardwareCreditCents / 100).toFixed(2),
      (r.dueCents / 100).toFixed(2),
      (r.shortfallCents / 100).toFixed(2),
      (r.chargedCents / 100).toFixed(2),
      r.collectionRatePct,
      r.paidCount,
      r.failedCount,
    ].join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hardware-payment-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflowY: 'auto' }}>
      {/* HEADER SECTION */}
      <div className="vh" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: '#FFF6E5', border: '1px solid #E2C686', fontSize: 11, fontWeight: 700, color: 'var(--g7, #A96F22)', marginBottom: 6 }}>
            <span>💳 Hardware Recovery &amp; Reconciliation</span>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--ok, #3E8F57)' }} />
          </div>
          <br />
          <h1 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>Hardware Payment Reports</h1>
          <div className="sub" style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
            Monthly platform totals across all tenants · {rows.length} month{rows.length === 1 ? '' : 's'} · Revenue split recovery &amp; shortfall reconciliations
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn ghost" onClick={loadData} title="Reload report data">
            ↻ Refresh
          </button>
          <button className="btn" disabled={!rows.length} onClick={exportCsv} style={{ fontWeight: 800 }}>
            Export CSV
          </button>
        </div>
      </div>

      {err ? <div className="err" role="alert" style={{ margin: 0 }}>{err}</div> : null}

      {/* 5 PREMIUM KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
        {/* Card 1: Card volume */}
        <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: '16px 18px', boxShadow: '0 2px 10px rgba(169, 111, 34, 0.04)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted)' }}>Card volume</span>
            <span style={{ fontSize: 16, width: 32, height: 32, borderRadius: 8, background: '#FFF4DE', display: 'grid', placeItems: 'center', color: '#A96F22' }}>💳</span>
          </div>
          <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)', marginTop: 8 }}>
            {money0(totals.cardVolumeCents)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span className="pill ok" style={{ fontSize: 10.5, fontWeight: 700 }}>{totals.invoiceCount} invoices</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>processed</span>
          </div>
        </div>

        {/* Card 2: Hardware credit */}
        <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: '16px 18px', boxShadow: '0 2px 10px rgba(169, 111, 34, 0.04)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted)' }}>Hardware credit issued</span>
            <span style={{ fontSize: 16, width: 32, height: 32, borderRadius: 8, background: '#EAF5EE', display: 'grid', placeItems: 'center', color: '#3E8F57' }}>🎁</span>
          </div>
          <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)', marginTop: 8 }}>
            {money(totals.hardwareCreditCents)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            Revenue-split offset applied
          </div>
        </div>

        {/* Card 3: Shortfall billed */}
        <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: '16px 18px', boxShadow: '0 2px 10px rgba(169, 111, 34, 0.04)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted)' }}>Shortfall billed</span>
            <span style={{ fontSize: 16, width: 32, height: 32, borderRadius: 8, background: '#FFF6E5', display: 'grid', placeItems: 'center', color: '#D09A36' }}>⚠️</span>
          </div>
          <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)', marginTop: 8 }}>
            {money(totals.shortfallCents)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            Uncovered by card volume
          </div>
        </div>

        {/* Card 4: Collected */}
        <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: '16px 18px', boxShadow: '0 2px 10px rgba(169, 111, 34, 0.04)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted)' }}>Collected</span>
            <span style={{ fontSize: 16, width: 32, height: 32, borderRadius: 8, background: '#EEF7EF', display: 'grid', placeItems: 'center', color: '#3E8F57' }}>💵</span>
          </div>
          <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)', marginTop: 8 }}>
            {money(totals.chargedCents)}
          </div>
          <div style={{ fontSize: 11, color: totals.failedCount ? 'var(--danger, #B85B4D)' : 'var(--ok, #3E8F57)', fontWeight: 600, marginTop: 4 }}>
            {totals.paidCount} paid · {totals.failedCount} failed
          </div>
        </div>

        {/* Card 5: Collection rate */}
        <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: '16px 18px', boxShadow: '0 2px 10px rgba(169, 111, 34, 0.04)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted)' }}>Collection rate</span>
            <span style={{ fontSize: 16, width: 32, height: 32, borderRadius: 8, background: '#EAF0F6', display: 'grid', placeItems: 'center', color: '#3C7FB6' }}>📈</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 8 }}>
            <span style={{ fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>
              {overallRate}%
            </span>
            <span style={{ fontSize: 11, color: overallRate >= 90 ? 'var(--ok, #3E8F57)' : 'var(--warn, #D09A36)', fontWeight: 700 }}>
              {overallRate >= 90 ? 'Optimal' : 'Needs Review'}
            </span>
          </div>
          <div style={{ width: '100%', height: 6, background: '#F1E6D4', borderRadius: 999, overflow: 'hidden', marginTop: 6 }}>
            <div style={{ width: `${Math.min(100, Math.max(0, overallRate))}%`, height: '100%', background: 'var(--grad, linear-gradient(180deg, #F2D892, #D7A646))', borderRadius: 999 }} />
          </div>
        </div>
      </div>

      {/* SUMMARY INSIGHT STRIP */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#FFF4DE', display: 'grid', placeItems: 'center', fontSize: 20 }}>📊</div>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>Average Monthly Volume</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
              {rows.length > 0 ? money0(totals.cardVolumeCents / rows.length) : '$0'} <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>/ month</span>
            </div>
          </div>
        </div>

        <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#EEF7EF', display: 'grid', placeItems: 'center', fontSize: 20 }}>🛡️</div>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>Total Hardware Recovery</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ok, #3E8F57)' }}>
              {money(totals.hardwareCreditCents + totals.chargedCents)} <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>credited + charged</span>
            </div>
          </div>
        </div>

        <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: totals.failedCount > 0 ? '#FCEEEB' : '#EEF7EF', display: 'grid', placeItems: 'center', fontSize: 20 }}>
            {totals.failedCount > 0 ? '⚠️' : '✓'}
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>Charge Failure Risk</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: totals.failedCount > 0 ? 'var(--danger, #B85B4D)' : 'var(--ok, #3E8F57)' }}>
              {totals.failedCount === 0 ? '0 Failed Auto-charges' : `${totals.failedCount} Failed Charges`}
            </div>
          </div>
        </div>
      </div>

      {/* MONTHLY SETTLEMENT DATA TABLE */}
      <section className="panel min-h-[280px]" style={{ background: '#FFF9EF', border: '1px solid var(--line)', borderRadius: 14, padding: 0, overflow: 'hidden', boxShadow: '0 4px 20px rgba(169, 111, 34, 0.05)', display: 'flex', flexDirection: 'column' }}>
        {/* Table Header Bar with Search Filter */}
        <div className="hd" style={{ background: '#FFF9EF', padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Monthly Reconciliation Ledger</h2>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>Breakdown of per-month card volume offsets, generated hardware credits, and charged shortfalls.</div>
          </div>

          <div style={{ position: 'relative', minWidth: 200 }}>
            <input
              type="text"
              placeholder="Filter by month (YYYY-MM)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%', height: 34, border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', fontSize: 12, background: '#FFFFFF', outline: 'none' }}
            />
          </div>
        </div>

        {loading ? (
          <div className="state" style={{ padding: 48, textAlign: 'center' }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>↻</div>
            Loading monthly reconciliation reports…
          </div>
        ) : rows.length === 0 ? (
          <div className="state" style={{ padding: 48, textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>No invoices have been generated yet.</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Run the monthly reconciliation on the Hardware Payments page to generate the first invoice cycle.</div>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="state" style={{ padding: 36, textAlign: 'center' }}>
            No monthly records match <strong>"{search}"</strong>.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', width: '100%' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#FFFBF2', borderBottom: '1px solid var(--line)', textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '11px 16px' }}>Month</th>
                  <th style={{ padding: '11px 12px' }}>Invoices</th>
                  <th style={{ padding: '11px 12px' }}>Card Volume</th>
                  <th style={{ padding: '11px 12px' }}>Hardware Credit</th>
                  <th style={{ padding: '11px 12px' }}>Amount Due</th>
                  <th style={{ padding: '11px 12px' }}>Shortfall</th>
                  <th style={{ padding: '11px 12px' }}>Collected</th>
                  <th style={{ padding: '11px 12px' }}>Collection %</th>
                  <th style={{ padding: '11px 12px' }}>Settled (Paid)</th>
                  <th style={{ padding: '11px 16px' }}>Failed</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r, idx) => {
                  const isFull = r.collectionRatePct >= 100;
                  return (
                    <tr
                      key={r.billingMonth}
                      style={{
                        borderBottom: '1px solid var(--line)',
                        background: idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#FFF9EF')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF')}
                    >
                      <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--text)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: 'var(--g7, #A96F22)' }}>📅</span>
                          <span>{r.billingMonth}</span>
                        </div>
                      </td>
                      <td style={{ padding: '12px 12px' }}>
                        <span className="pill" style={{ background: '#FFF9EF', borderColor: '#E2C686', fontWeight: 700 }}>
                          {r.invoiceCount}
                        </span>
                      </td>
                      <td style={{ padding: '12px 12px', fontWeight: 600, color: 'var(--text)' }}>
                        {money0(r.cardVolumeCents)}
                      </td>
                      <td style={{ padding: '12px 12px', color: 'var(--ok, #3E8F57)', fontWeight: 600 }}>
                        {money(r.hardwareCreditCents)}
                      </td>
                      <td style={{ padding: '12px 12px', fontWeight: 600 }}>
                        {money(r.dueCents)}
                      </td>
                      <td style={{ padding: '12px 12px', color: r.shortfallCents > 0 ? 'var(--warn, #D09A36)' : 'var(--muted)', fontWeight: 600 }}>
                        {money(r.shortfallCents)}
                      </td>
                      <td style={{ padding: '12px 12px', color: 'var(--ok, #3E8F57)', fontWeight: 700 }}>
                        {money(r.chargedCents)}
                      </td>
                      <td style={{ padding: '12px 12px' }}>
                        <span className={isFull ? 'pill ok' : r.collectionRatePct > 0 ? 'pill warn' : 'pill'} style={{ fontWeight: 800 }}>
                          {r.collectionRatePct}%
                        </span>
                      </td>
                      <td style={{ padding: '12px 12px' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--ok, #3E8F57)', fontWeight: 600 }}>
                          <span>✓</span> {r.paidCount}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {r.failedCount > 0 ? (
                          <span className="pill danger" style={{ fontWeight: 700 }}>
                            {r.failedCount} failed
                          </span>
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>0</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Table Footer Summary */}
        <div style={{ background: '#FFF9EF', borderTop: '1px solid var(--line)', padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--muted)' }}>
          <div>Showing <strong>{filteredRows.length}</strong> of <strong>{rows.length}</strong> billing cycle records</div>
          <div>Audit reconciliation: <strong style={{ color: 'var(--ok, #3E8F57)' }}>Active</strong></div>
        </div>
      </section>
    </div>
  );
}
