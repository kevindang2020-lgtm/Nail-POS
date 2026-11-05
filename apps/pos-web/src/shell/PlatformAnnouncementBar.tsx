// PlatformAnnouncementBar.tsx — the POS top-bar Platform Announcement (Super Admin POS Top-Bar Announcement & Platform
// Broadcast mandate, Oct 22 2026). ONE shared component in the shared header (POSLayout), between Global Search and the
// Date / Clock / Notifications / Messages / Owner controls — every authenticated POS page gets it (§79–§80).
//
//  • Data: GET /pos/platform-announcements/active is the authority (server-side targeting by the session's salon +
//    branch). Fetched on load, refetched on the `platform_announcement_updated` realtime signal, on reconnect / wake, by
//    the background safety sync, and at the snapshot's `nextChangeAt` (a scheduled start or an end) — never a page
//    refresh, never a flash of the header (§71–§75). Nothing renders until the first snapshot; nothing when empty (§112–§113).
//  • Failure isolation: any error keeps what is on screen (or nothing) and is logged — Booking, Check-In, Queue,
//    Checkout and Payments are never affected (§114–§115).
//  • Display: the highest-priority item; one line when short, two lines when needed, beyond that a clamp + More, which
//    opens the full text without leaving the screen (§27–§32). Equal-priority NORMAL / LOW items rotate every 8 s,
//    paused while hovered / focused / open; a HIGH or CRITICAL item stays pinned (§42–§47). No marquee, no HTML — text
//    nodes only (§45, §90).
//  • Dismiss (when allowed) and "I understand" (when required) are recorded per signed-in employee on the server (§35–§39).
//  • Language (English + Vietnamese POS mandate WP-F, §56): the snapshot carries the English text and, when the platform
//    wrote one, the Vietnamese version. A Vietnamese POS shows the Vietnamese version; with none it shows the English. The
//    choice is made at render (`announcementText`), so a language switch re-renders in place — no refetch.
//  • Ordering (§72, Oct 27): every snapshot request carries a sequence number; a response older than the one already
//    applied — by sequence, or by the server's own `serverTime` — is dropped, so the mount load, the realtime / safety-sync
//    refetch and the `nextChangeAt` timer can overlap without an older answer overwriting a newer one. A local dismiss /
//    acknowledge also retires every request started before it (a snapshot taken before the dismiss cannot bring it back).
//  • Failures are logged AND counted (§116): announcement-telemetry.ts → aipowersalon_client_events_total{app="pos"}.
//  • Accessibility (§106, Oct 27): the More panel is a modal dialog — aria-modal, focus moves into it, Tab / Shift+Tab stay
//    inside, Escape or Close returns focus to More. Tone colours meet WCAG AA (TONE_CONTRAST below; measured in the test).
//  • Icons (§34): the POS icon library (react-icons/fi, as POSLayout / Walk-In / New Booking) — no hand-drawn paths.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FiAlertTriangle, FiInfo, FiTool, FiX } from 'react-icons/fi';
import { reportAnnouncementFailure } from './announcement-telemetry';
import { announcementText, type PosPlatformAnnouncement } from '@aipowersalon/api-contracts/tenant';
import { platformAnnouncementsApi } from '../api/posPlatformAnnouncementsApi';
import { useRealtime } from '../realtime/useRealtime';
import { t, getLanguage, useLanguage } from '@aipowersalon/mobile-sdk/i18n';


const ROTATE_MS = 8_000;
/**
 * Severity tones (§22). `ink` = the message text on `bg`; `strong` = the type icon and the type label (on `bg` and on the
 * panel's #FFFEFB) — both are text / meaningful graphics, so each is held to WCAG AA 4.5:1 (§106; measured in
 * PlatformAnnouncementBar.test.tsx). `accent` is only the decorative left stripe (the old gold #B8925A / amber #C98A12 were
 * 2.7:1 as icon and label colours — they stay on the stripe, where no information depends on them).
 */
