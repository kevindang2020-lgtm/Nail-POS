// session.ts — identifiers the checkout lock uses. The sessionId is the lock ownership key: one per app load, so this
// device+session owns any lock it takes and its heartbeats keep it.
//
// DEVICE_ID (Secure Tap to Pay M6-4) is THE one id of this phone, used everywhere: the login body's device.id (the
// server's sessions.device_id — what revoking the phone ends), /auth/select-branch, POST mobile-checkout/device/register,
// every deviceId field, the X-Device-ID header and the signed x-aps-device-id header. It is bound to the phone's P-256
// key (src/device/deviceKeys.ts keeps both together); when that identity is wiped (the phone was removed, or its key is
// gone), a NEW id is minted — the old one is final on the server. It is a live binding: importers always read the
// current value.
import { adoptDeviceId } from '@aipowersalon/mobile-sdk';

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

export const DEVICE_ID_KEY = 'aps_pay_device_id';

function readOrMint(): string {
  try {
    const existing = globalThis.localStorage?.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = uuid();
    globalThis.localStorage?.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return SESSION_ID;
  }
}

// Stable per install (best-effort; falls back to the session id if storage is unavailable).
export let DEVICE_ID = readOrMint();
adoptDeviceId(DEVICE_ID);

/** Make `id` this phone's id (persisted) — used when the stored key record names the id it is bound to. */
export function setDeviceId(id: string): void {
  DEVICE_ID = id;
  try { globalThis.localStorage?.setItem(DEVICE_ID_KEY, id); } catch { /* the in-memory binding still holds for this run */ }
  adoptDeviceId(id);
}
/** A brand-new id for a brand-new identity (the previous one is revoked or lost its key). */
export function mintNewDeviceId(): string { const id = uuid(); setDeviceId(id); return id; }
