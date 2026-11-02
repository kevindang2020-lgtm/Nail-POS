// TechPayStatementsPanel.tsx — the technician's weekly pay statements (Weekly Technician Paycheck mandate §15, Oct 21 2026).
// The current week (ESTIMATED until the owner approves it, then the approved, locked statement), the history, how each
// week is paid (check / cash) and what is still unpaid, and the cash the salon prepared for me: I confirm when I receive
// it, or tell the manager it is wrong. Only my own statements — the server derives who I am from the session; a
// manager's private notes are never sent here.
import { useCallback, useEffect, useState } from 'react';
import { techApi, type TechPayStatements, type TechPayStatementDetail, type PaycheckPayout } from '../api/techApi';
import { useTechStream } from '../lib/useTechStream';
import { centsToUsd } from '@aipowersalon/money';
import { fmtYmd, getLanguage, t as tr } from '@aipowersalon/mobile-sdk';
import '../i18n/catalog';

const usd = (cents: number) => centsToUsd(Number(cents || 0));
const day = (ymd: string | null) => (ymd ? fmtYmd(ymd, undefined, ymd) : '');
const STAGE: Record<string, string> = { manager_review: 'Estimated · manager reviewing', owner_review: 'Estimated · waiting for owner approval', approved: 'Approved' };
const box: React.CSSProperties = { border: '1px solid var(--tech-line,#E7DBC6)', borderRadius: 12, padding: '12px 14px', background: 'var(--tech-surface,#fff)' };
/** §15.3: the mandate's statement layout names each payout's LIFECYCLE word — "Check #4812 · DELIVERED", "Cash · ACKNOWLEDGED" */
const payoutLine = (x: PaycheckPayout): string => {
  if (x.method === 'check') return tr(`tech.pay.check.${x.checkStatus ?? 'planned'}`, { n: x.checkNumber ?? '—' });
  if (x.method === 'cash') return tr(`tech.pay.cash.${x.cashStatus ?? 'planned'}`);
  const method = x.method.replace(/_/g, ' ');
  return tr(x.status === 'paid' ? 'tech.pay.other.paid' : x.status === 'canceled' ? 'tech.pay.other.canceled' : 'tech.pay.other.pending', { method });
};
/** §11.5: the manager's QR handoff code — scanned with the browser's BarcodeDetector when the phone has one, else typed */
async function scanHandoffCode(): Promise<string | null> {
  const w = window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect(src: ImageBitmapSource): Promise<Array<{ rawValue: string }>> } };
  if (!w.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) return null;
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  try {
    const video = document.createElement('video'); video.srcObject = stream; video.muted = true; await video.play();
    const det = new w.BarcodeDetector({ formats: ['qr_code'] });
    for (let i = 0; i < 100; i++) {
      const codes = await det.detect(video).catch(() => []);
      const hit = codes.map((c) => c.rawValue).find((v) => /^aps-cash:/.test(v));
      if (hit) return hit.split(':')[2] ?? null;
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  } finally { for (const tr0 of stream.getTracks()) tr0.stop(); }
}

