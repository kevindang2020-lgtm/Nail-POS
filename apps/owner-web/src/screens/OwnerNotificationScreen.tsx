import { useState, useEffect } from 'react';
import { useOwnerNav } from '../shell/nav';
import { ownerNotificationsApi, type OwnerNotification } from '../api/ownerApi';
import {
  FiBell,
  FiStar,
  FiCheckCircle,
  FiClock,
  FiDollarSign,
  FiMessageSquare,
  FiAlertTriangle,
  FiInfo,
} from 'react-icons/fi';

function getIconForType(type: string) {
  switch (type) {
    case 'assignment': return { icon: <FiStar />, badgeBg: 'var(--owner-primary-light, #F4E3BF)', badgeColor: 'var(--owner-primary-dark, #AD7824)' };
    case 'success':
    case 'loyalty': return { icon: <FiCheckCircle />, badgeBg: 'var(--owner-success-bg, #EDF8F0)', badgeColor: 'var(--owner-success, #31905A)' };
    case 'arrival':
    case 'appointment': return { icon: <FiClock />, badgeBg: 'var(--owner-surface-soft, #F3F1EE)', badgeColor: 'var(--owner-text-secondary, #77716A)' };
    case 'payment':
    case 'tip': return { icon: <FiDollarSign />, badgeBg: 'var(--owner-success-bg, #EDF8F0)', badgeColor: 'var(--owner-success, #31905A)' };
    case 'message': return { icon: <FiMessageSquare />, badgeBg: 'var(--owner-surface-soft, #F3F1EE)', badgeColor: 'var(--owner-text-secondary, #77716A)' };
    case 'alert':
    case 'warning': return { icon: <FiAlertTriangle />, badgeBg: 'var(--owner-warning-bg, #FFF4DF)', badgeColor: 'var(--owner-warning, #CE8A2C)' };
    default: return { icon: <FiInfo />, badgeBg: 'var(--owner-surface-soft, #F3F1EE)', badgeColor: 'var(--owner-text-secondary, #77716A)' };
  }
}

function formatTimeAgo(isoString: string) {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function OwnerNotificationScreen() {
  const { back } = useOwnerNav();
  const [notifications, setNotifications] = useState<OwnerNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = () => {
    ownerNotificationsApi.get().then((res) => {
      setNotifications(res.items);
      setUnreadCount(res.unreadCount);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const markAllRead = () => {
    ownerNotificationsApi.markRead().then(() => {
      setNotifications((prev) => prev.map((item) => ({ ...item, readAt: new Date().toISOString() })));
      setUnreadCount(0);
    });
  };

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
          {unreadCount > 0 && (
            <span className="owner-notification-count">{unreadCount}</span>
          )}
        </div>
        <button type="button" className="owner-notification-mark-read" onClick={markAllRead} disabled={unreadCount === 0 || loading}>
          Mark all read
        </button>
      </header>

      <main className="owner-notification-list">
        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--owner-text-secondary)' }}>Loading...</div>
        ) : notifications.length === 0 ? (
          <div className="owner-notification-empty">
            <div className="owner-notification-empty-icon"><FiBell /></div>
            <h2 className="owner-serif">You're all caught up</h2>
            <p>You don't have any notifications right now.</p>
          </div>
        ) : (
          notifications.map((item) => {
            const display = getIconForType(item.type);
            const isRead = !!item.readAt;
            return (
              <div key={item.id} className={`owner-notification-card ${isRead ? 'is-read' : 'is-unread'}`}>
                <span className="owner-notification-icon" style={{ background: display.badgeBg, color: display.badgeColor }}>
                  {display.icon}
                </span>
                <span className="owner-notification-content">
                  <span className="owner-notification-card-title">{item.title}</span>
                  {item.body && <span className="owner-notification-description">{item.body}</span>}
                  <span className="owner-notification-time">{formatTimeAgo(item.createdAt)}</span>
                </span>
                <span className="owner-notification-right">
                  {!isRead && <span className="owner-notification-dot" />}
                  <FiBell />
                </span>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}