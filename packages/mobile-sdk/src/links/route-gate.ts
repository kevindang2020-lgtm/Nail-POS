// route-gate.ts — BUILD_PLAN Phase 13 D (Constitution 6 §62, §64): the ONE place a push tap or a deep link becomes
// navigation. A route only NAMES a destination; it opens only when the app says the current session may open it
// (`canOpen` — signed in, the right realm, the permission the screen needs). Otherwise it waits (a cold start before
// sign-in) and `retry()` opens it after sign-in — through the same check. The screen itself then loads through the API,
// which authorizes again. A route the session can never open is simply dropped at sign-out (`clear()`).
import type { PushRoute } from '@aipowersalon/api-contracts';

export interface RouteGateOptions {
  canOpen(route: PushRoute): boolean | Promise<boolean>;
  open(route: PushRoute): void;
}
export interface RouteGate {
  request(route: PushRoute | null): Promise<boolean>;
  retry(): Promise<boolean>;
  pending(): PushRoute | null;
  clear(): void;
}

export function createRouteGate(o: RouteGateOptions): RouteGate {
  let waiting: PushRoute | null = null;
  const gate: RouteGate = {
    async request(route) {
      if (!route) return false;
      let ok = false;
      try { ok = !!(await o.canOpen(route)); } catch { ok = false; }   // fail closed
      if (!ok) { waiting = route; return false; }
      waiting = null;
      try { o.open(route); } catch { /* a navigation error never crashes the tap handler */ }
      return true;
    },
    async retry() { return waiting ? gate.request(waiting) : false; },
    pending: () => waiting,
    clear() { waiting = null; },
  };
  return gate;
}