export const PANEL_BG = '#FFFEFB';
export const TONE: Record<string, { bg: string; border: string; ink: string; strong: string; accent: string }> = {
  info: { bg: '#FBF6EC', border: '#EADBBE', ink: '#5B4A2C', strong: '#8A6420', accent: '#B8925A' },
  update: { bg: '#FBF6EC', border: '#EADBBE', ink: '#5B4A2C', strong: '#8A6420', accent: '#B8925A' },
  maintenance: { bg: '#FFF4DE', border: '#F0D49A', ink: '#6B4A14', strong: '#8C5A00', accent: '#C98A12' },
  warning: { bg: '#FFF4DE', border: '#F0D49A', ink: '#6B4A14', strong: '#8C5A00', accent: '#C98A12' },
  urgent: { bg: '#FBE5E0', border: '#E9B5A8', ink: '#6E2410', strong: '#B4381E', accent: '#B4381E' },
};
const toneOf = (a: PosPlatformAnnouncement) => (a.priority === 'critical' ? TONE.urgent : TONE[a.type] ?? TONE.info);
const TYPE_LABELS: Array<{ id: string; label: string }> = [{ id: 'info', get label() { return t('pos.info'); } }, { id: 'update', get label() { return t('pos.update'); } }, { id: 'maintenance', get label() { return t('pos.maintenance_3'); } }, { id: 'warning', get label() { return t('pos.warning_2'); } }, { id: 'urgent', get label() { return t('pos.urgent'); } }];
const label = (a: PosPlatformAnnouncement) => TYPE_LABELS.find((x) => x.id === a.type)?.label ?? '';
const logFailure = (what: string, e: unknown) => { try { console.warn(`[platform-announcements] ${what}`, (e as Error)?.message ?? e); } catch { /* console unavailable */ } };
// a CSS selector, not text: built from its parts so the POS i18n scanner does not read it as an English sentence
const FOCUSABLE = [...['button', 'input', 'select', 'textarea'].map((el) => `${el}:not([disabled])`), '[href]', '[tabindex]:not([tabindex="-1"])'].join(',');

function TypeIcon({ a }: { a: PosPlatformAnnouncement }) {
  const Icon = a.type === 'urgent' || a.priority === 'critical' || a.type === 'warning' ? FiAlertTriangle : a.type === 'maintenance' ? FiTool : FiInfo;
  return <Icon size={16} color={toneOf(a).strong} aria-hidden="true" focusable="false" style={{ flex: '0 0 auto' }} data-icon={Icon === FiAlertTriangle ? 'alert' : Icon === FiTool ? 'tool' : 'info'} />;
}

