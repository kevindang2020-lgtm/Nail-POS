import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerApi, type CustomerNotification } from '../api/customerApi';
import { FiBell, FiCalendar, FiGift, FiStar, FiMessageCircle } from 'react-icons/fi';
import { fmtMonthDay, fmtTime } from '@aipowersalon/mobile-sdk';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

const fmt = (iso: string) => {
  const day = fmtMonthDay(iso);
  return day ? `${day} · ${fmtTime(iso)}` : '';
};

function getNotificationIcon(type?: string) {
  switch (type) {
    case 'appointment':
    case 'booking':
      return <FiCalendar />;
    case 'reward':
    case 'points':
      return <FiStar />;
    case 'gift_card':
    case 'deal':
      return <FiGift />;
    case 'followup':
    case 'message':
      return <FiMessageCircle />;
    default:
      return <FiBell />;
  }
}

export function NotificationsScreen() {
  const nav = useNavigate();
  const [items, setItems] = useState<CustomerNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    customerApi
      .notifications()
      .then((d) => {
        if (live) setItems(d.items);
        customerApi.markNotificationsRead().catch(() => { });
      })
      .catch((e: any) => live && setError(e?.message || 'Could not load notifications.'));
    return () => {
      live = false;
    };
  }, []);



  const Header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
      <button onClick={() => nav(-1)} aria-label="Back" style={{ border: 0, background: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--customer-text)' }}>‹</button>
      <h1 className="cust-h1" style={{ fontSize: 20 }}>Notifications</h1>
    </div>
  );
  return (
    <div style={{ padding: 18 }}>{Header}
      {error ? <div className="cust-card" style={{ padding: 16, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div>
        : !items ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} className="cust-card" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start', borderLeft: i === 1 ? '3px solid var(--customer-border)' : '1px solid var(--customer-border)' }}>
                <div className="cust-skel" style={{ width: 34, height: 34, borderRadius: 10 }} />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="cust-skel" style={{ width: 140, height: 16 }} />
                  <div className="cust-skel" style={{ width: '100%', height: 14 }} />
                  <div className="cust-skel" style={{ width: 100, height: 12 }} />
                </div>
              </div>
            ))}
          </div>
        )
        : items.length === 0 ? <div className="cust-card" style={{ padding: 24, textAlign: 'center', marginTop: 12 }}><div aria-hidden style={{ fontSize: 34 }}>🔔</div><h2 className="cust-h2" style={{ marginTop: 8 }}>You’re all caught up</h2><div className="cust-sub" style={{ marginTop: 4 }}>No notifications yet.</div></div>
        : <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>{items.map((n) => (
            <div key={n.id} className="cust-card" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start', borderLeft: n.readAt ? '1px solid var(--customer-border)' : '3px solid var(--customer-primary)' }}>
              <span aria-hidden style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--customer-purple-100)', display: 'grid', placeItems: 'center', fontSize: 16, flex: '0 0 auto' }}>{getNotificationIcon(n.type)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{n.title}</div>
                {n.body ? <div className="cust-sub" style={{ fontSize: 13, marginTop: 2 }}>{n.body}</div> : null}
                <div className="cust-sub" style={{ fontSize: 11, marginTop: 4 }}>{fmt(n.createdAt)}</div>
              </div>
            </div>))}
          </div>}
    </div>
  );
}

