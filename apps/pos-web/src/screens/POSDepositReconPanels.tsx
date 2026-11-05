// POSDepositReconPanels.tsx — the later-slice tabs for AI Deposit Reconciliation: Fees, Exceptions (with a
// human resolve action requiring a note), and Reports (summary + daily + CSV download). Uses the shared design
// system classes and reportsCommon helpers. Honest states throughout; empty until data exists.
import { useCallback, useEffect, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { posDepositReconApi } from '../api/posDepositReconApi';
import { money, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel } from '../i18n/status-label';
const fmtDate = (iso: string | null) => { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString(displayLocale(), { month: 'short', day: '2-digit' }); } catch { return '—'; } };
const signed = (c: number | null) => (c == null ? '—' : c === 0 ? '—' : (c > 0 ? '+' : '−') + money(Math.abs(c)));

// ---------- Fees ----------
const FEE_STATUS: Record<string, { t: string; c: string }> = {
  matched: { get t() { return t('pos.matched'); }, c: '#2E9E54' }, fee_difference: { get t() { return t('pos.difference'); }, c: '#C0392B' },
  unverified: { get t() { return t('pos.unverified'); }, c: '#B5651D' }, no_schedule: { get t() { return t('pos.no_schedule'); }, c: '#9A6a2a' },
};
export function FeesPanel() {
  const [data, setData] = useState<any>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { setLoading(true); setError(null); try { setData(await posDepositReconApi.feeReconciliation()); } catch (e: any) { setError(reportError(e, 'fee reconciliation')); } finally { setLoading(false); } })(); }, []);
  if (loading) return <div className="state">{t('pos.loading_fee_reconciliation')}</div>;
  if (error) return <div className="err" style={{ marginTop: 12 }}>{error}</div>;
  const k = data.kpis;
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3">
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.matched')}</div><div className="v" style={{ color: '#2E9E54' }}>{k.matched}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.differences')}</div><div className="v" style={{ color: k.feeDifferences ? '#C0392B' : undefined }}>{k.feeDifferences}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.unverified')}</div><div className="v" style={{ color: '#B5651D' }}>{k.unverified}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.fee_difference')}</div><div className="v">{money(k.feeDifferenceCents)}</div></div>
      </div>
      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
        <div className="p-h" style={{ padding: '14px 14px 0' }}>{t('pos.processing_fees_by_settlement')}</div>
        {data.rows.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.no_settlements_to_check_add_a_7we3')}</div> : (
          <div className="overflow-x-auto">
            <div className="min-w-[500px]">
              <table className="tbl">
                <thead><tr><th>{t('pos.settled')}</th><th>{t('pos.processor_2')}</th><th>{t('pos.actual_fee')}</th><th>{t('pos.expected')}</th><th>{t('pos.difference')}</th><th>{t('pos.status')}</th></tr></thead>
                <tbody>{data.rows.map((r: any) => (
                  <tr key={r.settlementId}>
                    <td>{fmtDate(r.settledAt)}</td><td>{r.processorType || '—'}</td>
                    <td>{money(r.actualFeeCents)}</td><td>{r.expectedFeeCents == null ? '—' : money(r.expectedFeeCents)}</td>
                    <td>{signed(r.differenceCents)}</td>
                    <td>{(() => { const m = FEE_STATUS[r.status] ?? { t: r.status, c: '#666' }; return <span title={r.unverifiedReason || ''} style={{ color: m.c, fontWeight: 700, fontSize: 12 }}>{m.t}</span>; })()}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </section>
      <div className="sub" style={{ fontSize: 12, marginTop: 8 }}>{t('pos.fees_that_can_t_be_checked_1b84')}</div>
    </>
  );
}

// ---------- Exceptions ----------
const SEV: Record<string, string> = { critical: '#C0392B', high: '#B5651D', moderate: '#9A6a2a', low: '#666', info: '#888' };
const EXC_STATUS: Record<string, { t: string; c: string }> = {
  open: { get t() { return t('pos.open'); }, c: '#B5651D' }, in_review: { get t() { return t('pos.in_review'); }, c: '#2D6CBF' }, escalated: { get t() { return t('pos.escalated'); }, c: '#C0392B' },
  resolved: { get t() { return t('pos.resolved_2'); }, c: '#2E9E54' }, reopened: { get t() { return t('pos.reopened_2'); }, c: '#9A6a2a' },
};
export function ExceptionsPanel() {
  const [data, setData] = useState<any>(null); const [error, setError] = useState<string | null>(null); const [note, setNote] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); setError(null); try { setData(await posDepositReconApi.listExceptions()); } catch (e: any) { setError(reportError(e, 'reconciliation exceptions')); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);
  // Inline resolve editor (Jul 27, 2026) — replaces window.prompt. The evidence note stays REQUIRED; it is just
  // captured in the brand UI instead of a native browser dialog.
  const [resolving, setResolving] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const resolve = async (id: string) => {
    const text = reason.trim();
    if (!text) { setNote(t('pos.a_resolution_note_evidence_is_required_wbgn')); return; }
    setNote(null);
    try { await posDepositReconApi.resolveException(id, text); setNote('Case resolved.'); setResolving(null); setReason(''); await load(); }
    catch (e: any) { setNote(e?.status === 403 ? t('pos.you_need_approval_permission_to_resolve_1t2u') : (e?.message || t('pos.could_not_resolve_the_case'))); }
  };
  if (loading) return <div className="state">{t('pos.loading_exceptions')}</div>;
  if (error) return <div className="err" style={{ marginTop: 12 }}>{error}</div>;
  const k = data.kpis;
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3">
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.open')}</div><div className="v">{k.open + k.inReview + k.escalated}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.critical')}</div><div className="v" style={{ color: k.critical ? '#C0392B' : undefined }}>{k.critical}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.resolved_2')}</div><div className="v" style={{ color: '#2E9E54' }}>{k.resolved}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.at_risk')}</div><div className="v">{money(k.amountAtRiskCents)}</div></div>
      </div>
      {note ? <div className="sub" style={{ marginTop: 8, color: note === 'Case resolved.' ? '#2E9E54' : '#C0392B' }}>{note}</div> : null}
      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
        <div className="p-h" style={{ padding: '14px 14px 0' }}>{t('pos.exception_queue')}</div>
        {data.items.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.no_open_exceptions_cases_appear_here_qqh2')}</div> : (
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              <table className="tbl">
                <thead><tr><th>{t('pos.case')}</th><th>{t('pos.kind')}</th><th>{t('pos.severity_2')}</th><th>{t('pos.amount_2')}</th><th>{t('pos.status')}</th><th></th></tr></thead>
                <tbody>{data.items.map((e: any) => (
                  <tr key={e.id}>
                    <td style={{ fontWeight: 600 }}>{e.title}</td>
                    <td className="sub" style={{ fontSize: 12 }}>{statusLabel('depositException', String(e.kind))}</td>
                    <td><span style={{ color: SEV[e.severity] || '#666', fontWeight: 700, fontSize: 12, textTransform: 'capitalize' }}>{statusLabel('level', String(e.severity))}</span></td>
                    <td>{money(e.amountCents)}</td>
                    <td>{(() => { const m = EXC_STATUS[e.status] ?? { t: e.status, c: '#666' }; return <span style={{ color: m.c, fontWeight: 700, fontSize: 12 }}>{m.t}</span>; })()}</td>
                    <td style={{ textAlign: 'right' }}>{e.status !== 'resolved' ? (
                      resolving === e.id ? (
                        <div className="flex flex-col sm:flex-row gap-1.5 sm:items-center sm:justify-end">
                          <input aria-label={t('pos.resolution_note_required')} placeholder={t('pos.resolution_note_required')} value={reason} onChange={(ev) => setReason(ev.target.value)}
                            autoFocus className="w-full sm:w-[220px]" style={{ minHeight: 36, border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', fontSize: 12 }} />
                          <div className="flex gap-1.5">
                            <button className="btn" onClick={() => resolve(e.id)}>{t('pos.resolve')}</button>
                            <button className="btn ghost" onClick={() => { setResolving(null); setReason(''); }}>{t('pos.cancel')}</button>
                          </div>
                        </div>
                      ) : <button className="btn ghost" onClick={() => { setResolving(e.id); setReason(''); setNote(null); }}>{t('pos.resolve')}</button>
                    ) : null}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </section>
      <div className="sub" style={{ fontSize: 12, marginTop: 8 }}>{t('pos.resolving_a_case_requires_a_note_1gsf')}</div>
    </>
  );
}

// ---------- Reports ----------
export function ReportsPanel() {
  const [summary, setSummary] = useState<any>(null); const [daily, setDaily] = useState<any>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { setLoading(true); setError(null); try { const [s, d] = await Promise.all([posDepositReconApi.reportSummary(), posDepositReconApi.reportDaily()]); setSummary(s); setDaily(d); } catch (e: any) { setError(reportError(e, 'reconciliation reports')); } finally { setLoading(false); } })(); }, []);
  const download = async () => {
    try {
      const text = await posDepositReconApi.exportDaily();   // BUILD_PLAN Phase 12: the async export contract
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      const a = document.createElement('a'); a.href = url; a.download = 'daily-reconciliation.csv'; a.click(); URL.revokeObjectURL(url);
    } catch { /* no-op; the button simply does nothing if unavailable */ }
  };
  if (loading) return <div className="state">{t('pos.loading_reports')}</div>;
  if (error) return <div className="err" style={{ marginTop: 12 }}>{error}</div>;
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3">
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.settlements')}</div><div className="v">{summary.settlements}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.expected')}</div><div className="v">{money(summary.expectedCents)}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.missing_deposits')}</div><div className="v" style={{ color: summary.missingDeposits ? '#C0392B' : undefined }}>{summary.missingDeposits}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.open_exceptions')}</div><div className="v">{summary.openExceptions}</div></div>
      </div>
      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between p-[14px] pb-0 gap-2">
          <div className="p-h">{t('pos.daily_reconciliation')}</div>
          <button className="btn w-full sm:w-auto" onClick={download}>{t('pos.export_csv')}</button>
        </div>
        {daily.rows.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.no_settlement_activity_to_report_yet')}</div> : (
          <div className="overflow-x-auto">
            <div className="min-w-[500px]">
              <table className="tbl">
                <thead><tr><th>{t('pos.date')}</th><th>{t('pos.settlements')}</th><th>{t('pos.expected')}</th><th>{t('pos.actual')}</th><th>{t('pos.difference')}</th><th>{t('pos.missing')}</th></tr></thead>
                <tbody>{daily.rows.map((r: any) => (
                  <tr key={r.date}><td>{r.date}</td><td>{r.settlementCount}</td><td>{money(r.expectedCents)}</td><td>{money(r.actualCents)}</td><td>{money(r.differenceCents)}</td><td>{r.missing}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
