// ScheduleProposalsScreen.tsx — BUILD_PLAN Phase 7 (ai_scheduling_optimizer): /appointments/proposals. When the salon
// would like to move one of the customer's appointments (a better time or another technician), the customer sees the
// original and the proposed time side by side and answers: approve the new time, or keep the original. The original stays
// booked until the customer approves (and the salon applies it). Answers carry the proposal's version — if it changed in
// the meantime (409) the page reloads and says so. Only customer-safe text — never the salon's internal measures.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerScheduleProposalsApi as api, isPendingProposal, type CustomerScheduleProposal } from '../api/customerScheduleProposalsApi';
import { fmtYmd, fmtDateTime } from '@aipowersalon/mobile-sdk';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

const dateText = (ymd: string) => fmtYmd(ymd, { weekday: 'short', month: 'short', day: 'numeric' }, ymd);
const timeText = (hm: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(hm || ''); if (!m) return hm; const h = Number(m[1]); return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`; };
const whenText = (iso: string | null) => (iso ? fmtDateTime(iso) || null : null);
const STATUS: Record<string, string> = {
  customer_approved: 'You approved the new time — the salon will confirm the change.', customer_rejected: 'You kept your original time.',
  expired: 'This suggestion expired — your original time is unchanged.', applied: 'Your appointment was moved to the new time.', withdrawn: 'The salon withdrew this suggestion — your original time is unchanged.',
};

function Slot({ label, slot, testId, strong }: { label: string; slot: CustomerScheduleProposal['original']; testId: string; strong?: boolean }) {
  return (
    <div data-testid={testId} style={{ flex: 1, minWidth: 130, padding: 10, borderRadius: 12, background: strong ? 'var(--customer-purple-100)' : 'transparent', border: strong ? 0 : '1px solid var(--customer-border, #E5E1F0)' }}>
      <div className="cust-sub" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontWeight: 700 }}>{dateText(slot.date)} · {timeText(slot.startTime)}</div>
      {slot.technicianName ? <div className="cust-sub">with {slot.technicianName}</div> : null}
    </div>
  );
}

export function ScheduleProposalsScreen() {
  const nav = useNavigate();
  const [items, setItems] = useState<CustomerScheduleProposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => api.list().then((r) => { setItems(r); setError(null); }).catch((e: any) => setError(e?.message || 'Could not load your appointment changes.')), []);
  useEffect(() => { void load(); }, [load]);

  const answer = async (p: CustomerScheduleProposal, approve: boolean) => {
    setBusy(p.id); setMsg(null);
    try {
      const r = approve ? await api.approve(p.id, p.version) : await api.reject(p.id, p.version);
      const next = r?.proposal;
      if (next) setItems((cur) => (cur || []).map((x) => (x.id === p.id ? next : x)));
      setMsg({ ok: true, text: approve ? 'Thanks — you approved the new time. The salon will confirm the change.' : 'Got it — your original time stays booked.' });
      if (!next) await load();
    } catch (e: any) {
      if (e?.status === 409) { setMsg({ ok: false, text: 'This suggestion changed a moment ago — here is the latest. Please check it again.' }); await load(); }
      else setMsg({ ok: false, text: e?.message || 'That did not go through. Please try again.' });
    } finally { setBusy(null); }
  };

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, minHeight: '100%' }}>
      <button onClick={() => nav('/appointments')} className="cust-btn-ghost" style={{ alignSelf: 'flex-start' }}>‹ My Appointments</button>
      <h1 className="cust-h1">Suggested time changes</h1>
      {msg ? <div role={msg.ok ? 'status' : 'alert'} className="cust-card" style={{ padding: 12, border: 0, background: msg.ok ? 'var(--customer-green-light, #E6F4EA)' : 'var(--customer-red-light)', color: msg.ok ? 'inherit' : 'var(--customer-red)' }}>{msg.text}</div> : null}
      {error ? <div className="cust-card" style={{ padding: 16, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div>
        : !items ? <div className="cust-card" style={{ padding: 16 }}><div className="cust-sub">Loading…</div></div>
          : items.length === 0 ? <div className="cust-card" style={{ padding: 20 }}><div className="cust-sub">No time changes to review.</div></div>
            : items.map((p) => {
              const pending = isPendingProposal(p);
              return (
                <div key={p.id} data-testid="proposal-card" className="cust-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{p.salonName}{p.branchName ? ` · ${p.branchName}` : ''}</div>
                    {p.services.length ? <div className="cust-sub">{p.services.join(', ')}</div> : null}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'stretch' }}>
                    <Slot label="Your booking" slot={p.original} testId="proposal-original" />
                    <Slot label="Suggested" slot={p.proposed} testId="proposal-new" strong />
                  </div>
                  {p.reason ? <div style={{ fontSize: 13.5 }}>{p.reason}</div> : null}
                  {pending ? <>
                    <div className="cust-sub" style={{ fontSize: 12.5 }}>Your original time stays booked until you approve.{whenText(p.expiresAt) ? ` Please answer by ${whenText(p.expiresAt)}.` : ''}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className="cust-btn" disabled={busy === p.id} onClick={() => answer(p, true)}>Approve new time</button>
                      <button className="cust-btn-ghost" disabled={busy === p.id} onClick={() => answer(p, false)}>Keep my original time</button>
                    </div>
                  </> : <div className="cust-sub" style={{ fontWeight: 600 }}>{STATUS[p.status] ?? 'Answered.'}</div>}
                </div>
              );
            })}
    </div>
  );
}