function CashCard({ x, onDone }: { x: PaycheckPayout; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await fn(); onDone(); } catch (e: any) { setErr(e?.message || 'That did not work.'); } finally { setBusy(false); } };
  return (
    <div style={{ ...box, borderColor: 'var(--tech-gold,#B8925A)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div><div style={{ fontWeight: 700 }}>Cash pay {usd(x.amountCents)}</div><div className="tech-muted" style={{ fontSize: 12 }}>{x.cashStatus === 'disputed' ? 'You reported a problem — the manager will follow up.' : 'Count it, then confirm you received it.'}</div></div>
      </div>
      {err ? <div role="alert" style={{ color: 'var(--tech-danger,#C0492F)', fontSize: 13, marginTop: 6 }}>{err}</div> : null}
      {x.cashStatus !== 'disputed' ? <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input aria-label={tr('tech.pay.handoffCode')} placeholder={tr('tech.pay.handoffCode')} value={code} maxLength={16} onChange={(e) => setCode(e.target.value.toUpperCase())} title={tr('tech.pay.handoffCodeHint')} style={{ width: 150, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--tech-line,#E7DBC6)', fontFamily: 'inherit' }} />
        <button className="tech-link" disabled={busy} onClick={() => run(async () => { const v = await scanHandoffCode(); if (v) setCode(v); else throw new Error(tr('tech.pay.scanUnavailable')); })}>{tr('tech.pay.scan')}</button>
        <button className="tech-btn" disabled={busy} onClick={() => run(() => techApi.acknowledgeCash(x.id, code.trim() || null))}>I received it</button>
        {x.cashStatus === 'handed_off' ? <button className="tech-link" disabled={busy} onClick={() => setDisputing(!disputing)}>Something is wrong</button> : null}
      </div> : null}
      {disputing ? <div style={{ marginTop: 8 }}>
        <textarea aria-label="What is wrong" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What is wrong with the cash?" style={{ width: '100%', boxSizing: 'border-box' }} />
        <button className="tech-btn" disabled={busy || reason.trim().length < 3} onClick={() => run(() => techApi.disputeCash(x.id, reason.trim()))}>Tell the manager</button>
      </div> : null}
    </div>
  );
}

/** 17.5: hand a downloaded file to the browser / WebView as a file the technician keeps (no print dialog — a download) */
function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** 17.5 (Oct 27 2026): the approved week's pay stub as a PDF — built by the server from the locked statement */
function PayStubButton({ id, number }: { id: string; number: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const go = async () => {
    setBusy(true); setNote(null);
    try { saveFile(await techApi.payStub(id, getLanguage()), `pay-stub-${number}.pdf`); setNote({ ok: true, text: tr('tech.pay.stub.done') }); }
    catch (e) { setNote({ ok: false, text: (e as { message?: string })?.message || tr('tech.pay.stub.failed') }); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
      <button className="tech-btn" disabled={busy} onClick={go}>{busy ? tr('tech.pay.stub.preparing') : tr('tech.pay.stub.download')}</button>
      {note ? <span role={note.ok ? 'status' : 'alert'} style={{ fontSize: 12, color: note.ok ? 'var(--tech-success,#2E9E54)' : 'var(--tech-danger,#C0492F)' }}>{note.text}</span> : null}
    </div>
  );
}

function StatementDetail({ id }: { id: string }) {
  const [s, setS] = useState<TechPayStatementDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { techApi.payStatement(id).then(setS).catch((e: { message?: string }) => setErr(e?.message || 'Could not load this statement.')); }, [id]);
  if (err) return <div style={{ color: 'var(--tech-danger,#C0492F)', fontSize: 13 }}>{err}</div>;
  if (!s) return <div className="tech-muted" style={{ fontSize: 13 }}>Loading…</div>;
  const row = (label: string, cents: number, strong?: boolean) => (cents || strong ? <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: strong ? 700 : 400 }}><span>{label}</span><span>{usd(cents)}</span></div> : null);
  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div className="tech-muted" style={{ fontSize: 12 }}>{s.salonName} · {s.statementNumber}{s.estimated ? ' · estimated' : ''}</div>
      {row('Service commission', s.serviceCommissionCents)}
      {row('Hourly pay', s.hourlyPayCents)}
      {row('Salary', s.salaryPayCents)}
      {row('Card tips', s.cardTipCents)}
      {row('Cash tips', s.cashTipCents)}
      {row('Retail commission', s.retailCommissionCents)}
      {row('Bonus', s.bonusCents)}
      {row('Guarantee top-up', s.guaranteeTopUpCents)}
      {row('Adjustments', s.positiveAdjustmentsCents)}
      {row('Deductions', -s.deductionsCents)}
      {row('Gross earnings', s.grossEarningsCents, true)}
      {row('Already paid to you', -s.alreadyPaidCents)}
      {row(s.estimated ? 'Estimated pay' : 'Your pay', s.approvedPayableCents, true)}
      {s.branchBreakdown.length > 1 ? s.branchBreakdown.map((b) => <div key={b.branchId ?? 'x'} className="tech-muted" style={{ fontSize: 12 }}>{b.branchName || 'Branch'}: {usd(b.serviceEarningsCents)} · {b.services} services</div>) : null}
      {s.payouts.map((x) => (
        <div key={x.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span>{payoutLine(x)}{x.cashAckMethod ? <span className="tech-muted"> · {tr(`tech.pay.confirmedBy.${x.cashAckMethod}`)}</span> : null}</span>
          <span style={{ fontWeight: 700 }}>{usd(x.amountCents)}</span>
        </div>
      ))}
      {!s.estimated ? <div className="tech-muted" style={{ fontSize: 12 }}>Paid {usd(s.paidCents)} · unpaid {usd(s.unpaidCents)}</div> : null}
      {!s.estimated ? <PayStubButton id={s.id} number={s.statementNumber} /> : null}
    </div>
  );
}

export function TechPayStatementsPanel() {
  const [d, setD] = useState<TechPayStatements | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => { Promise.resolve().then(() => techApi.payStatements()).then((r) => { setD(r); setErr(null); }).catch((e: { message?: string }) => setErr(e?.message || 'Could not load your pay statements.')); }, []);
  useEffect(() => { load(); }, [load]);
  useTechStream((ev) => { if (ev === 'owner_payroll_updated' || ev === 'technician_earnings_updated' || ev === 'poll' || ev === 'reconcile') load(); });
  if (err) return <div style={{ color: 'var(--tech-danger,#C0492F)', fontSize: 14, marginBottom: 12 }}>{err}</div>;
  if (!d) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontWeight: 700, fontSize: 15, margin: '0 0 8px', color: 'var(--tech-text,#2C2118)' }}>Weekly pay statements</div>
      {d.cashWaiting.length ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>{d.cashWaiting.map((x) => <CashCard key={x.id} x={x} onDone={load} />)}</div> : null}
      {d.statements.length === 0 ? <div className="tech-muted" style={{ fontSize: 14 }}>No pay statements yet. Your weekly statement appears here once the manager calculates the week.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {d.statements.map((s) => (
            <div key={s.id} style={box}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{s.label || `${day(s.periodStart)} – ${day(s.periodEnd)}`}</div>
                  <div className="tech-muted" style={{ fontSize: 12 }}>{STAGE[s.stage] ?? s.stage}{s.payDate ? ` · pay day ${day(s.payDate)}` : ''}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{usd(s.amountCents)}</div>
                  {!s.estimated ? <span style={{ fontSize: 11, fontWeight: 700, color: s.unpaidCents ? 'var(--tech-muted,#7A6C57)' : 'var(--tech-success,#2E9E54)' }}>{s.unpaidCents ? `Paid ${usd(s.paidCents)} · unpaid ${usd(s.unpaidCents)}` : 'Paid'}</span> : null}
                </div>
              </div>
              <button className="tech-link" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? 'Hide statement' : 'View statement'}</button>
              {open === s.id ? <StatementDetail id={s.id} /> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
