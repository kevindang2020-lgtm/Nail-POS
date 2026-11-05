// HelpRequestsCard.tsx — incoming Request-Help asks for THIS technician. Accepting reassigns the service line (and its
// per-line earnings) to me; declining notifies the primary. Refreshes on the technician realtime stream, so a new ask
// appears without a manual reload.
import { useCallback, useEffect, useState } from 'react';
import { techApi, type TechHelpRequest } from '../api/techApi';
import { useTechStream } from '../lib/useTechStream';

export function HelpRequestsCard() {
  const [reqs, setReqs] = useState<TechHelpRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setReqs((await techApi.helpRequests()).filter((r) => r.status === 'pending')); } catch { /* keep whatever we had */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  useTechStream(load);

  const act = async (rid: string, kind: 'accept' | 'decline') => {
    setBusy(rid); setNote(null);
    try {
      if (kind === 'accept') { await techApi.acceptHelp(rid); setNote('Accepted — the service is now assigned to you.'); }
      else { await techApi.declineHelp(rid); setNote('Declined. The requesting technician has been notified.'); }
      await load();
    } catch (e: any) { setNote(e?.message || 'Could not update the request.'); }
    finally { setBusy(null); }
  };

  if (reqs.length === 0) {
    return note ? <div className="tech-muted" role="status" style={{ fontSize: 13, marginBottom: 12 }}>{note}</div> : null;
  }

  return (
    <section aria-label="Help requests" style={{ marginBottom: 12 }}>
      {note && <div className="tech-muted" role="status" style={{ fontSize: 13, marginBottom: 8 }}>{note}</div>}
      {reqs.map((r) => (
        <div key={r.id} className="tech-card" style={{ padding: 14, marginBottom: 10, background: 'var(--tech-warning-bg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span aria-hidden style={{ fontSize: 20 }}>🙋</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 800 }}>A technician needs help</span>
              <span className="tech-muted" style={{ display: 'block', fontSize: 13 }}>{r.reason}{r.note ? ` — ${r.note}` : ''}</span>
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="tech-btn tech-primary" disabled={busy === r.id} onClick={() => act(r.id, 'accept')} style={{ flex: 1 }}>{busy === r.id ? '…' : 'Accept'}</button>
            <button className="tech-btn" disabled={busy === r.id} onClick={() => act(r.id, 'decline')} style={{ flex: 1 }}>Decline</button>
          </div>
        </div>
      ))}
    </section>
  );
}