export function PlatformAnnouncementBar() {
  const language = useLanguage();   // WP-F: re-render (not refetch) on a switch
  const [items, setItems] = useState<PosPlatformAnnouncement[] | null>(null);   // null = no snapshot yet → render nothing
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [overflow, setOverflow] = useState(false);
  const [live, setLive] = useState('');
  const textRef = useRef<HTMLSpanElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // §72: request ordering — `issued` numbers each snapshot request, `applied` is the newest one whose answer is on screen
  // (or that a local change superseded); `appliedServerTime` is that answer's server clock.
  const issued = useRef(0);
  const applied = useRef(0);
  const appliedServerTime = useRef(0);
  const nextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const delivered = useRef<Set<string>>(new Set());
  const loadRef = useRef<() => Promise<void>>(async () => undefined);

  const load = useCallback(async (reason?: string) => {
    const seq = ++issued.current;
    try {
      const s = await platformAnnouncementsApi.active();
      // §72: an answer to an OLDER request than the one already applied is stale — drop it (a later answer always wins)
      if (seq <= applied.current) return;
      const st = s?.serverTime ? Date.parse(s.serverTime) : NaN;
      if (Number.isFinite(st) && st < appliedServerTime.current) return;   // the server's own clock says it is older
      applied.current = seq;
      if (Number.isFinite(st)) appliedServerTime.current = st;
      const list = Array.isArray(s?.announcements) ? s.announcements : [];
      setItems(list);
      // §107: speak only a newly-arrived HIGH / CRITICAL notice, once — never every rotating routine message
      const fresh = list.find((a) => (a.priority === 'critical' || a.priority === 'high') && !seenIds.current.has(`${a.id}:${a.contentVersion}`));
      list.forEach((a) => seenIds.current.add(`${a.id}:${a.contentVersion}`));
      if (fresh) { const x = announcementText(fresh, getLanguage()); setLive(`${label(fresh)}: ${x.title ? `${x.title}. ` : ''}${x.message}`); }
      // a scheduled start or an end refetches at that instant (the server's time — no browser clock arithmetic beyond the delay)
      if (nextTimer.current) clearTimeout(nextTimer.current);
      if (s?.nextChangeAt && s?.serverTime) {
        const wait = Math.min(Math.max(new Date(s.nextChangeAt).getTime() - new Date(s.serverTime).getTime() + 500, 1_000), 6 * 3_600_000);
        nextTimer.current = setTimeout(() => { void loadRef.current(); }, wait);
      }
    } catch (e) {
      logFailure('snapshot failed — keeping the current header', e);   // §114: never breaks the POS
      reportAnnouncementFailure(reason === 'manual' || reason === 'reconcile' ? 'realtime' : 'snapshot');   // §116: counted
    }
  }, []);
  loadRef.current = load;
  useEffect(() => { void load(); return () => { if (nextTimer.current) clearTimeout(nextTimer.current); }; }, [load]);
  useRealtime(['platform-announcements'], (reason) => load(reason), { intervalMs: 60_000 });

  const list = items ?? [];
  const top = list[0];
  // rotation pool: the items sharing the top item's priority, only for NORMAL / LOW (HIGH / CRITICAL stay pinned)
  const pool = top && (top.priority === 'normal' || top.priority === 'low') ? list.filter((a) => a.priority === top.priority) : top ? [top] : [];
  const current = pool.length ? pool[Math.min(index, pool.length - 1)] : undefined;
  useEffect(() => { if (index >= pool.length) setIndex(0); }, [pool.length, index]);
  useEffect(() => {
    if (pool.length < 2 || hover || open) return undefined;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const id = setTimeout(() => setIndex((i) => (i + 1) % pool.length), reduce ? ROTATE_MS * 2 : ROTATE_MS);
    return () => clearTimeout(id);
  }, [pool.length, hover, open, index]);

  // first delivery per employee per content version (aggregate analytics — never claims it was read, §117)
  useEffect(() => {
    if (!current) return;
    const k = `${current.id}:${current.contentVersion}`;
    if (delivered.current.has(k)) return;
    delivered.current.add(k);
    platformAnnouncementsApi.delivered(current.id, current.contentVersion).catch((e) => { logFailure('delivery record failed', e); reportAnnouncementFailure('receipt'); });
  }, [current]);

  // does the two-line clamp hide text? then More is offered (§28–§32)
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) { setOverflow(false); return; }
    setOverflow(el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
  }, [current?.id, current?.contentVersion, current?.message, items, language]);

  const act = async (a: PosPlatformAnnouncement, kind: 'dismiss' | 'acknowledge') => {
    setBusy(`${kind}:${a.id}`);
    applied.current = issued.current;   // §72: a snapshot requested before this change must not undo it
    try {
      if (kind === 'dismiss') { await platformAnnouncementsApi.dismiss(a.id, a.contentVersion); setItems((xs) => (xs ?? []).filter((x) => x.id !== a.id)); }
      else { await platformAnnouncementsApi.acknowledge(a.id, a.contentVersion); setItems((xs) => (xs ?? []).map((x) => (x.id === a.id ? { ...x, acknowledged: true } : x))); }
    } catch (e) { logFailure(`${kind} failed`, e); reportAnnouncementFailure('receipt'); void load(); }
    finally { setBusy(null); }
  };
  // §106: the More panel is a modal dialog — focus moves in, Tab / Shift+Tab cycle inside it, Escape closes and focus
  // returns to More (or, when More is gone because the list changed, to the bar's region).
  const closePanel = useCallback(() => {
    setOpen(false);
    setTimeout(() => { (moreRef.current ?? document.querySelector<HTMLElement>('[data-testid="platform-announcement"]'))?.focus?.(); }, 0);
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panelRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closePanel(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const f = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (f.length === 0) { e.preventDefault(); panelRef.current.focus(); return; }
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closePanel]);
  useEffect(() => { if (list.length === 0 && open) closePanel(); }, [list.length, open, closePanel]);

  const liveRegion = <span aria-live="polite" role="status" className="pa-sr">{live}</span>;
  if (!current) return <div className="pa-slot pa-empty" data-testid="platform-announcement-slot">{liveRegion}</div>;
  const tone = toneOf(current);
  const text = announcementText(current, language);
  const needsAck = current.requiresAcknowledgement && !current.acknowledged;
  return (
    <div className="pa-slot" data-testid="platform-announcement-slot" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
      {liveRegion}
      <div className={`pa-bar pa-${current.priority}`} role="region" aria-label={t('pos.platform_announcement')} data-testid="platform-announcement" tabIndex={-1}
        style={{ background: tone.bg, borderColor: tone.border, color: tone.ink, borderLeftColor: tone.accent }}>
        <TypeIcon a={current} />
        <span ref={textRef} className="pa-text" data-testid="platform-announcement-text" lang={text.language}>
          {text.title ? <strong>{text.title}: </strong> : null}{text.message}
        </span>
        <span className="pa-actions">
          {overflow || list.length > 1 ? (
            <button ref={moreRef} type="button" className="pa-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
              {list.length > 1 ? t('pos.more_v0', { v0: String(list.length - 1) }) : t('pos.more_2')}
            </button>
          ) : null}
          {needsAck ? <button type="button" className="pa-btn pa-strong" disabled={busy !== null} onClick={() => act(current, 'acknowledge')}>{t('pos.i_understand')}</button> : null}
          {current.dismissible && !needsAck ? (
            <button type="button" className="pa-x" aria-label={t('pos.dismiss_announcement')} disabled={busy !== null} onClick={() => act(current, 'dismiss')}>
              <FiX size={14} aria-hidden="true" focusable="false" />
            </button>
          ) : null}
        </span>
      </div>
      {open ? (
        <div ref={panelRef} className="pa-panel" role="dialog" aria-modal="true" aria-label={t('pos.platform_announcements')} data-testid="platform-announcement-panel" tabIndex={-1}>
          {list.map((a) => {
            const tn = toneOf(a);
            const ack = a.requiresAcknowledgement && !a.acknowledged;
            const x = announcementText(a, language);
            return (
              <div key={a.id} className="pa-item" style={{ borderLeftColor: tn.accent }} lang={x.language}>
                <div className="pa-item-head"><TypeIcon a={a} /><span className="pa-kind" style={{ color: tn.strong }}>{label(a)}</span>{x.title ? <strong>{x.title}</strong> : null}</div>
                <div className="pa-full">{x.message}</div>
                <div className="pa-item-actions">
                  {ack ? <button type="button" className="pa-btn pa-strong" disabled={busy !== null} onClick={() => act(a, 'acknowledge')}>{t('pos.i_understand')}</button> : null}
                  {a.dismissible && !ack ? <button type="button" className="pa-btn" disabled={busy !== null} onClick={() => act(a, 'dismiss')}>{t('pos.dismiss')}</button> : null}
                </div>
              </div>
            );
          })}
          <button type="button" className="pa-btn pa-close" onClick={closePanel}>{t('pos.close')}</button>
        </div>
      ) : null}
    </div>
  );
}
