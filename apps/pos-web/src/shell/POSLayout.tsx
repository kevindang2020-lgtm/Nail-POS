import { useEffect, useMemo, useState, useRef } from 'react';
import { useEventCallback } from '@aipowersalon/ui';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { FaBars, FaTimes } from 'react-icons/fa';
import { useAuth } from '../auth/AuthContext';
import { useLanguage, currentLocale } from '@aipowersalon/mobile-sdk/i18n';
import { LanguageSwitch } from './LanguageSwitch';
import { authApi, type BranchOption } from '../api/authApi';
import { api } from '../api/client';
import { TENANT_NAV, Icon, type NavItem, type BadgeKey } from './tenant-nav';
import { useTenantNavAccess, useSidebarBadges, useSystemStatus, gateFor, type Badges } from './tenant-access';
import { ProfileMenu } from './ProfileMenu';
import { TopSearch } from './TopSearch';
import { PlatformAnnouncementBar } from './PlatformAnnouncementBar';
import RealtimeStatusPill from '../realtime/RealtimeStatusPill';
import { RealtimeToasts } from './RealtimeToasts';   // developer merge (Oct 2026): salon-wide realtime toasts
import { useOfflineSync } from '../hooks/useOfflineSync';
import { QuickPinScreen } from '../auth/QuickPinScreen';
import { useIdleLock } from './useIdleLock';
import { OFFLINE_CACHE_SERVED } from '../api/offline-read-cache';
import { OfflineDraftsPanel } from '../components/OfflineDraftsPanel';
import { useSafetySync } from '../realtime/useRealtime';
import { CommunityEmergencyBanner } from '../screens/community/CommunityEmergencyBanner';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { startDisplayProfile } from './displayProfile';

const OPEN_KEY = 'aps.pos.nav.open.v1';
const COLLAPSE_KEY = 'aps.pos.nav.collapsed.v1';
const BADGE_TONE: Record<BadgeKey, string> = {
  checkIn: 'orange', techQueue: 'blue', customerQueue: 'blue', serviceDone: 'orange', checkout: 'red',
  messages: 'blue', notifications: 'red', techReportsPending: 'orange',
  inventoryAlerts: 'orange', reviews: 'purple', payrollPending: 'orange',
  billingAlerts: 'red', aiUsageAlerts: 'purple', supportTickets: 'orange', setupHealthAlerts: 'red',
};

function loadOpen(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}'); } catch { return {}; }
}

function Badge({ k, badges }: { k?: BadgeKey; badges: Badges }) {
  if (!k) return null;
  const n = badges[k];
  if (!n || n <= 0) return null;
  return <span className={`nbadge ${BADGE_TONE[k]}`}>{n > 99 ? '99+' : n}</span>;
}

function TopClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  const date = now.toLocaleDateString(currentLocale(), { month: 'short', day: '2-digit', year: 'numeric' });   // follows the POS language
  const time = now.toLocaleTimeString(currentLocale(), { hour: 'numeric', minute: '2-digit' });
  return (
    <div className="topclock" aria-label={`${date} ${time}`}>
      <span className="d">{date}</span>
      <span className="t">{time}</span>
    </div>
  );
}

