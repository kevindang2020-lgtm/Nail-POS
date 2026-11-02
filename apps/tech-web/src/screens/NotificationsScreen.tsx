// NotificationsScreen.tsx — technician notifications (1:1 with the reference). Real rows from technician_notifications
// (service-change decisions, membership approvals, ratings, daily follow-ups). Per-type icon badges, Today/Earlier
// grouping, unread dot + mark-all-read, and deep-link to the referenced ticket. Frontend presentation only — no fabricated data.
import { useCallback, useEffect, useState } from 'react';
import { techApi } from '../api/techApi';
import { useTechNav } from '../shell/nav';
import { fmtMonthDay } from '@aipowersalon/mobile-sdk';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display
const Back = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>);
const Check = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>);
const X = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>);
const Star = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l3 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.9 21l1.2-6.8-5-4.9 6.9-1z" /></svg>);
const List = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>);
const Bell = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" /></svg>);

type Meta = { Icon: () => JSX.Element; fg: string; bg: string };
function metaFor(type: string): Meta {
  const t = (type || '').toLowerCase();
  if (t.includes('approved')) return { Icon: Check, fg: '#1B7F4B', bg: '#E5F4EC' };
  if (t.includes('rejected') || t.includes('declined') || t.includes('cancel')) return { Icon: X, fg: '#B3261E', bg: '#FBE9E7' };
  if (t.includes('rating') || t.includes('review')) return { Icon: Star, fg: 'var(--tech-primary-dark)', bg: 'var(--tech-primary-light)' };
  if (t.includes('followup') || t.includes('follow_up')) return { Icon: List, fg: '#1F4E79', bg: '#E7EFF7' };
  if (t.includes('membership')) return { Icon: Check, fg: 'var(--tech-primary-dark)', bg: 'var(--tech-primary-light)' };
  return { Icon: Bell, fg: 'var(--tech-primary-dark)', bg: 'var(--tech-primary-light)' };
}

export function NotificationsScreen() {
  const { back, openTicket } = useTechNav();
  const [data, setData] = useState<Awaited<ReturnType<typeof techApi.notifications>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    techApi.notifications().then((d) => { setData(d); setError(null); }).catch((e: any) => setError(e?.message || 'Could not load notifications.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const markAll = async () => {
    setBusy(true);
    try { await techApi.markNotificationsRead(); load(); } catch (e: any) { setError(e?.message || 'Could not mark as read.'); } finally { setBusy(false); }
  };

  const when = (iso: string) => {
    const d = new Date(iso); const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return fmtMonthDay(d);
  };

  const items = data?.items ?? [];
  const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
  const today = items.filter((n) => isToday(n.createdAt));
  const earlier = items.filter((n) => !isToday(n.createdAt));

  const Row = (n: typeof items[number]) => {
    const m = metaFor(n.type);
    return (
      <button key={n.id} className="tech-card" onClick={() => (n.reference ? openTicket(n.reference) : undefined)}
        style={{ marginTop: 0, textAlign: 'left', padding: 12, display: 'flex', gap: 12, alignItems: 'flex-start', cursor: n.reference ? 'pointer' : 'default', background: n.readAt ? undefined : 'var(--tech-primary-wash, #FBF4E8)' }}>
        <span style={{ width: 36, height: 36, borderRadius: 10, background: m.bg, color: m.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}><m.Icon /></span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>{n.title}</span>
          {n.body ? <span className="tech-muted" style={{ display: 'block', fontSize: 12.5, marginTop: 2 }}>{n.body}</span> : null}
          <span className="tech-muted" style={{ display: 'block', fontSize: 11, marginTop: 4 }}>{when(n.createdAt)}</span>
        </span>
        {!n.readAt ? <span aria-label="Unread" style={{ width: 8, height: 8, borderRadius: 99, background: '#A96F22', marginTop: 6, flex: '0 0 auto' }} /> : null}
      </button>
    );
  };

  return (
    <div style={{ paddingTop: 16, paddingBottom: 90, paddingInline: 12 }}>   {/* developer merge (Oct 6 2026): side gutters, card spacing */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button className="tech-iconbtn" onClick={back} aria-label="Back" style={{ minWidth: 44 }}><Back/></button>
        <h1 style={{ margin: 0, fontSize: 19 }}>Notifications</h1>
        {data && data.unread > 0 ? (
          <button className="tech-btn ghost" style={{ marginLeft: 'auto', fontSize: 12 }} disabled={busy} onClick={markAll}>{busy ? '…' : `Mark all read (${data.unread})`}</button>
        ) : null}
      </div>
      {error ? <div className="tech-card" style={{ padding: 12, color: 'var(--tech-danger, #B3261E)' }}>{error}</div> : null}
      {!data ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div className="tech-skel" style={{ width: 60, height: 16, marginBottom: 8 }} />
            <div style={{ display: 'grid', gap: 8 }}>
              {[1, 2, 3].map(i => (
                <div key={i} className="tech-card" style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div className="tech-skel" style={{ width: 36, height: 36, borderRadius: 10, flex: '0 0 auto' }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 }}>
                    <div className="tech-skel" style={{ width: '60%', height: 14 }} />
                    <div className="tech-skel" style={{ width: '80%', height: 12 }} />
                    <div className="tech-skel" style={{ width: 40, height: 12 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="tech-card" style={{ padding: 16 }}><div className="tech-muted">No notifications yet — approvals and updates from the front desk will show here.</div></div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {today.length ? (
            <div>
              <div className="tech-eyebrow" style={{ marginBottom: 8 }}>Today</div>
              <div style={{ display: 'grid', gap: 10 }}>{today.map(Row)}</div>
            </div>
          ) : null}
          {earlier.length ? (
            <div>
              <div className="tech-eyebrow" style={{ marginBottom: 8 }}>Earlier</div>
              <div style={{ display: 'grid', gap: 10 }}>{earlier.map(Row)}</div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
