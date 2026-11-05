// offline-session.ts — Functional Decision 33, opening the POS while OFFLINE (Oct 3 2026). Before this, a reload with
// the salon's connection down landed on the sign-in screen, so the saved copies of today's board / queue / catalog
// (offline-read-cache) were unreachable exactly when they were needed.
//
// The rule (conservative on purpose):
//   • only the LAST user who signed in on this device, and only within OFFLINE_SESSION_HOURS of their last confirmed
//     online sign-in (the same 8 hours as the idle lock's full-sign-in limit);
//   • never if this device was LOCKED (the PIN is checked by the server — offline there is no way to unlock) and never
//     after a sign-out or a server-side revocation (both forget it);
//   • read-only — every write is already refused while offline (offline-read-cache);
//   • the moment the connection is back, /auth/me decides: a valid session continues, anything else signs out.
// Nothing secret is stored: the principal (who, which salon, role, permissions) — no password, PIN, token or cookie.
import type { Principal } from '../api/authApi';
import { lockState } from '../shell/idle-lock';

export const OFFLINE_SESSION_HOURS = 8;
const KEY = 'aps_offline_session';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** After a CONFIRMED online sign-in (login, or /auth/me answering). */
export function rememberSession(p: Principal, store: Store = localStorage, nowMs: number = Date.now()): void {
  if (!p?.userId || !p?.role) return;
  const keep: Principal = { userId: p.userId, tenantId: p.tenantId ?? null, branchId: p.branchId ?? null, role: p.role, permissions: Array.isArray(p.permissions) ? p.permissions : [],
    subscriptionStatus: p.subscriptionStatus, fullName: p.fullName ?? null, restriction: p.restriction ?? null };
  try { store.setItem(KEY, JSON.stringify({ principal: keep, savedAt: nowMs })); } catch { /* storage full / blocked */ }
}
export function forgetSession(store: Store = localStorage): void { try { store.removeItem(KEY); } catch { /* ignore */ } }

/** The principal the POS may open with while offline, or null (then the sign-in screen, as before). */
export function offlineSessionPrincipal(store: Store = localStorage, nowMs: number = Date.now()): Principal | null {
  try {
    const raw = store.getItem(KEY); if (!raw) return null;
    const { principal, savedAt } = JSON.parse(raw);
    if (!principal?.userId || !principal?.role || !Number.isFinite(savedAt)) return null;
    if (nowMs - savedAt > OFFLINE_SESSION_HOURS * 3_600_000) return null;
    if (lockState(store as any, nowMs) !== 'unlocked') return null;   // a locked device stays locked offline
    if (principal.restriction) return null;                              // a restricted (billing-only) session never opens offline
    return principal as Principal;
  } catch { return null; }
}

/** Did /auth/me fail because the device is offline (no answer at all), rather than the server saying no? */
export const isNoConnection = (e: any): boolean => (typeof navigator !== 'undefined' && navigator.onLine === false) || e instanceof TypeError;