function NotificationBell({ badges }: { badges: Badges }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const low = badges.inventoryAlerts || 0;
  const reports = badges.techReportsPending || 0;
  const total = badges.notifications || 0;
  const items = [
    low > 0 && { icon: 'product' as const, label: tx('pos.low_inventory_item_plural_low_on_34ro', { low: String(low), plural: String(low > 1 ? 's' : '') }), route: '/tenant/inventory?tab=alerts' },
    reports > 0 && { icon: 'team' as const, label: tx('pos.reports_technician_report_plural_awaiting_approval_1i6e', { reports: String(reports), plural: String(reports > 1 ? 's' : '') }), route: '/tenant/inventory?tab=reports' },
  ].filter(Boolean) as { icon: any; label: string; route: string }[];

  return (
    <div className="topctl">
      <button className="ic-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={tx('pos.notifications_total_actionable', { total: String(total) })} title={tx('pos.notifications')}>
        <Icon name="bell" />
        {total > 0 && <span className="ic-badge red">{total > 99 ? '99+' : total}</span>}
      </button>
      {open && (
        <>
          <div className="ovbg" onClick={() => setOpen(false)} />
          <div className="notif-panel" role="dialog" aria-label={tx('pos.notifications')}>
            <div className="panel-h"><b>{tx('pos.notifications')}</b>{total > 0 && <span className="panel-count">{total}</span>}</div>
            <div className="panel-b">
              {items.length === 0 ? (
                <div className="panel-empty">{tx('pos.you_re_all_caught_up')}</div>
              ) : (
                items.map((it, i) => (
                  <button key={i} className="panel-row" onClick={() => { setOpen(false); nav(it.route); }}>
                    <span className="pr-ic"><Icon name={it.icon} /></span>
                    <span className="pr-lbl">{it.label}</span>
                    <span className="pr-chev"><Icon name="chevron" /></span>
                  </button>
                ))
              )}
            </div>
            <button className="panel-f" onClick={() => { setOpen(false); nav('/tenant/account/activity-logs'); }}>{tx('pos.view_all_activity_2')}</button>
          </div>
        </>
      )}
    </div>
  );
}

