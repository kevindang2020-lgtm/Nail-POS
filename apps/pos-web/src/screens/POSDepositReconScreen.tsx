// POSDepositReconScreen.tsx — AI Deposit Reconciliation (Payments & Money → AI Deposit Reconciliation).
// Slice 1 overview: reconciles the salon's processor settlements (from payment_settlements) against bank
// deposits it has recorded. Shows the matching state (matched / matched-with-tolerance / missing deposit),
// expected-vs-actual with signed differences, lets an authorized user add bank accounts and deposits, and
// link an unmatched deposit to a settlement (a human action — the system never moves money or auto-resolves).
// Honest states throughout; empty until settlements + deposits exist.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { posDepositReconApi } from '../api/posDepositReconApi';
import { money, reportError } from './reportsCommon';
import { FeesPanel, ExceptionsPanel, ReportsPanel } from './POSDepositReconPanels';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { useStepUp, isStepUpCancelled } from './access/accessUi';

type Kpis = { settlementCount: number; expectedCents: number; actualMatchedCents: number; matched: number; matchedWithTolerance: number; unmatchedSettlements: number; missingDeposits: number; unmatchedDeposits: number; differenceCents: number };
type Row = { settlementId: string; processorType: string | null; settledAt: string | null; grossCents: number; feeCents: number; expectedNetCents: number; depositId: string | null; actualCents: number | null; differenceCents: number; status: string; matchType: string; confidence: number; dateDiffDays: number | null };
type Bank = { id: string; nickname: string; bankName: string | null; accountType: string; accountLast4: string | null; currency: string; status: string };
type Dep = { id: string; bankAccountId: string; amountCents: number; depositDate: string | null; reference: string | null; source: string; status: string; matchedSettlementId: string | null; reconciliationStatus: string };

const STATUS: Record<string, { t: string; c: string }> = {
  matched: { get t() { return t('pos.matched'); }, c: '#2E9E54' },
  matched_with_tolerance: { get t() { return t('pos.matched_tolerance'); }, c: '#2D6CBF' },
  missing_deposit: { get t() { return t('pos.missing_deposit'); }, c: '#C0392B' },
  unmatched_settlement: { get t() { return t('pos.unmatched'); }, c: '#B5651D' },
};
const chip = (s: string) => { const m = STATUS[s] ?? { t: s, c: '#666' }; return <span style={{ color: m.c, fontWeight: 700, fontSize: 12 }}>{m.t}</span>; };
const signed = (c: number) => (c === 0 ? '—' : (c > 0 ? '+' : '−') + money(Math.abs(c)));
const fmtDate = (iso: string | null) => { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString(displayLocale(), { month: 'short', day: '2-digit' }); } catch { return '—'; } };

