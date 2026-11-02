import { useCallback, useEffect, useState } from 'react';
import { techApi, type TechPayroll, type TechPayrollPeriod, type TechPayout, type TechPayrollInquiry } from '../api/techApi';
import { useTechNav } from '../shell/nav';
import { TechAgreementsPanel } from './TechAgreementsPanel';
import { TechPayStatementsPanel } from './TechPayStatementsPanel';
import { useTechStream } from '../lib/useTechStream';
import { centsToUsd } from '@aipowersalon/money';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display
import { fmtYmd } from '@aipowersalon/mobile-sdk';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

// Payroll & Payouts (technician). The signed-in tech's OWN finalized payroll — GET /tech/payroll derives the technician
// from the session and reads the same payroll_periods/payroll_lines the owner/manager Payroll screen produces (no
// recompute, no fabrication). Paid / Unpaid / Total roll-up + payout history, matching the Tech App design. Honest
// loading / empty / error states.
const Back = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>);
const usd = (cents: number) => centsToUsd(Number(cents || 0));
const range = (p: TechPayrollPeriod) => {
  const fmt = (iso: string) => fmtYmd(iso, undefined, iso);
  return p.label || `${fmt(p.periodStart)} – ${fmt(p.periodEnd)}`;
};

function StatCard({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' | 'plain' }) {
  const color = tone === 'ok' ? 'var(--tech-success,#2E9E54)' : tone === 'warn' ? 'var(--tech-danger,#C0492F)' : 'var(--tech-text,#2C2118)';
  return (
    <div style={{ flex: 1, minWidth: 96, border: '1px solid var(--tech-line,#E7DBC6)', borderRadius: 14, padding: '12px 10px', background: 'var(--tech-surface,#fff)', textAlign: 'center' }}>
      <div className="tech-label" style={{ fontSize: 12, color: 'var(--tech-muted,#7A6C57)' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: 'Playfair Display, serif', marginTop: 2 }}>{value}</div>
    </div>
  );
}

/** Payroll wave 2 (§86–§88, §126): one pay period's own earnings, line by line, from the canonical earnings read with
 *  period=pay_period (the salon's zone, the same window payroll uses). */
function PeriodEarnings({ periodId }: { periodId: string }) {
  const [d, setD] = useState<any | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { techApi.earningsCanonical('pay_period', undefined, undefined, periodId).then(setD).catch((e: { message?: string }) => setErr(e?.message || 'Could not load this period.')); }, [periodId]);
  if (err) return <div style={{ color: 'var(--tech-danger,#C0492F)', fontSize: 13 }}>{err}</div>;
  if (!d) return <div className="tech-muted" style={{ fontSize: 13 }}>Loading…</div>;
  const lines: any[] = d.lines ?? [];
  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {lines.length === 0 ? <div className="tech-muted" style={{ fontSize: 13 }}>No services in this pay period.</div> : lines.map((l, i) => (
        <div key={l.ticketId + i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span>{fmtYmd(String(l.completedAt).slice(0, 10), undefined, '')} · {l.serviceName || 'Service'} <span className="tech-muted">{usd(l.lineTotalCents)}</span></span><span style={{ fontWeight: 600 }}>{usd(l.commissionCents)}</span>
        </div>))}
    </div>
  );
}

/** §152: ask about an earning — you can ask, never change the entry. */
function AskAboutPay({ periodId, onSent }: { periodId: string | null; onSent: () => void }) {
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      <textarea aria-label="Your question about this pay" value={msg} onChange={(e) => setMsg(e.target.value)} rows={2} placeholder="What looks wrong? (e.g. a missing tip on June 10)" style={{ border: '1px solid var(--tech-line,#E7DBC6)', borderRadius: 10, padding: 8, fontFamily: 'inherit', fontSize: 14 }} />
      {err && <div role="alert" style={{ color: 'var(--tech-danger,#C0492F)', fontSize: 13 }}>{err}</div>}
      <button className="tech-btn" disabled={busy} onClick={async () => {
        if (msg.trim().length < 3) { setErr('Write your question.'); return; }
        setBusy(true); setErr(null);
        try { await techApi.askAboutPayroll({ message: msg.trim(), ...(periodId ? { periodId, subjectType: 'period' } : {}) }); setMsg(''); onSent(); }
        catch (e: any) { setErr(e?.message || 'Could not send your question.'); } finally { setBusy(false); }
      }}>Send question</button>
    </div>
  );
}

