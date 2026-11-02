// TechTimeOffScreen — the technician asks for time off and sees what the salon decided (merge Oct 12 2026; the other
// chat's phase-3 screen on OUR /tech/time-off + 528/582 vocabulary: pending | approved | rejected | cancelled). A request
// still waiting can be withdrawn (DELETE) after an in-app confirm. An approved window blocks booking server-side — this
// screen never decides availability itself.
import { useCallback, useEffect, useRef, useState } from 'react';
import { techApi, type TimeOffEntry, type TimeOffKind } from '../api/techApi';
import { MyWorkShell } from './TechMyWorkScreens';

const KINDS: Array<{ v: TimeOffKind; l: string }> = [{ v: 'VACATION', l: 'Vacation' }, { v: 'SICK', l: 'Sick' }, { v: 'PERSONAL', l: 'Personal' }, { v: 'UNAVAILABLE', l: 'Unavailable' }];
const STATUS: Record<string, { l: string; cls: string }> = { pending: { l: 'Waiting for the salon', cls: 'tech-chip warn' }, approved: { l: 'Approved', cls: 'tech-chip' }, rejected: { l: 'Declined', cls: 'tech-chip neutral' }, cancelled: { l: 'Withdrawn', cls: 'tech-chip neutral' } };
const fmt = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const kindLabel = (k: string) => KINDS.find((x) => x.v === k)?.l ?? k;

export function TechTimeOffScreen() {
  const [rows, setRows] = useState<TimeOffEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [start, setStart] = useState(''); const [end, setEnd] = useState('');
  const [kind, setKind] = useState<TimeOffKind>('VACATION'); const [reason, setReason] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const loaded = useRef(false);

  // keep the list on screen when a refresh fails (only the first load shows an error in its place)
  const load = useCallback(() => techApi.timeOff()
    .then((r) => { setRows(Array.isArray(r) ? r : []); loaded.current = true; setError(null); })
    .catch((e: any) => { if (!loaded.current) { setRows([]); setError(e?.message || 'Could not load your time off.'); } }), []);
  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    setMsg(null); setError(null);
    if (!start || !end) { setError('Pick when it starts and ends.'); return; }
    const startsAt = new Date(start).toISOString(); const endsAt = new Date(end).toISOString();
    if (endsAt <= startsAt) { setError('The end must be after the start.'); return; }
    setBusy('new');
    try {
      await techApi.requestTimeOff({ startsAt, endsAt, kind, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      setStart(''); setEnd(''); setReason(''); setMsg('Request sent. The salon will approve or decline it.');
      await load();
    } catch (e: any) { setError(e?.message || 'Could not send the request.'); }
    finally { setBusy(null); }
  };
  const withdraw = async (rid: string) => {
    setBusy(rid); setError(null); setConfirmId(null);
    try { await techApi.withdrawTimeOff(rid); setMsg('Request withdrawn.'); await load(); }
    catch (e: any) { setError(e?.message || 'Could not withdraw the request.'); }
    finally { setBusy(null); }
  };

  const live = (rows ?? []).filter((r) => r.status !== 'cancelled');
  const upcoming = live.filter((r) => new Date(r.endsAt).getTime() >= Date.now() - 86_400_000);
  const past = live.filter((r) => new Date(r.endsAt).getTime() < Date.now() - 86_400_000).slice(0, 10);
  return (
    <MyWorkShell title="Time Off">
      <div className="tech-card" style={{ padding: 14, marginBottom: 14 }}>
        <div className="tech-section-title" style={{ marginBottom: 10 }}>Request time off</div>
        <label className="tech-label">Starts<input className="tech-input" type="datetime-local" aria-label="Starts" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="tech-label">Ends<input className="tech-input" type="datetime-local" aria-label="Ends" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <label className="tech-label">Type
          <select className="tech-input" aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value as TimeOffKind)}>
            {KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
          </select>
        </label>
        <label className="tech-label">Note for the salon (optional)<input className="tech-input" aria-label="Note" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></label>
        {error ? <div className="tech-state" role="alert" style={{ color: '#B3261E', margin: '8px 0' }}>{error}</div> : null}
        {msg ? <div className="tech-muted" style={{ margin: '8px 0' }}>{msg}</div> : null}
        <button className="tech-btn gold" disabled={busy === 'new'} onClick={submit} style={{ width: '100%', marginTop: 6 }}>{busy === 'new' ? 'Sending…' : 'Send request'}</button>
      </div>

      <div className="tech-section-title" style={{ margin: '6px 0 8px' }}>Upcoming</div>
      {rows === null ? <div className="tech-skel" style={{ height: 56, borderRadius: 12 }} /> : upcoming.length === 0 ? <div className="tech-muted">No upcoming time off.</div> : upcoming.map((r) => (
        <div key={r.id} className="tech-card" style={{ padding: 12, marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className={STATUS[r.status]?.cls ?? 'tech-chip neutral'}>{STATUS[r.status]?.l ?? r.status}</span>
            <strong>{kindLabel(r.kind)}</strong>
          </div>
          <div className="tech-muted" style={{ fontSize: 13, marginTop: 4 }}>{fmt(r.startsAt)} → {fmt(r.endsAt)}</div>
          {r.decisionNote ? <div className="tech-muted" style={{ fontSize: 12.5, marginTop: 4 }}>Salon note: {r.decisionNote}</div> : null}
          {r.status === 'pending' ? (confirmId === r.id ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="tech-btn danger-outline" disabled={busy === r.id} onClick={() => withdraw(r.id)}>Yes, withdraw</button>
              <button className="tech-btn ghost" onClick={() => setConfirmId(null)}>Keep it</button>
            </div>
          ) : <button className="tech-btn ghost" style={{ marginTop: 8 }} onClick={() => setConfirmId(r.id)}>Withdraw request</button>) : null}
        </div>
      ))}
      {past.length ? <>
        <div className="tech-section-title" style={{ margin: '14px 0 8px' }}>Past</div>
        {past.map((r) => <div key={r.id} className="tech-muted" style={{ fontSize: 12.5, padding: '4px 0' }}>{kindLabel(r.kind)} · {fmt(r.startsAt)} → {fmt(r.endsAt)} · {STATUS[r.status]?.l ?? r.status}</div>)}
      </> : null}
    </MyWorkShell>
  );
}