export function POSDepositReconScreen() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [unmatched, setUnmatched] = useState<Dep[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  // add-bank form
  const [bNick, setBNick] = useState(''); const [bName, setBName] = useState(''); const [bLast4, setBLast4] = useState('');
  // add-deposit form
  const [dAcct, setDAcct] = useState(''); const [dAmt, setDAmt] = useState(''); const [dDate, setDDate] = useState(''); const [dRef, setDRef] = useState('');

  // Security Deep Scan C7: adding a bank account is a step-up route (password prompt → one retry; Cancel → nothing, no error)
  const stepUp = useStepUp(t('pos.stepup_bank_account_needs_password'));

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [st, bk] = await Promise.all([posDepositReconApi.state(), posDepositReconApi.listBankAccounts().catch(() => [])]);
      setKpis(st.kpis); setRows(st.rows ?? []); setUnmatched(st.unmatchedDeposits ?? []); setBanks(Array.isArray(bk) ? bk : []);
    } catch (e: any) { setError(reportError(e, 'reconciliation')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const addBank = async () => {
    if (!bNick.trim()) { setNote(t('pos.give_the_account_a_nickname')); return; }
    setNote(null);
    try { await stepUp.run(() => posDepositReconApi.createBankAccount({ nickname: bNick.trim(), bankName: bName.trim() || undefined, accountLast4: bLast4.trim() || undefined })); setBNick(''); setBName(''); setBLast4(''); await load(); }
    catch (e: any) { if (!isStepUpCancelled(e)) setNote(e?.message || t('pos.could_not_add_the_account_permission')); }
  };
  const addDeposit = async () => {
    const cents = parseDollarsToCents(dAmt || '0') ?? NaN;   // invalid text falls into the amount guard below
    if (!dAcct) { setNote(t('pos.pick_a_bank_account')); return; }
    if (!cents || cents <= 0) { setNote(t('pos.enter_a_deposit_amount')); return; }
    setNote(null);
    try { await posDepositReconApi.createDeposit({ bankAccountId: dAcct, amountCents: cents, depositDate: dDate || undefined, reference: dRef.trim() || undefined }); setDAmt(''); setDRef(''); await load(); }
    catch (e: any) { setNote(e?.message || t('pos.could_not_record_the_deposit_permission')); }
  };
  const link = async (depositId: string, settlementId: string) => {
    setNote(null);
    try { await posDepositReconApi.linkDeposit(depositId, settlementId); await load(); }
    catch (e: any) { setNote(e?.message || t('pos.could_not_link_permission')); }
  };

  const missingRows = useMemo(() => rows.filter((r) => r.status === 'missing_deposit'), [rows]);

  if (loading) return <div className="work"><div className="state">{t('pos.loading_reconciliation')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{t('pos.ai_deposit_reconciliation')}</h1><div className="sub">{t('pos.match_processor_settlements_to_bank_deposits')}</div></div>

      <div className="flex overflow-x-auto whitespace-nowrap overflow-y-hidden gap-1 border-b border-[#EEE6D8] mb-1">
        {(['overview', 'fees', 'exceptions', 'reports'] as const).map((id) => [id, t(`payment.deposit.tab.${id}`)] as [string, string]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: tab === id ? 700 : 500, color: tab === id ? '#C99E53' : '#6b5d48', borderBottom: tab === id ? '2px solid #C99E53' : '2px solid transparent' }}>{label}</button>
        ))}
      </div>

      {tab === 'fees' ? <FeesPanel /> : tab === 'exceptions' ? <ExceptionsPanel /> : tab === 'reports' ? <ReportsPanel /> : (<>

      {kpis ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 mb-3.5 mt-2.5">
          <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.expected_deposits')}</div><div className="v">{money(kpis.expectedCents)}</div></div>
          <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.matched')}</div><div className="v" style={{ color: '#2E9E54' }}>{money(kpis.actualMatchedCents)}</div></div>
          <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.settlements')}</div><div className="v">{kpis.settlementCount}</div></div>
          <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.missing_deposits')}</div><div className="v" style={{ color: kpis.missingDeposits ? '#C0392B' : undefined }}>{kpis.missingDeposits}</div></div>
          <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.net_difference')}</div><div className="v">{signed(kpis.differenceCents)}</div></div>
        </div>
      ) : null}

      {stepUp.prompt}
      {note ? <div className="sub" style={{ color: note.includes('Could not') || note.includes('permission') ? '#C0392B' : '#2E9E54', fontSize: 12.5, marginTop: 8 }}>{note}</div> : null}

      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
        <div className="p-h" style={{ padding: '14px 14px 0' }}>{t('pos.settlements_deposits')}</div>
        {rows.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.no_settlements_yet_settlement_batches_from_eonf')}</div> : (
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              <table className="tbl">
                <thead><tr><th>{t('pos.settlement')}</th><th>{t('pos.date')}</th><th>{t('pos.expected')}</th><th>{t('pos.actual')}</th><th>{t('pos.difference')}</th><th>{t('pos.status')}</th><th>{t('pos.confidence_3')}</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.settlementId}>
                    <td style={{ fontWeight: 700 }}>{r.processorType ? r.processorType.charAt(0).toUpperCase() + r.processorType.slice(1) : t('pos.settlement')}</td>
                    <td className="sub" style={{ fontSize: 12.5 }}>{fmtDate(r.settledAt)}</td>
                    <td>{money(r.expectedNetCents)}</td>
                    <td>{r.actualCents == null ? '—' : money(r.actualCents)}</td>
                    <td style={{ color: r.differenceCents === 0 ? undefined : '#C0392B' }}>{signed(r.differenceCents)}</td>
                    <td>{chip(r.status)}</td>
                    <td className="sub" style={{ fontSize: 12.5 }}>{r.status.startsWith('matched') ? `${Math.round(r.confidence * 100)}%` : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <section className="panel">
          <div className="p-h">{t('pos.bank_accounts')}</div>
          {banks.length === 0 ? <div className="state" style={{ padding: '8px 0' }}>{t('pos.no_bank_accounts_yet')}</div> : (
            <div style={{ marginTop: 6 }}>{banks.map((b) => (
              <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #EEE6D8', fontSize: 13 }}>
                <span style={{ fontWeight: 700 }}>{b.nickname}</span>
                <span className="sub">{b.bankName ? b.bankName + ' ' : ''}••{b.accountLast4 || '????'}</span>
              </div>
            ))}</div>
          )}
          <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
            <input value={bNick} onChange={(e) => setBNick(e.target.value)} placeholder={t('pos.nickname_e_g_main_checking')} style={{ padding: 7 }} />
            <div className="flex flex-col sm:flex-row gap-1.5">
              <input value={bName} onChange={(e) => setBName(e.target.value)} placeholder={t('pos.bank_name')} className="w-full sm:flex-1" style={{ padding: 7 }} />
              <input value={bLast4} onChange={(e) => setBLast4(e.target.value)} placeholder={t('pos.last_4')} maxLength={4} className="w-full sm:w-[80px]" style={{ padding: 7 }} />
            </div>
            <button className="btn ghost" onClick={addBank} style={{ justifySelf: 'start' }}>{t('pos.add_account')}</button>
          </div>
        </section>

        <section className="panel">
          <div className="p-h">{t('pos.record_a_deposit')}</div>
          <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
            <select value={dAcct} onChange={(e) => setDAcct(e.target.value)} style={{ padding: 7 }}>
              <option value="">{t('pos.select_bank_account')}</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.nickname} ••{b.accountLast4 || '????'}</option>)}
            </select>
            <div className="flex flex-col sm:flex-row gap-1.5">
              <input value={dAmt} onChange={(e) => setDAmt(e.target.value)} placeholder={t('pos.amount_e_g_100_00')} inputMode="decimal" className="w-full sm:flex-1" style={{ padding: 7 }} />
              <input type="date" value={dDate} onChange={(e) => setDDate(e.target.value)} className="w-full sm:w-auto" style={{ padding: 7 }} />
            </div>
            <input value={dRef} onChange={(e) => setDRef(e.target.value)} placeholder={t('pos.bank_reference_optional')} style={{ padding: 7 }} />
            <button className="btn ghost" onClick={addDeposit} style={{ justifySelf: 'start' }}>{t('pos.record_deposit')}</button>
          </div>
        </section>
      </div>

      {unmatched.length > 0 ? (
        <section className="panel" style={{ marginTop: 12 }}>
          <div className="p-h">{t('pos.unmatched_deposits')}</div>
          <div className="sub" style={{ fontSize: 12, margin: '4px 0 8px' }}>{t('pos.deposits_not_yet_matched_to_a_1jm0')}</div>
          {unmatched.map((d) => (
            <div key={d.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-2 border-b border-[#EEE6D8] gap-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                <span style={{ fontWeight: 700 }}>{money(d.amountCents)}</span>
                <span className="sub" style={{ fontSize: 12.5 }}>{fmtDate(d.depositDate)}{d.reference ? ` · ${d.reference}` : ''}</span>
              </div>
              {missingRows.length > 0 ? (
                <select defaultValue="" onChange={(e) => e.target.value && link(d.id, e.target.value)} className="w-full sm:w-auto" style={{ padding: 6, fontSize: 12.5 }}>
                  <option value="">{t('pos.link_to_settlement')}</option>
                  {missingRows.map((r) => <option key={r.settlementId} value={r.settlementId}>{money(r.expectedNetCents)} · {fmtDate(r.settledAt)}</option>)}
                </select>
              ) : <span className="sub w-full sm:w-auto" style={{ fontSize: 12 }}>{t('pos.no_open_settlements')}</span>}
            </div>
          ))}
        </section>
      ) : null}

      <div className="sub" style={{ fontSize: 12, marginTop: 12, maxWidth: 720, lineHeight: 1.6 }}>
        {t('pos.this_reconciles_what_your_processor_settled_1dyn')}
      </div>

      </>)}
    </div>
  );
}
