// session.ts — identifiers the checkout lock uses. The sessionId is the lock ownership key: one per app load, so this
// device+session owns any lock it takes and its heartbeats keep it. The deviceId is a stable per-install id (persisted)
// used for display/audit. Safe fallbacks for environments without crypto.randomUUID.

function uuid(): string {
  try {
    const c = (globalThis as any).crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch { /* fall through */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// New every app load — this is the lock ownership key for this session.
export const SESSION_ID = uuid();

// Stable per install (best-effort; falls back to the session id if storage is unavailable).
export const DEVICE_ID = (() => {
  try {
    const k = 'aps_pay_device_id';
    const existing = globalThis.localStorage?.getItem(k);
    if (existing) return existing;
    const id = uuid();
    globalThis.localStorage?.setItem(k, id);
    return id;
  } catch {
    return SESSION_ID;
  }
})();
