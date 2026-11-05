import { useEffect, useState } from 'react';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { membershipActionsApi, membershipOversightApi } from '../api/superAdminMembershipsApi';
import { money } from './_chartkit';

// MembershipActionModals — Unit 4 sensitive tenant-oversight actions: Review Duplicate Charges (investigation only, no
// auto-refund), Correct Platform-Level Membership Errors (compensating ledger entry, reason required, originals
// preserved), Disable Abusive/Improperly Configured Programs (permission + reason + impact review, stops new enrollment,
// history preserved).

function Overlay({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div role="dialog" aria-label={title} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.32)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '6vh 16px' }} onClick={onClose}>
      <div className="panel" style={{ width: wide ? 720 : 520, maxHeight: '84vh', overflowY: 'auto', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>{title}</strong>
          <button className="btn ghost" style={{ height: 26 }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
const th = { textAlign: 'left' as const, color: 'var(--muted)', fontSize: 10 };
const okBox = (m: string) => <div style={{ padding: '6px 10px', background: '#E7F2EA', color: '#2F6B43', borderRadius: 8, fontSize: 12 }}>{m}</div>;
const errBox = (m: string) => <div className="state" style={{ color: '#9B2C2C' }}>{m}</div>;

export function DuplicateChargesModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<any[] | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { membershipActionsApi.duplicateCharges().then((d) => setData(d.cases)).catch((e: any) => setErr(e?.message)); }, []);
  return (
    <Overlay title="Review Duplicate Charges" onClose={onClose} wide>
      {err && errBox(err)}
      <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>Detection is an investigation signal only — no refund is taken automatically. Investigate and, if confirmed, refund via the tenant’s normal refund flow.</div>
      {!data ? <div className="state">Loading…</div> : data.length === 0 ? <div className="state">No duplicate-charge cases detected.</div> : (
        <table className="tgrid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
          <thead><tr style={th}><th>Tenant</th><th>Program</th><th>Member</th><th>Amount</th><th>Charges</th><th>Confidence</th><th>Window</th></tr></thead>
          <tbody>{data.map((c, i) => (<tr key={i} style={{ borderTop: '1px solid var(--line)' }}><td>{c.tenant}</td><td>{c.program}</td><td>{c.memberNumber ?? '—'}</td><td>{money(c.amountCents)}</td><td>{c.count}</td><td>{c.confidence}</td><td>{new Date(c.firstAt).toLocaleDateString()} → {new Date(c.lastAt).toLocaleDateString()}</td></tr>))}</tbody>
        </table>
      )}
    </Overlay>
  );
}

export function CorrectErrorsModal({ onClose }: { onClose: () => void }) {
  const [membershipId, setMembershipId] = useState('');
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [quantity, setQuantity] = useState('1'); const [amount, setAmount] = useState(''); const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setErr(null); setMsg(null);
    try {
      const r = await membershipActionsApi.createCorrection({ membershipId: membershipId.trim(), direction, quantity: parseInt(quantity, 10) || 0, amountCents: (parseDollarsToCents(amount || '0') ?? 0), reason: reason.trim() });
      setMsg(`Compensating ${direction} recorded (entry ${r.entryId.slice(0, 8)}). Original records are preserved.`); setMembershipId(''); setAmount(''); setReason('');
    } catch (e: any) { setErr(e?.message || 'Correction failed'); }
  };
  return (
    <Overlay title="Correct Platform-Level Membership Errors" onClose={onClose}>
      {err && errBox(err)} {msg && okBox(msg)}
      <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>Use only for verified platform/migration/calculation errors. This writes a compensating credit-ledger entry and never edits or deletes the original records.</div>
      <div style={{ display: 'grid', gap: 8, fontSize: 12 }}>
        <div><label className="flabel">Membership ID</label><input className="finput" value={membershipId} onChange={(e) => setMembershipId(e.target.value)} placeholder="customer_memberships.id" /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <div><label className="flabel">Direction</label><select className="finput" value={direction} onChange={(e) => setDirection(e.target.value as any)}><option value="credit">Credit (grant)</option><option value="debit">Debit (reverse)</option></select></div>
          <div><label className="flabel">Quantity</label><input className="finput" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
          <div><label className="flabel">Amount (USD)</label><input className="finput" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div>
        </div>
        <div><label className="flabel">Reason (required)</label><input className="finput" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. duplicate credit issued during migration" /></div>
        <div style={{ display: 'flex', gap: 8 }}><button className="btn" onClick={submit}>Record Correction</button><button className="btn ghost" onClick={onClose}>Cancel</button></div>
      </div>
    </Overlay>
  );
}

export function DisableProgramModal({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [programs, setPrograms] = useState<any[] | null>(null);
  const [planId, setPlanId] = useState(''); const [impact, setImpact] = useState<any | null>(null);
  const [reason, setReason] = useState(''); const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { membershipOversightApi.programs({ status: 'active' }).then((d) => setPrograms(d.programs)).catch((e: any) => setErr(e?.message)); }, []);
  useEffect(() => { setImpact(null); if (planId) membershipActionsApi.programImpact(planId).then((d) => setImpact(d.impact)).catch(() => {}); }, [planId]);
  const submit = async () => {
    setErr(null); setMsg(null);
    try { await membershipActionsApi.disableProgram(planId, reason.trim()); setMsg('Program disabled — new enrollment stopped; history preserved.'); onChanged?.(); }
    catch (e: any) { setErr(e?.message || 'Disable failed'); }
  };
  return (
    <Overlay title="Disable Abusive or Improperly Configured Program" onClose={onClose}>
      {err && errBox(err)} {msg && okBox(msg)}
      <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>Disabling stops new enrollment and unsafe future billing. It does not delete the program or any member/payment history.</div>
      {!programs ? <div className="state">Loading…</div> : (
        <div style={{ display: 'grid', gap: 8, fontSize: 12 }}>
          <div><label className="flabel">Program</label><select className="finput" value={planId} onChange={(e) => setPlanId(e.target.value)}><option value="">Select a program…</option>{programs.map((p) => <option key={p.planId} value={p.planId}>{p.tenantName} — {p.name}</option>)}</select></div>
          {impact && (
            <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8, fontSize: 11.5 }}>
              <strong>Impact preview</strong>
              <div className="muted" style={{ marginTop: 4 }}>Active members: {impact.activeMembers} · Trial: {impact.trialMembers} · Past-due: {impact.pastDueMembers} · MRR: {money(impact.mrrCents)} · Credits issued: {impact.creditsIssued}</div>
            </div>
          )}
          <div><label className="flabel">Reason (required)</label><input className="finput" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. duplicate charging / invalid configuration" /></div>
          <div style={{ display: 'flex', gap: 8 }}><button className="btn" disabled={!planId} onClick={submit}>Disable Program</button><button className="btn ghost" onClick={onClose}>Cancel</button></div>
        </div>
      )}
    </Overlay>
  );
}
