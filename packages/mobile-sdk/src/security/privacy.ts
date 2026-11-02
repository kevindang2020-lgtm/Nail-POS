// privacy.ts — BUILD_PLAN Phase 13 D (Constitution 6 §130, §179, §245–246): what the app switcher and an idle phone show.
//
//   installPrivacyScreen — when the app leaves the foreground (Capacitor `appStateChange` isActive=false fires on iOS
//     willResignActive, BEFORE the switcher snapshot; `visibilitychange` on the web) a neutral full-screen cover is put
//     over the UI, and removed on return. Owner, manager-pay and tech apps install it. It is best effort by nature: the OS
//     takes the snapshot, and screenshot prevention differs per platform (§130) — Android FLAG_SECURE / an iOS native
//     overlay are the native follow-up documented in SECURITY_THREAT_MODEL.md (mobile section).
//   createAutoLock — lock after N idle minutes in the foreground, or on return after N minutes in the background
//     (§245–246), and optionally at launch (a restored session). Unlocking is the app's call (AppLock.tsx: Face ID / device
//     passcode, or sign in again). Purely a CLIENT reveal-gate: the server session and its expiry are unchanged.
export interface AppStatePluginLike {
  addListener(event: 'appStateChange', cb: (s: { isActive: boolean }) => void): Promise<{ remove(): Promise<void> | void }> | { remove(): Promise<void> | void };
}

export const PRIVACY_SCREEN_ID = 'aps-privacy-screen';

export function installPrivacyScreen(o: { plugin?: AppStatePluginLike | null; doc?: Document | null; label?: string } = {}): () => void {
  const doc = o.doc ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return () => {};
  const show = () => {
    if (doc.getElementById(PRIVACY_SCREEN_ID)) return;
    const el = doc.createElement('div');
    el.id = PRIVACY_SCREEN_ID;
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;'
      + 'background:var(--aps-privacy-bg,#111827);color:#fff;font:600 18px system-ui,-apple-system,sans-serif;'
      + '-webkit-backdrop-filter:blur(24px);backdrop-filter:blur(24px)');
    el.textContent = o.label ?? 'AIPowerSalon';
    doc.body?.appendChild(el);
  };
  const hide = () => { doc.getElementById(PRIVACY_SCREEN_ID)?.remove(); };
  const onVis = () => { if (doc.visibilityState === 'hidden') show(); else hide(); };
  doc.addEventListener('visibilitychange', onVis);
  let sub: { remove(): Promise<void> | void } | null = null;
  if (o.plugin) {
    Promise.resolve(o.plugin.addListener('appStateChange', (s) => (s?.isActive ? hide() : show()))).then((x) => { sub = x; }, () => {});
  }
  return () => { doc.removeEventListener('visibilitychange', onVis); try { void sub?.remove(); } catch { /* gone */ } hide(); };
}

export interface AutoLockOptions {
  idleMs: number;
  onLock(): void;
  lockOnStart?: boolean;
  plugin?: AppStatePluginLike | null;
  doc?: Document | null;
  now?: () => number;
  /** injectable for tests */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}
export interface AutoLock { touch(): void; unlock(): void; isLocked(): boolean; stop(): void }

const ACTIVITY = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

export function createAutoLock(o: AutoLockOptions): AutoLock {
  const now = o.now ?? (() => Date.now());
  const setT = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = o.clearTimer ?? ((t) => clearTimeout(t as any));
  const doc = o.doc ?? (typeof document !== 'undefined' ? document : null);
  let locked = false; let timer: unknown = null; let backgroundAt: number | null = null;
  const lock = () => { if (locked) return; locked = true; if (timer) { clearT(timer); timer = null; } try { o.onLock(); } catch { /* the app's handler */ } };
  const arm = () => { if (timer) clearT(timer); timer = locked ? null : setT(lock, o.idleMs); };
  const toBackground = () => { backgroundAt = now(); if (timer) { clearT(timer); timer = null; } };
  const toForeground = () => {
    if (backgroundAt !== null && now() - backgroundAt >= o.idleMs) lock();
    backgroundAt = null; arm();
  };
  const onActivity = () => { if (!locked) arm(); };
  const onVis = () => (doc?.visibilityState === 'hidden' ? toBackground() : toForeground());
  for (const e of ACTIVITY) doc?.addEventListener(e, onActivity, { passive: true } as any);
  doc?.addEventListener('visibilitychange', onVis);
  let sub: { remove(): Promise<void> | void } | null = null;
  if (o.plugin) Promise.resolve(o.plugin.addListener('appStateChange', (s) => (s?.isActive ? toForeground() : toBackground()))).then((x) => { sub = x; }, () => {});
  if (o.lockOnStart) lock(); else arm();
  return {
    touch: onActivity,
    unlock() { locked = false; arm(); },
    isLocked: () => locked,
    stop() {
      if (timer) clearT(timer);
      for (const e of ACTIVITY) doc?.removeEventListener(e, onActivity);
      doc?.removeEventListener('visibilitychange', onVis);
      try { void sub?.remove(); } catch { /* gone */ }
    },
  };
}
