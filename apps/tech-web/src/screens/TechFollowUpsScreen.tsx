import { useCallback, useEffect, useState } from 'react';
import { techFollowUpApi, type FollowUpListResult, type FollowUpTaskView } from '../api/techFollowUpApi';
import { useTechNav } from '../shell/nav';
import { useTechStream } from '../lib/useTechStream';
import { TechFollowUpStatusFilter } from '../components/TechFollowUpStatusFilter';
import { TechFollowUpCard } from '../components/TechFollowUpCard';
import { TechFollowUpMessageModal } from '../components/TechFollowUpMessageModal';

// Today's Follow-Ups (technician). The signed-in tech's completed-service follow-ups for today (GET /tech/follow-ups);
// the server derives the technician from the session and only returns this tech's own clients. Send opens the message
// modal; Skip updates status. Honest loading/empty/error states — no fabricated clients.
const Back = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>);

export function TechFollowUpsScreen() {
  const nav = useTechNav();
  const [data, setData] = useState<FollowUpListResult | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<FollowUpTaskView | null>(null);

  const load = useCallback(() => {
    techFollowUpApi.list({ status: status || undefined })
      .then((r) => { setData(r); setError(null); })
      .catch((e: { message?: string }) => setError(e?.message || 'Failed to load your follow-ups.'));
  }, [status]);
  useEffect(() => { load(); }, [load]);
  // Live updates: the tech's list refetches when their queue is generated/changed (and on the poll fallback).
  useTechStream((ev) => { if (ev === 'daily_follow_up_tasks_created' || ev === 'follow_up_task_updated' || ev === 'poll' || ev === 'reconcile') load(); });

  const skip = async (t: FollowUpTaskView) => {
    setBusy(t.id); setError(null);
    try { await techFollowUpApi.skip(t.id); load(); }
    catch (e) { setError((e as { message?: string })?.message || 'Could not skip.'); }
    finally { setBusy(null); }
  };

  const s = data?.stats;
  const tasks = data?.tasks ?? [];

  return (
    <div style={{ paddingBottom: 90 }}>
      <div className="tech-topbar" style={{ marginBottom: 16 }}>
        <button className="tech-iconbtn" aria-label="Back" onClick={() => nav.back()}><Back /></button>
        <div className="t-title">Today's Follow-Ups</div>
        <button className="tech-iconbtn" aria-label="Refresh" onClick={load}>↻</button>
      </div>
      <div className="tech-main-2">

      <div className="tech-grid cols-4" style={{ marginBottom: 14 }}>
        <div className="tech-metric"><div className="mv">{!data ? <div className="tech-skel" style={{ width: 30, height: 20, margin: '0 auto' }} /> : (s ? s.pending : '—')}</div><div className="ml">Pending</div></div>
        <div className="tech-metric"><div className="mv">{!data ? <div className="tech-skel" style={{ width: 30, height: 20, margin: '0 auto' }} /> : (s ? s.sent : '—')}</div><div className="ml">Sent</div></div>
        <div className="tech-metric"><div className="mv">{!data ? <div className="tech-skel" style={{ width: 30, height: 20, margin: '0 auto' }} /> : (s ? s.skipped : '—')}</div><div className="ml">Skipped</div></div>
        <div className="tech-metric"><div className="mv">{!data ? <div className="tech-skel" style={{ width: 30, height: 20, margin: '0 auto' }} /> : (s ? s.rebooked : '—')}</div><div className="ml">Rebooked</div></div>
      </div>

      <TechFollowUpStatusFilter value={status} onChange={setStatus} />

      {error ? <div className="tech-state" role="alert" style={{ color: 'var(--tech-danger)' }}>{error}</div>
        : !data ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3].map(i => (
              <div key={i} className="tech-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="tech-skel" style={{ width: 44, height: 44, borderRadius: '50%' }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div className="tech-skel" style={{ width: '50%', height: 16 }} />
                    <div className="tech-skel" style={{ width: '70%', height: 14 }} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div className="tech-skel" style={{ width: '100%', height: 36, borderRadius: 8 }} />
                  <div className="tech-skel" style={{ width: '100%', height: 36, borderRadius: 8 }} />
                </div>
              </div>
            ))}
          </div>
        )
        : tasks.length === 0 ? (
          <div
            className="tech-card tech-state"
            style={{
              minHeight: 240,
              padding: '36px 16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              boxShadow: 'none',
            }}
          >
            <div
              aria-hidden
              style={{
                width: 58,
                height: 58,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #FBF3E4 0%, #EFE1C9 100%)',
                border: '1px solid #DBCAB0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 28,
                marginBottom: 12,
              }}
            >
              💌
            </div>
            <div style={{ fontSize: 14, color: 'var(--tech-text-muted, #7A6F62)', maxWidth: 280, lineHeight: 1.45 }}>
              No follow-ups here yet. Your list is generated after the salon closes.
            </div>
          </div>
        )
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {tasks.map((t) => <TechFollowUpCard key={t.id} task={t} busy={busy === t.id} onSend={setEditing} onSkip={skip} />)}
          </div>
        )}

      {editing ? (
        <TechFollowUpMessageModal task={editing} canEdit
          onClose={() => setEditing(null)}
          onSent={() => { setEditing(null); load(); }} />
      ) : null}
      </div>
    </div>
  );
}
