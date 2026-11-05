import { useEffect, useMemo, useState } from 'react';

const newIdempotencyKey = (): string => globalThis.crypto?.randomUUID?.() ?? `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
import { parseDollarsToCents } from '@aipowersalon/ui';
import { disputesApi, type DisputeDetail, type EvidenceSummary } from '../api/superAdminApi';
import { money } from './_chartkit';

// DisputeActionModals — Unit 3 sensitive workflows:
//  • Submit Evidence to the Processor: eligibility + clean-evidence gate, one idempotency key per open modal (a retry
//    reuses it, so a double-click never creates a duplicate processor submission).
//  • Notify Tenants: recorded notification with delivery result; never carries card data (server scrubs defensively).
//  • Record Outcomes: preserves the processor's authoritative decision; marking won/lost without a processor result is a
//    manual override that requires a reason (server enforces the override permission).

function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div role="dialog" aria-label={title} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.32)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '6vh 16px' }} onClick={onClose}>
      <div className="panel" style={{ width: 520, maxHeight: '84vh', overflowY: 'auto', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>{title}</strong>
          <button className="btn ghost" style={{ height: 26 }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SubmitEvidenceModal({ disputeRef, onClose, onChanged }: { disputeRef: string; onClose: () => void; onChanged?: () => void }) {
  const [evidence, setEvidence] = useState<EvidenceSummary[] | null>(null);
  const [idempotencyKey] = useState(() => (globalThis.crypto?.randomUUID?.() ?? `key-${Date.now()}`));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { disputesApi.evidence(disputeRef).then((d) => setEvidence((d as any).evidence)).catch(() => setEvidence([])); }, [disputeRef]);
  const clean = (evidence ?? []).filter((e) => e.scanStatus === 'clean' && e.reviewStatus !== 'rejected');

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await disputesApi.submit(disputeRef, { idempotencyKey });
      setMsg(r.idempotent ? `Already submitted (idempotent) — processor ref ${r.submission.processorRef}.` : `Submitted ${r.manifestCount} item(s) to the processor — result: ${r.submission.result}.`);
      onChanged?.();
    } catch (e: any) { setErr(e?.message || 'Submission failed'); }
    finally { setBusy(false); }
  };

  return (
    <Overlay title={`Submit Evidence to the Processor — ${disputeRef}`} onClose={onClose}>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      {msg && <div style={{ padding: '6px 10px', background: '#E7F2EA', color: '#2F6B43', borderRadius: 8, fontSize: 12 }}>{msg}</div>}
      <div style={{ display: 'grid', gap: 10, fontSize: 12 }}>
        <div>Clean, non-rejected evidence ready to submit: <strong>{clean.length}</strong></div>
        {evidence && clean.length === 0 && <div className="state" style={{ color: '#9B2C2C' }}>No clean evidence yet — upload and review evidence first.</div>}
        <ul style={{ margin: 0, paddingLeft: 18 }}>{clean.map((e) => <li key={e.id}>{e.evidenceType} — {e.fileName} <span className="muted">({e.reviewStatus})</span></li>)}</ul>
        <div className="muted" style={{ fontSize: 11 }}>Submission is idempotent for this attempt (key {idempotencyKey.slice(0, 8)}…): a retry will not create a duplicate processor submission. The deadline and eligibility are validated server-side.</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" disabled={busy || (evidence != null && clean.length === 0)} onClick={submit}>{busy ? 'Submitting…' : 'Submit to Processor'}</button>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </Overlay>
  );
}

export function NotifyTenantModal({ disputeRef, tenantName, onClose, onChanged }: { disputeRef: string; tenantName: string; onClose: () => void; onChanged?: () => void }) {
  const [channel, setChannel] = useState('in_app');
  const [subject, setSubject] = useState(`Action needed on dispute ${disputeRef}`);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await disputesApi.notifyTenant(disputeRef, { channel, subject, body, idempotencyKey: `${disputeRef}:${channel}:${subject}:${body}` });
      setMsg(r.idempotent ? 'This exact notification was already sent (idempotent).' : `Notification recorded — ${r.notification.channel}, ${r.notification.deliveryStatus}.`);
      onChanged?.();
    } catch (e: any) { setErr(e?.message || 'Notification failed'); }
    finally { setBusy(false); }
  };

  return (
    <Overlay title={`Notify Tenant — ${disputeRef}`} onClose={onClose}>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      {msg && <div style={{ padding: '6px 10px', background: '#E7F2EA', color: '#2F6B43', borderRadius: 8, fontSize: 12 }}>{msg}</div>}
      <div style={{ display: 'grid', gap: 10, fontSize: 12 }}>
        <div className="muted">Recipient tenant: <strong style={{ color: 'inherit' }}>{tenantName}</strong></div>
        <div><label className="flabel">Channel</label><select className="finput" value={channel} onChange={(e) => setChannel(e.target.value)}><option value="in_app">In-app</option><option value="email">Email</option><option value="sms">SMS</option></select></div>
        <div><label className="flabel">Subject</label><input className="finput" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div><label className="flabel">Message</label><textarea className="finput" style={{ minHeight: 70 }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Describe the required action and missing items…" /></div>
        <div className="muted" style={{ fontSize: 11 }}>Notifications are recorded with delivery status and never include card data.</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send Notification'}</button>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </Overlay>
  );
}

const OUTCOME_OPTIONS = ['won', 'lost', 'partially_won', 'withdrawn', 'reversed', 'expired', 'cancelled', 'reopened'];

export function RecordOutcomeModal({ dispute, onClose, onChanged }: { dispute: DisputeDetail; onClose: () => void; onChanged?: () => void }) {
  const [result, setResult] = useState('won');
  const [fundsRecovered, setFundsRecovered] = useState('');
  const [decisionReason, setDecisionReason] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const noAuthoritative = ['none', 'under_review', 'unknown'].includes(dispute.processorDecision);
  const decisive = ['won', 'lost', 'partially_won'].includes(result);
  const isOverride = noAuthoritative && decisive;

  // One Idempotency-Key per distinct submission: a retry of the SAME values (a lost response, a double click) reuses it
  // and the server records the outcome once; changing any value makes a new submission.
  const submissionKey = useMemo(() => newIdempotencyKey(), [result, fundsRecovered, decisionReason, overrideReason]);
  const submit = async () => {
    if (isOverride && !overrideReason.trim()) { setErr('A manual override requires a reason.'); return; }
    setBusy(true); setErr(null);
    try {
      const cents = (parseDollarsToCents(fundsRecovered || '0') ?? 0);
      const r = await disputesApi.recordOutcome(dispute.disputeReference, { result, fundsRecoveredCents: Number.isFinite(cents) ? cents : 0, decisionReason: decisionReason || undefined, overrideReason: overrideReason || undefined }, submissionKey);
      setMsg(`Outcome recorded${r.manualOverride ? ' (manual override)' : ''} — new status: ${r.outcome.newStatus}.`);
      onChanged?.();
    } catch (e: any) { setErr(e?.message || 'Failed to record outcome'); }
    finally { setBusy(false); }
  };

  return (
    <Overlay title={`Record Outcome — ${dispute.disputeReference}`} onClose={onClose}>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      {msg && <div style={{ padding: '6px 10px', background: '#E7F2EA', color: '#2F6B43', borderRadius: 8, fontSize: 12 }}>{msg}</div>}
      <div style={{ display: 'grid', gap: 10, fontSize: 12 }}>
        <div className="muted">Processor decision on record: <strong style={{ color: 'inherit' }}>{dispute.processorDecision === 'none' ? 'None' : dispute.processorDecision}</strong> (preserved)</div>
        <div><label className="flabel">Result</label><select className="finput" value={result} onChange={(e) => setResult(e.target.value)}>{OUTCOME_OPTIONS.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}</select></div>
        <div><label className="flabel">Funds recovered (USD)</label><input className="finput" inputMode="decimal" value={fundsRecovered} onChange={(e) => setFundsRecovered(e.target.value)} placeholder="0.00" /></div>
        <div><label className="flabel">Decision reason (optional)</label><input className="finput" value={decisionReason} onChange={(e) => setDecisionReason(e.target.value)} /></div>
        {isOverride && (
          <div style={{ padding: '8px 10px', background: '#FBF1E3', border: '1px solid #EED9B8', borderRadius: 8 }}>
            <div style={{ color: '#9A6114', fontWeight: 600, marginBottom: 4 }}>⚠ Manual override</div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>Marking this dispute {result.replace(/_/g, ' ')} without an authoritative processor result requires a reason. The original processor state is preserved.</div>
            <input className="finput" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Override reason (required)…" />
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Recording…' : 'Record Outcome'}</button>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </Overlay>
  );
}

const STATE_LABEL: Record<string, string> = { more_than_7_days: 'More than 7 days', approaching: 'Approaching', due_soon: 'Due soon', due_today: 'Due today', overdue: 'Overdue', submitted: 'Submitted', closed: 'Closed', unknown: 'Unknown' };
const stateTone = (s: string): [string, string] => s === 'overdue' ? ['#FBEAEA', '#9B2C2C'] : s === 'due_today' ? ['#FBEAEA', '#9B2C2C'] : s === 'due_soon' ? ['#FBF1E3', '#9A6114'] : s === 'approaching' ? ['#FBF1E3', '#9A6114'] : s === 'submitted' ? ['#E7EFF7', '#2B5E8C'] : s === 'closed' ? ['#E7F2EA', '#2F6B43'] : ['#EEE', '#555'];

const BUCKETS: { key: string; label: string }[] = [
  { key: '', label: 'All open' }, { key: 'due_today', label: 'Due today' }, { key: 'due_24h', label: 'Due 24h' },
  { key: 'due_48h', label: 'Due 48h' }, { key: 'due_3d', label: 'Due 3d' }, { key: 'due_7d', label: 'Due 7d' }, { key: 'overdue', label: 'Overdue' },
];

export function TrackDeadlinesModal({ onClose, onOpenDispute }: { onClose: () => void; onOpenDispute?: (ref: string) => void }) {
  const [bucket, setBucket] = useState('');
  const [missingEvidence, setMissingEvidence] = useState(false);
  const [notNotified, setNotNotified] = useState(false);
  const [highRisk, setHighRisk] = useState(false);
  const [ws, setWs] = useState<import('../api/superAdminApi').DeadlineWorkspace | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    const q: Record<string, unknown> = {};
    if (bucket) q.bucket = bucket;
    if (missingEvidence) q.missingEvidence = 'true';
    if (notNotified) q.tenantNotified = 'false';
    if (highRisk) q.highRisk = 'true';
    let live = true;
    disputesApi.deadlines(q).then((d) => { if (live) setWs(d as any); }).catch((e: any) => { if (live) setErr(e?.message || 'Failed to load'); });
    return () => { live = false; };
  }, [bucket, missingEvidence, notNotified, highRisk]);

  return (
    <div role="dialog" aria-label="Track Deadlines" style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.32)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '5vh 16px' }} onClick={onClose}>
      <div className="panel" style={{ width: 860, maxHeight: '86vh', overflowY: 'auto', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>Track Deadlines</strong>
          <button className="btn ghost" style={{ height: 26 }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
        {ws && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8, fontSize: 11 }}>
            {BUCKETS.map((b) => <button key={b.key} className={bucket === b.key ? 'btn' : 'btn ghost'} style={{ height: 26 }} onClick={() => setBucket(b.key)}>{b.label}{b.key && ws.summary[b.key] != null ? ` (${ws.summary[b.key]})` : ''}</button>)}
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, fontSize: 11.5, marginBottom: 8 }}>
          <label><input type="checkbox" checked={missingEvidence} onChange={(e) => setMissingEvidence(e.target.checked)} /> Missing evidence</label>
          <label><input type="checkbox" checked={notNotified} onChange={(e) => setNotNotified(e.target.checked)} /> Tenant not notified</label>
          <label><input type="checkbox" checked={highRisk} onChange={(e) => setHighRisk(e.target.checked)} /> High-risk</label>
          {ws && <span className="muted" style={{ marginLeft: 'auto' }}>Reminders due: <strong style={{ color: '#9A6114' }}>{ws.remindersDue}</strong></span>}
        </div>
        {!ws ? <div className="state">Loading deadlines…</div> : ws.rows.length === 0 ? <div className="state">No disputes match this deadline filter.</div> : (
          <table className="tgrid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}><th>Dispute</th><th>Tenant</th><th>Amount</th><th>Deadline</th><th>Days</th><th>State</th><th>Evidence</th><th>Notified</th><th>Risk</th></tr></thead>
            <tbody>{ws.rows.map((r) => (
              <tr key={r.disputeReference} onClick={() => onOpenDispute?.(r.disputeReference)} style={{ borderTop: '1px solid var(--line)', cursor: onOpenDispute ? 'pointer' : undefined }}>
                <td style={{ fontWeight: 600 }}>{r.disputeReference}{r.reminderDue && <span title="Reminder due" style={{ color: '#9A6114' }}> ●</span>}</td>
                <td>{r.tenantName}</td><td>{money(r.amountCents)}</td>
                <td>{r.dueBy ? new Date(r.dueBy).toLocaleDateString() : '—'}</td>
                <td style={{ color: (r.daysRemaining ?? 9) <= 1 ? '#9B2C2C' : undefined }}>{r.daysRemaining == null ? '—' : `${r.daysRemaining}d`}</td>
                <td><span style={{ background: stateTone(r.deadlineState)[0], color: stateTone(r.deadlineState)[1], padding: '1px 7px', borderRadius: 999, fontSize: 10.5, fontWeight: 600 }}>{STATE_LABEL[r.deadlineState] ?? r.deadlineState}</span></td>
                <td>{r.missingEvidence ? <span style={{ color: '#9B2C2C' }}>Missing</span> : 'OK'}</td>
                <td>{r.tenantNotified ? 'Yes' : <span style={{ color: '#9A6114' }}>No</span>}</td>
                <td>{r.riskLevel}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>States are computed from the processor deadline using backend-authoritative time. Reminder policy is idempotent per (dispute, state); the background reminder runner is modeled in this environment.</div>
      </div>
    </div>
  );
}

const RISK_LEVELS = ['low', 'medium', 'high', 'critical', 'under_review'];

export function AnalyzePatternsModal({ onClose }: { onClose: () => void }) {
  const [p, setP] = useState<import('../api/superAdminApi').DisputePatterns | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { disputesApi.patterns().then((d) => setP(d as any)).catch((e: any) => setErr(e?.message || 'Failed to load')); }, []);
  const bar = (n: number, max: number) => <div style={{ height: 6, borderRadius: 3, background: '#EFE7D8', width: '100%' }}><div style={{ height: 6, borderRadius: 3, background: '#A96F22', width: `${max ? Math.round((n / max) * 100) : 0}%` }} /></div>;
  const maxReason = Math.max(1, ...(p?.byReason ?? []).map((r) => r.count));

  return (
    <div role="dialog" aria-label="Analyze Dispute Patterns" style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.32)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '5vh 16px' }} onClick={onClose}>
      <div className="panel" style={{ width: 760, maxHeight: '86vh', overflowY: 'auto', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>Analyze Dispute Patterns</strong>
          <button className="btn ghost" style={{ height: 26 }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
        {!p ? <div className="state">Loading patterns…</div> : (
          <div style={{ display: 'grid', gap: 14, fontSize: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {[['Total disputes', String(p.totals.count)], ['Win rate', `${p.totals.winRatePct}%`], ['Loss rate', `${p.totals.lossRatePct}%`], ['Recovery rate', `${p.totals.recoveryRatePct}%`]].map(([l, v]) => (
                <div key={l} style={{ border: '1px solid var(--line)', borderRadius: 9, padding: 8 }}><div className="muted" style={{ fontSize: 10.5 }}>{l}</div><div style={{ fontSize: 16, fontWeight: 700 }}>{v}</div></div>
              ))}
            </div>
            <div>
              <strong style={{ fontSize: 12.5 }}>By reason code</strong>
              <div style={{ display: 'grid', gap: 5, marginTop: 6 }}>{p.byReason.map((r) => (
                <div key={r.code} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 40px 90px', gap: 8, alignItems: 'center' }}><span>{r.code}</span>{bar(r.count, maxReason)}<span style={{ textAlign: 'right' }}>{r.count}</span><span style={{ textAlign: 'right' }} className="muted">{money(r.amountCents)}</span></div>
              ))}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <strong style={{ fontSize: 12.5 }}>By tenant</strong>
                <table className="tgrid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, marginTop: 6 }}>
                  <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}><th>Tenant</th><th>Open</th><th>At risk</th><th>W/L</th></tr></thead>
                  <tbody>{p.byTenant.map((t) => (<tr key={t.tenant} style={{ borderTop: '1px solid var(--line)' }}><td>{t.tenant}</td><td>{t.open}</td><td>{money(t.amountAtRiskCents)}</td><td>{t.won}/{t.lost}</td></tr>))}</tbody>
                </table>
              </div>
              <div>
                <strong style={{ fontSize: 12.5 }}>Card presence &amp; processor</strong>
                <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
                  <div>Card-present fraud: <strong>{p.byCardPresence.cardPresent}</strong></div>
                  <div>Card-absent fraud: <strong>{p.byCardPresence.cardAbsent}</strong></div>
                  <div>Other reasons: <strong>{p.byCardPresence.other}</strong></div>
                  <div style={{ marginTop: 6 }}>{p.byProcessor.map((pr) => <span key={pr.processor} className="muted">{pr.processor}: {pr.count}&nbsp;&nbsp;</span>)}</div>
                </div>
              </div>
            </div>
            <div className="muted" style={{ fontSize: 11 }}>Aggregates only. Patterns are for review and do not by themselves establish fault by any tenant, employee, or customer.</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function FlagRiskModal({ onClose, onChanged, preselectTenantId }: { onClose: () => void; onChanged?: () => void; preselectTenantId?: string }) {
  const [merchants, setMerchants] = useState<import('../api/superAdminApi').MerchantRisk[] | null>(null);
  const [tenantId, setTenantId] = useState(preselectTenantId ?? '');
  const [riskLevel, setRiskLevel] = useState('high');
  const [riskReason, setRiskReason] = useState('');
  const [recommendedAction, setRecommendedAction] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => disputesApi.highRiskMerchants().then((d) => { setMerchants(d as any); if (!tenantId && (d as any).length) setTenantId((d as any)[0].tenantId); }).catch((e: any) => setErr(e?.message || 'Failed to load'));
  useEffect(() => { load(); }, []);  
  const sel = (merchants ?? []).find((m) => m.tenantId === tenantId);
  useEffect(() => { if (sel) setRiskLevel(sel.suggestedRiskLevel); }, [tenantId]);  

  const flag = async () => {
    if (!tenantId) { setErr('Choose a tenant.'); return; }
    if (!riskReason.trim()) { setErr('A risk reason is required.'); return; }
    setBusy(true); setErr(null);
    try { const r = await disputesApi.flagMerchantRisk(tenantId, { riskLevel, riskReason, recommendedAction: recommendedAction || undefined }); setMsg(`Flagged ${r.merchant.tenantName} as ${r.merchant.riskLevel}. Recorded for review — processing is not suspended from this page.`); onChanged?.(); load(); }
    catch (e: any) { setErr(e?.message || 'Flagging failed'); }
    finally { setBusy(false); }
  };

  return (
    <div role="dialog" aria-label="Flag High-Risk Merchants" style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.32)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '5vh 16px' }} onClick={onClose}>
      <div className="panel" style={{ width: 720, maxHeight: '86vh', overflowY: 'auto', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>Flag High-Risk Merchants</strong>
          <button className="btn ghost" style={{ height: 26 }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
        {msg && <div style={{ padding: '6px 10px', background: '#E7F2EA', color: '#2F6B43', borderRadius: 8, fontSize: 12 }}>{msg}</div>}
        {!merchants ? <div className="state">Loading merchants…</div> : (
          <div style={{ display: 'grid', gap: 12, fontSize: 12 }}>
            <table className="tgrid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}><th>Tenant</th><th>Open</th><th>Lost</th><th>At risk</th><th>Current</th><th>Suggested</th></tr></thead>
              <tbody>{merchants.map((m) => (
                <tr key={m.tenantId} onClick={() => setTenantId(m.tenantId)} style={{ borderTop: '1px solid var(--line)', cursor: 'pointer', background: tenantId === m.tenantId ? 'var(--cream2,#FAF6EF)' : undefined }}>
                  <td>{m.tenantName}</td><td>{m.openDisputes}</td><td>{m.lostDisputes}</td><td>{money(m.amountAtRiskCents)}</td><td>{m.riskLevel}</td><td style={{ fontWeight: 600 }}>{m.suggestedRiskLevel}</td>
                </tr>
              ))}</tbody>
            </table>
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'grid', gap: 8 }}>
              <strong style={{ fontSize: 12.5 }}>Flag {sel ? sel.tenantName : 'merchant'} for review</strong>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div><label className="flabel">Risk level</label><select className="finput" value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)}>{RISK_LEVELS.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}</select></div>
                <div><label className="flabel">Recommended action</label><input className="finput" value={recommendedAction} onChange={(e) => setRecommendedAction(e.target.value)} placeholder="e.g. Require evidence on all disputes" /></div>
              </div>
              <div><label className="flabel">Risk reason (required)</label><textarea className="finput" style={{ minHeight: 56 }} value={riskReason} onChange={(e) => setRiskReason(e.target.value)} placeholder="Describe the supporting signals for this risk review…" /></div>
              <div className="muted" style={{ fontSize: 11 }}>Flagging records a risk review with reason, reviewer, and next-review date. It does not suspend processing — that is a separate approved workflow.</div>
              <div style={{ display: 'flex', gap: 8 }}><button className="btn" disabled={busy} onClick={flag}>{busy ? 'Flagging…' : 'Flag for Risk Review'}</button><button className="btn ghost" onClick={onClose}>Close</button></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
