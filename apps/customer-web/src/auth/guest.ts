// guest.ts — "Continue as Guest".
//
// Guest mode is browsing, not a session. There is no token, no cookie, and no principal — so there is nothing to
// escalate. A guest can only ever reach routes that are PUBLIC on the backend (the ones explicitly excluded from
// the auth middleware: salon discovery, public services, public technicians, public availability).
//
// The security property is enforced by an allowlist, not by hoping screens behave: `isGuestAllowed()` decides
// what a guest may fetch, and anything else is refused **client-side before the request is even made** — while
// the backend independently rejects it too, because those routes are behind the session middleware. Two
// independent barriers; neither relies on the other.
//
// A guest who tries to do something real (book, save a favourite, view rewards, manage an appointment) is asked
// to sign in. They are never shown a rewards balance, an appointment, or anything belonging to a customer.

const GUEST_FLAG = 'aps_guest_mode';

/** Routes a guest may call. Everything here is PUBLIC on the backend (excluded from the auth middleware). */
const GUEST_ALLOWED: RegExp[] = [
  /^\/customer\/salons\/nearby(\?|$)/,
  /^\/customer\/salons\/[^/]+$/,
  /^\/customer\/salons\/[^/]+\/services(\?|$)/,
  /^\/customer\/salons\/[^/]+\/technicians(\?|$)/,
  /^\/customer\/salons\/[^/]+\/availability(\?|$)/,
  // Public on the backend too (excluded from TenantContextMiddleware in apps/api/src/app.module.ts): a service's
  // technicians, nearby / public technician profiles, and the guest-browsable deals marketplace (read + estimate).
  /^\/customer\/salons\/[^/]+\/services\/[^/]+\/technicians(\?|$)/,
  /^\/customer\/techs\/nearby(\?|$)/,
  /^\/customer\/techs\/[^/?]+(\?|$)/,
  /^\/customer\/deals\/nearby(\?|$)/,
  /^\/customer\/deals\/public\/[^/?]+(\/estimate)?(\?|$)/,
];

/** Anything a guest must NOT be able to reach — private, customer-scoped data. Refused before the fetch. */
export function isGuestAllowed(path: string): boolean {
  const p = String(path || '');
  return GUEST_ALLOWED.some((re) => re.test(p));
}

// Guest mode is remembered across app relaunches (localStorage) as well as for the tab (sessionStorage), and every
// change is announced on `aps:guest_change` so the app's Gate re-renders (e.g. "Sign In" from a guest screen).
export const GUEST_CHANGE_EVENT = 'aps:guest_change';
function announceGuestChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(GUEST_CHANGE_EVENT));
}

export function enterGuestMode(): void {
  try { sessionStorage.setItem(GUEST_FLAG, '1'); localStorage.setItem(GUEST_FLAG, '1'); } catch { /* private mode */ }
  announceGuestChange();
}

export function exitGuestMode(): void {
  try { sessionStorage.removeItem(GUEST_FLAG); localStorage.removeItem(GUEST_FLAG); } catch { /* private mode */ }
  announceGuestChange();
}

export function isGuest(): boolean {
  try { return sessionStorage.getItem(GUEST_FLAG) === '1' || localStorage.getItem(GUEST_FLAG) === '1'; } catch { return false; }
}

/**
 * The actions a guest may look at but not perform. Calling one of these must prompt sign-in — never silently
 * fail, and never partially proceed.
 */
export type ProtectedAction =
  | 'book' | 'reschedule' | 'cancel' | 'favorite' | 'rewards' | 'payment' | 'profile' | 'notifications' | 'messages';

export const SIGN_IN_PROMPT: Record<ProtectedAction, string> = {
  book: 'Sign in to finish booking your appointment.',
  reschedule: 'Sign in to reschedule your appointment.',
  cancel: 'Sign in to cancel your appointment.',
  favorite: 'Sign in to save your favorites.',
  rewards: 'Sign in to see your rewards and points.',
  payment: 'Sign in to manage your saved payment methods.',
  profile: 'Sign in to view your profile.',
  notifications: 'Sign in to see your notifications.',
  messages: 'Sign in to read your messages.',
};

