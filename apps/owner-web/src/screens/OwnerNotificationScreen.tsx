import { useEffect, useState } from 'react';
import { ownerMoreApi } from '../api/ownerApi';
import type { OwnerAlert } from '@aipowersalon/api-contracts/tenant';
import { useOwnerNav } from '../shell/nav';
import {
  FiAlertTriangle,
  FiBell,
  FiCheckCircle,
  FiClock,
  FiDollarSign,
  FiInfo,
  FiMessageSquare,
  FiStar,
} from 'react-icons/fi';

type NotificationItem = {
  id: string;
  title: string;
  description: string;
  time: string;
  icon: React.ReactNode;
  badgeBg: string;
  badgeColor: string;
  read: boolean;
};

// Sep 2026 merge: the developer's screen showed a HARD-CODED list (technician-style items such as "Ticket #T-1045 assigned
// to you" in the OWNER app). It now shows the owner's REAL alerts (/owner/alerts); "read" = acknowledged on the server.
// Developer merge (Oct 23 2026): the developer's per-type icons (payment / appointment / message / loyalty / assignment,
// a warning triangle for warnings, an info mark for the rest), the in-list loading row, "N d ago" times, a description
// only when there is one, and "Mark all read" as ONE server call (POST /owner/notifications/read).
const SEVERITY_STYLE: Record<string, { icon: React.ReactNode; bg: string; color: string }> = {
  critical: { icon: <FiAlertTriangle />, bg: '#FBEDE9', color: '#B85B4D' },
  high:     { icon: <FiAlertTriangle />, bg: '#FCF1E3', color: '#AD7824' },
  warning:  { icon: <FiAlertTriangle />, bg: 'var(--owner-warning-bg, #FFF4DF)', color: 'var(--owner-warning, #CE8A2C)' },
  info:     { icon: <FiInfo />, bg: 'var(--owner-surface-soft, #F3F1EE)', color: 'var(--owner-text-secondary, #77716A)' },
};
/** the developer's per-type icons, keyed by the alert's category (the severity keeps its colour) */
const CATEGORY_ICON: Record<string, React.ReactNode> = {
  payment: <FiDollarSign />, tip: <FiDollarSign />,
  appointment: <FiClock />, arrival: <FiClock />,
  message: <FiMessageSquare />,
  loyalty: <FiCheckCircle />, success: <FiCheckCircle />,
  assignment: <FiStar />,
};
export function ago(iso: string): string {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
export function toNotification(a: OwnerAlert): NotificationItem {
  const sev = SEVERITY_STYLE[a.severity] ?? SEVERITY_STYLE.info;
  // developer merge (Oct 6 2026): money facts (Payment received / refunded / voided) carry the dollar badge whatever their severity
  const icon = CATEGORY_ICON[a.category] ?? sev.icon;
  return { id: a.id, title: a.title, description: a.body ?? '', time: ago(a.createdAt), icon, badgeBg: sev.bg, badgeColor: sev.color, read: a.status !== 'new' };
}

export function OwnerNotificationScreen() {
  const { back } = useOwnerNav();
  const [notifications, setNotifications] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    ownerMoreApi.alerts({ status: 'open' }).then((rows) => setNotifications((rows ?? []).map(toNotification)))
      .catch((e: any) => { setError(e?.message || 'Could not load notifications.'); setNotifications([]); });
  }, []);
  const markAsRead = (id: string) => {
    const item = notifications?.find((n) => n.id === id);
    if (!item || item.read) return;
    setNotifications((prev) => (prev ?? []).map((n) => (n.id === id ? { ...n, read: true } : n)));
    ownerMoreApi.acknowledge(id).catch(() => setNotifications((prev) => (prev ?? []).map((n) => (n.id === id ? { ...n, read: false } : n))));
  };
  const markAllRead = () => {
    const unread = new Set((notifications ?? []).filter((n) => !n.read).map((n) => n.id));
    if (!unread.size) return;
    setNotifications((prev) => (prev ?? []).map((n) => (unread.has(n.id) ? { ...n, read: true } : n)));
    ownerMoreApi.markAllNotificationsRead().catch((e: any) => {
      setNotifications((prev) => (prev ?? []).map((n) => (unread.has(n.id) ? { ...n, read: false } : n)));
      setError(e?.message || 'Could not mark notifications read.');
    });
  };
  const loading = notifications === null;
  const unreadCount = (notifications ?? []).filter((item) => !item.read).length;

  return (
    <div className="owner-notification-screen">
      <header className="owner-notification-header">
        <button className="owner-back" aria-label="Back" onClick={back}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="owner-notification-title-wrap">
          <h1 className="owner-serif">Notifications</h1>
          {unreadCount > 0 && <span className="owner-notification-count">{unreadCount}</span>}
        </div>
        <button type="button" className="owner-notification-mark-read" onClick={markAllRead} disabled={unreadCount === 0 || loading}>
          Mark all read
        </button>
      </header>

      {error ? <div role="alert" className="owner-notification-error" style={{ color: '#8F3226', padding: '8px 16px' }}>{error}</div> : null}
      <main className="owner-notification-list">
        {loading ? (
          <div role="status" style={{ padding: 24, textAlign: 'center', color: 'var(--owner-text-secondary)' }}>Loading notifications…</div>
        ) : notifications.length === 0 ? (
          <div className="owner-notification-empty">
            <div className="owner-notification-empty-icon"><FiBell /></div>
            <h2 className="owner-serif">You're all caught up</h2>
            <p>You don't have any notifications right now.</p>
          </div>
        ) : (
          notifications.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`owner-notification-card ${item.read ? 'is-read' : 'is-unread'}`}
              onClick={() => markAsRead(item.id)}
            >
              <span className="owner-notification-icon" style={{ background: item.badgeBg, color: item.badgeColor }}>
                {item.icon}
              </span>
              <span className="owner-notification-content">
                <span className="owner-notification-card-title">{item.title}</span>
                {item.description ? <span className="owner-notification-description">{item.description}</span> : null}
                <span className="owner-notification-time">{item.time}</span>
              </span>
              <span className="owner-notification-right">
                {!item.read && <span className="owner-notification-dot" />}
                <FiBell />
              </span>
            </button>
          ))
        )}
      </main>
    </div>
  );
}