function MessageControl({ badges }: { badges: Badges }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();
  // resolving a help request is a manager act (the API refuses it otherwise); the front desk reads the inbox only
  const { principal } = useAuth();
  const canResolve = !!principal?.permissions?.includes('technicians.edit');

  const loadMessages = useEventCallback(async () => {
    setLoading((was) => was || messages.length === 0);   // first load only — a background tick never flashes 'Loading'
    try {
      const data = await api.get<any[]>('/tech/manager-messages');
      setMessages(Array.isArray(data) ? data : []);
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  });

  // Smooth Refresh spec §95: no widget owns a setInterval. The inbox rides the shared safety sync (15 s ± 2 s while
  // visible, 60 s hidden, immediate on focus/reconnect, single-flight) instead of the raw 15 s loop it shipped with.
  useEffect(() => { loadMessages(); }, [loadMessages]);
  useSafetySync(loadMessages);

  const unreadCount = messages.filter((m) => m.status === 'unread').length;
  const total = unreadCount || badges.messages || 0;

  const markResolved = async (id: string) => {
    try {
      await api.patch(`/tech/manager-messages/${id}/resolve`, {});
      setMessages((prev) => prev.map((m) => m.id === id ? { ...m, status: 'resolved' } : m));
    } catch (err: any) {
      console.error(err);
    }
  };

  return (
    <div className="topctl">
      <button
        className="ic-btn"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) loadMessages();
        }}
        aria-expanded={open}
        aria-label={tx('pos.messages_total_unread', { total: String(total) })}
        title={tx('pos.technician_messages_inquiries')}
      >
        <Icon name="mail" />
        {total > 0 && <span className="ic-badge orange">{total > 99 ? '99+' : total}</span>}
      </button>
      {open && (
        <>
          <div className="ovbg" onClick={() => setOpen(false)} />
          <div className="notif-panel" role="dialog" aria-label={tx('pos.messages_2')} style={{ width: 360, maxWidth: '90vw' }}>
            <div className="panel-h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span><b>{tx('pos.technician_messages')}</b></span>
              {total > 0 && <span className="panel-count" style={{ background: '#D97706', color: '#FFF' }}>{total} {tx('pos.unread')}</span>}
            </div>
            <div className="panel-b" style={{ maxHeight: 380, overflowY: 'auto', padding: '8px 12px' }}>
              {loading && messages.length === 0 ? (
                <div className="panel-empty">{tx('pos.loading_messages')}</div>
              ) : messages.length === 0 ? (
                <div className="panel-empty">{tx('pos.no_messages_from_technicians_yet')}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {messages.map((m) => {
                    const isUnread = m.status === 'unread';
                    const timeStr = m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                    return (
                      <div
                        key={m.id}
                        style={{
                          padding: '12px',
                          borderRadius: '12px',
                          background: isUnread ? '#FFFBEB' : '#F9FAFB',
                          border: isUnread ? '1.5px solid #FCD34D' : '1px solid #E5E7EB',
                          boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontWeight: 800, fontSize: 13, color: '#1F2937' }}>
                            🧑‍🔧 {m.technicianName}
                          </span>
                          <span style={{ fontSize: 11, color: '#6B7280' }}>
                            {timeStr}
                          </span>
                        </div>

                        <div style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#E0E7FF', color: '#3730A3', marginBottom: 6 }}>
                          {m.topic}
                        </div>

                        <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.45, whiteSpace: 'pre-wrap', marginBottom: 8 }}>
                          {m.message}
                        </div>

                        {isUnread && canResolve ? (
                          <button
                            type="button"
                            onClick={() => markResolved(m.id)}
                            style={{
                              padding: '4px 10px',
                              borderRadius: '8px',
                              background: '#10B981',
                              color: '#FFFFFF',
                              border: 'none',
                              fontSize: 11.5,
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {tx('pos.mark_resolved_2')}
                          </button>
                        ) : (
                          <span style={{ fontSize: 11, color: '#059669', fontWeight: 700 }}>
                            {tx('pos.resolved_4')}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <button className="panel-f" onClick={() => { setOpen(false); nav('/messages'); }}>{tx('pos.customer_sms_broadcasts')}</button>
          </div>
        </>
      )}
    </div>
  );
}

function LocationSelector({ salonName }: { salonName: string }) {
  const { principal } = useAuth();
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const locRef = useRef<HTMLDivElement>(null);
  const current = useMemo(
    () => branches.find((b) => b.id === principal?.branchId) || branches.find((b) => b.isActive) || branches[0],
    [branches, principal?.branchId],
  );
  useEffect(() => { authApi.branches().then((r) => setBranches(r?.branches || [])).catch(() => { }); }, []);
  const pick = (id: string) => {
    if (id === principal?.branchId) { setOpen(false); return; }
    authApi.selectBranch(id).then(() => window.location.reload()).catch(() => setOpen(false));
  };
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (locRef.current && !locRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handleClickOutside);

    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
    };
  }, [open]);
  return (
    <div className="loc" ref={locRef}>
      <button className="loc-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open} title={salonName}>
        <span className="loc-av"><Icon name="pin" /></span>
        <span className="loc-text">
          <span className="loc-salon hidden sm:block">{salonName}</span>
          <span className="loc-branch hidden sm:block">{current?.name || current?.city || tx('pos.main_location')}</span>
        </span>
        <span className={`loc-chev ${open ? 'up' : ''}`}><Icon name="chevron" /></span>
      </button>
      {open && (
        <div className="loc-menu" role="menu">
          {branches.length === 0 && <div className="loc-empty">{tx('pos.no_other_locations')}</div>}
          {branches.map((b) => (
            <button key={b.id} role="menuitem" className={`loc-opt ${b.id === current?.id ? 'sel' : ''}`} onClick={() => pick(b.id)}>
              <span>{b.name || b.city || tx('pos.location_2')}</span>
              <span className={`loc-dot ${b.isActive ? 'on' : 'off'}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function POSLayout() {
  const { principal } = useAuth();
  // Vietnamese POS mandate (Oct 26 2026, WP-B): the shell SUBSCRIBES to the language and re-renders in place on a switch —
  // it is never remounted (no `key`), so the open sidebar groups, the realtime connection and the screen below keep their
  // state. The person's language is applied after sign-in by usePosLanguage in App.tsx (Gate).
  useLanguage();
  const nav = useNavigate();
  const access = useTenantNavAccess(principal?.role, principal?.permissions);
  const badges = useSidebarBadges();
  const status = useSystemStatus();
  const [open, setOpen] = useState<Record<string, boolean>>(loadOpen);
  const [collapsed] = useState<boolean>(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const salonName = access.salonName || tx('pos.your_salon');

  // SUNMI FLEX 3 mandates (Nov 6 2026): measure the real CSS viewport once the shell is on screen — density, soft
  // keyboard and visual-viewport attributes on <html> (shell/displayProfile.ts). Attributes only: no re-render, no zoom.
  useEffect(() => startDisplayProfile(), []);

  useEffect(() => { localStorage.setItem(OPEN_KEY, JSON.stringify(open)); }, [open]);
  useEffect(() => { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); }, [collapsed]);

  // Lock background scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileSidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileSidebarOpen]);

  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  // Phase 9: an item shows when the person holds every key it (and its section) needs — no role lists, no OWNER shortcut
  const visibleItems = (items: NavItem[]) => items.filter((it) => gateFor(it, access) !== 'no-permission');

  // Collapse handler that adapts to screen size

  const { isOffline } = useOfflineSync();
  // Decision 33: when a screen is showing a saved copy, say from when.
  const [offlineCopyAt, setOfflineCopyAt] = useState<number | null>(null);
  useEffect(() => {
    const on = (e: Event) => setOfflineCopyAt((e as CustomEvent).detail?.savedAt ?? null);
    window.addEventListener(OFFLINE_CACHE_SERVED, on);
    return () => window.removeEventListener(OFFLINE_CACHE_SERVED, on);
  }, []);
  useEffect(() => { if (!isOffline) setOfflineCopyAt(null); }, [isOffline]);
  // Decision 35 — idle lock: on by default, 5 minutes (device setting), quick PIN to unlock; a lock older than
  // LONG_INACTIVITY_HOURS ends the session (full sign-in). See shell/useIdleLock.ts and shell/idle-lock.ts.
  const { logout, offline: authOffline } = useAuth();
  const { isLocked, unlock, fullSignIn } = useIdleLock(logout);

  const renderItem = (it: NavItem) => {
    const gate = gateFor(it, access);
    const locked = gate === 'feature-locked' || gate === 'ai-locked';
    return (
      <NavLink
        key={it.id}
        to={it.route}
        end
        onClick={() => setMobileSidebarOpen(false)}
        className={({ isActive }) => `navlink${isActive ? ' active' : ''}${locked ? ' locked' : ''}`}
        title={collapsed ? it.label : undefined}
      >
        <span className="ico"><Icon name={locked ? 'lock' : it.icon} /></span>
        <span className="lbl">{it.label}</span>
        <Badge k={it.badgeKey} badges={badges} />
      </NavLink>
    );
  };

  return (
    <div className={`shell theme-tenant${collapsed ? ' collapsed' : ''} max-[800px]:!grid-cols-1 max-[800px]:!block`}>
      {/* Mobile Backdrop */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm min-[801px]:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`sidebar bg-[#fdfbf7] ${collapsed ? 'collapsed' : ''} max-[800px]:!fixed max-[800px]:!top-0 max-[800px]:!left-0 max-[800px]:!bottom-0 max-[800px]:!z-50 max-[800px]:!w-[280px] max-[800px]:shadow-2xl transition-all duration-300 ease-in-out ${mobileSidebarOpen ? 'max-[800px]:!translate-x-0' : 'max-[800px]:!-translate-x-full'
          }`}
      >
        {/* Mobile Close Button */}
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(false)}
          className="absolute right-3 top-3 z-10 hidden h-9 w-9 items-center justify-center rounded-lg border border-[#e5d8c3] bg-white text-[#5b5043] shadow-sm max-[800px]:flex"
          aria-label={tx('pos.close_navigation')}
        >
          <FaTimes size={17} />
        </button>

        <div className="brand">
          <img
            className="brandlogo"
            src="/brand/aipowersalon-logo.png"
            alt={tx('pos.ai_powersalon')}
            width={184}
            draggable={false}
          />
          {/* <button
            type="button"
            className={`collapse-btn ${collapsed ? 'collapsed' : ''}`}
            onClick={handleToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Icon name="chevron" />
          </button> */}
        </div>

        <nav className="nav" aria-label={tx('pos.tenant_navigation')}>
          {TENANT_NAV.map((sec) => {
            const items = visibleItems(sec.items);
            if (items.length === 0) return null;
            if (!sec.collapsible) {
              return (
                <div key={sec.id} className="navgroup">
                  <div className="grp">{sec.section}</div>
                  {items.map(renderItem)}
                </div>
              );
            }
            const isOpen = !!open[sec.id];   // keyed by the stable id: a language switch keeps open groups open
            const groupCount = items.reduce((n, it) => n + (it.badgeKey ? (badges[it.badgeKey] || 0) : 0), 0);
            return (
              <div key={sec.id} className="navgroup">
                <button
                  type="button"
                  className={`grp-head${isOpen ? ' open' : ''}`}
                  onClick={() => toggle(sec.id)}
                  aria-expanded={isOpen}
                  title={collapsed ? sec.section : undefined}
                >
                  <span className="ico">{sec.icon && <Icon name={sec.icon} />}</span>
                  <span className="lbl">{sec.section}</span>
                  {groupCount > 0 && <span className="nbadge orange">{groupCount > 99 ? '99+' : groupCount}</span>}
                  <span className="chev">
                    <Icon name="chevron" />
                  </span>
                </button>
                {isOpen && <div className="grp-items">{items.map(renderItem)}</div>}
              </div>
            );
          })}
        </nav>

        <div className="sidefoot">
          <button
            type="button"
            className="statuscard"
            onClick={() => { setMobileSidebarOpen(false); nav('/tenant/system-status'); }}
            title={tx('pos.system_status_2')}
          >
            <div className="t">{tx('pos.system_status')}</div>
            <div className="s"><span className={`sdot ${status.healthy ? 'ok' : 'bad'}`} />{status.label}</div>
            <div className="v">{status.version}</div>
          </button>
          <button
            type="button"
            className="helpbtn"
            onClick={() => { setMobileSidebarOpen(false); nav('/tenant/account/support'); }}
          >
            {tx('pos.visit_ai_powersalon_help_center')}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="main no-scrollbar max-[800px]:!w-full max-[800px]:!max-w-full" style={{ overflowY: 'auto' }}>
        {isOffline && (
          <div style={{ background: '#EF4444', color: '#FFF', textAlign: 'center', padding: '8px', fontSize: 13, fontWeight: 600 }}>
            <Icon name="bell" /> {authOffline ? tx('pos.opened_offline_read_only_until_the_cv98') : ''}{tx('pos.offline_3')}{' '}{offlineCopyAt ? tx('pos.showing_the_copy_saved_at_v0', { v0: String(new Date(offlineCopyAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) }) : ''}{tx('pos.payments_refunds_gift_cards_redemptions_and_1g3v')}
          </div>
        )}
        {/* Decision 33: notes saved offline — checked and applied (or discarded) once the connection is back */}
        <OfflineDraftsPanel online={!isOffline} />
        <header className="topbar relative !gap-3 sm:!gap-3 !px-2 sm:!px-[20px]">
          {/* Mobile Hamburger Toggle */}
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#e5d8c3] bg-white text-[#5b5043] shadow-sm max-[800px]:flex"
            aria-label={tx('pos.open_navigation')}
          >
            <FaBars size={18} />
          </button>

          <LocationSelector salonName={salonName} />
          <TopSearch />
          {/* Super Admin Platform Announcements (Oct 22 2026): the flexible centre between Search and the right-side
              Date / Clock / Notifications / Messages / Owner controls — collapses to nothing when there is no message */}
          <PlatformAnnouncementBar />

          {/* Clock and Standalone Controls hidden on screens below sm */}
          <div className="hidden sm:flex items-center gap-2 ml-auto">
            <TopClock />
            <LanguageSwitch />
            <NotificationBell badges={badges} />
            <MessageControl badges={badges} />
          </div>

          {/* Profile menu hosts Notifications & Messages on mobile */}
          <ProfileMenu badges={badges} />
        </header>

        {/* BUILD_PLAN Phase 8: high / critical Safety Community alerts, above every screen (dismiss per user). The slot is
            ALWAYS rendered — .main is a 3-row grid (header · this slot · the screen); without the slot the banner took the
            screen's 1fr row and pushed the screen into an implicit row (found by the Phase 8 browser proof). */}
        <div className="community-alert-slot" data-testid="community-alert-slot"><CommunityEmergencyBanner /></div>
        <Outlet />
        <RealtimeStatusPill />
        <RealtimeToasts />
      </div>

      {isLocked && (
        <QuickPinScreen
          onUnlock={unlock}
          onFullLogout={fullSignIn}
        />
      )}
    </div>
  );
}