export function TechPayrollScreen() {
  const nav = useTechNav();
  const [data, setData] = useState<TechPayroll | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payouts, setPayouts] = useState<TechPayout[]>([]);
  const [questions, setQuestions] = useState<TechPayrollInquiry[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);

  const load = useCallback(() => {
    techApi.payroll()
      .then((r) => { setData(r); setError(null); })
      .catch((e: { message?: string }) => setError(e?.message || 'Failed to load your payroll.'));
    techApi.payrollPayouts().then(setPayouts).catch(() => setPayouts([]));
    techApi.payrollInquiries().then(setQuestions).catch(() => setQuestions([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  // Live: refresh when the owner finalizes/pays a period or the tech's earnings change (and on the poll fallback).
  useTechStream((ev) => { if (ev === 'owner_payroll_updated' || ev === 'technician_earnings_updated' || ev === 'poll' || ev === 'reconcile') load(); });

  const periods = data?.periods ?? [];

  return (
    <div style={{ paddingBottom: 90 }}>
      <div className="tech-topbar" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="tech-iconbtn" onClick={() => nav.back()} aria-label="Back" ><Back /></button>
        <h1 className="t-title" style={{ fontSize: 19, margin: 0, color: 'var(--tech-text,#2C2118)' }}>Payroll</h1>
      </div>
      <div className="tech-main-2">
      <TechPayStatementsPanel />

      {error && <div style={{ color: 'var(--tech-danger,#C0492F)', fontSize: 14, marginBottom: 12 }}>{error}</div>}
      {!data && !error && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ flex: 1, minWidth: 96, border: '1px solid var(--tech-line,#E7DBC6)', borderRadius: 14, padding: '12px 10px', background: 'var(--tech-surface,#fff)', textAlign: 'center' }}>
                <div className="tech-skel" style={{ width: 40, height: 14, margin: '0 auto 4px' }} />
                <div className="tech-skel" style={{ width: 60, height: 24, margin: '0 auto' }} />
              </div>
            ))}
          </div>
          <div style={{ fontWeight: 700, fontSize: 15, margin: '0 0 8px', color: 'var(--tech-text,#2C2118)' }}>Payout History</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ border: '1px solid var(--tech-line,#E7DBC6)', borderRadius: 12, padding: '12px 14px', background: 'var(--tech-surface,#fff)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div className="tech-skel" style={{ width: '60%', height: 16 }} />
                  <div className="tech-skel" style={{ width: '40%', height: 14, marginTop: 4 }} />
                </div>
                <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <div className="tech-skel" style={{ width: 60, height: 20 }} />
                  <div className="tech-skel" style={{ width: 40, height: 14, marginTop: 4 }} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {data && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
            <StatCard label="Paid" value={usd(data.paidCents)} tone="ok" />
            <StatCard label="Unpaid" value={usd(data.unpaidCents)} tone="warn" />
            <StatCard label="Total" value={usd(data.totalCents)} tone="plain" />
          </div>

          <div style={{ fontWeight: 700, fontSize: 15, margin: '0 0 8px', color: 'var(--tech-text,#2C2118)' }}>Payout History</div>
          {periods.length === 0 ? (
            <div className="tech-muted" style={{ fontSize: 14 }}>No payroll periods yet. Finalized payouts from your salon will appear here.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {periods.map((p) => {
                const paid = p.status === 'paid';
                return (
                  <div key={p.periodId} style={{ border: '1px solid var(--tech-line,#E7DBC6)', borderRadius: 12, padding: '12px 14px', background: 'var(--tech-surface,#fff)', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--tech-text,#2C2118)' }}>{range(p)}</div>
                      <div className="tech-muted" style={{ fontSize: 12, marginTop: 2 }}>{p.servicesCount} service{p.servicesCount === 1 ? '' : 's'} · tips {usd(p.tipsCents)}{p.adjustmentCents ? ` · adj ${usd(p.adjustmentCents)}` : ''}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--tech-text,#2C2118)' }}>{usd(p.payableCents)}</div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: paid ? 'var(--tech-success,#2E9E54)' : 'var(--tech-muted,#7A6C57)' }}>
                        {paid ? 'Paid' : (p.paidCents ?? 0) > 0 ? `Paid ${usd(p.paidCents ?? 0)} · owed ${usd(p.outstandingCents ?? 0)}` : p.status === 'finalized' ? 'Approved · not paid yet' : 'Draft'}
                      </span>
                    </div>
                    <div style={{ flexBasis: '100%', display: 'flex', gap: 12 }}>
                      <button className="tech-link" onClick={() => setOpenId(openId === p.periodId ? null : p.periodId)}>{openId === p.periodId ? 'Hide earnings' : 'View earnings'}</button>
                      <button className="tech-link" onClick={() => setAsking(asking === p.periodId ? null : p.periodId)}>Ask about this pay</button>
                    </div>
                    {openId === p.periodId ? <div style={{ flexBasis: '100%' }}><PeriodEarnings periodId={p.periodId} /></div> : null}
                    {asking === p.periodId ? <div style={{ flexBasis: '100%' }}><AskAboutPay periodId={p.periodId} onSent={() => { setAsking(null); load(); }} /></div> : null}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
        {data && (
          <>
            <div style={{ fontWeight: 700, fontSize: 15, margin: '18px 0 8px', color: 'var(--tech-text,#2C2118)' }}>Payments received</div>
            {payouts.length === 0 ? <div className="tech-muted" style={{ fontSize: 14 }}>No payments recorded yet.</div> : payouts.map((o) => (
              <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '6px 0', borderBottom: '1px solid var(--tech-line,#E7DBC6)' }}>
                <span>{o.periodLabel || `${fmtYmd(o.periodStart, undefined, o.periodStart)} – ${fmtYmd(o.periodEnd, undefined, o.periodEnd)}`} <span className="tech-muted">· {o.method.replace('_', ' ')} · {o.status}</span></span>
                <span style={{ fontWeight: 700 }}>{usd(o.amountCents)}</span>
              </div>))}
            <div style={{ fontWeight: 700, fontSize: 15, margin: '18px 0 8px', color: 'var(--tech-text,#2C2118)' }}>Your questions</div>
            {questions.length === 0 ? <div className="tech-muted" style={{ fontSize: 14 }}>You have not asked about your pay. Use "Ask about this pay" on a period.</div> : questions.map((q) => (
              <div key={q.id} style={{ fontSize: 14, padding: '6px 0', borderBottom: '1px solid var(--tech-line,#E7DBC6)' }}>
                <div>{q.message} <span className="tech-muted">· {q.status}</span></div>
                {q.response ? <div className="tech-muted" style={{ marginTop: 2 }}>Answer: {q.response}</div> : null}
              </div>))}
          </>
        )}
        <TechAgreementsPanel />
      </div>
    </div>
  );
}
