// slo-core.ts — Constitution 11 §80–83, §106, §185, §330, §397.27: SLOs as reviewed code, and their arithmetic.
//
// §80: "Do not invent guaranteed values before load testing and production measurement." Every target below is
// therefore marked `status: 'proposed'` — a starting point to measure against, NOT a commitment and NOT a measured
// result. The System Operations screen shows that label beside every number. After 30 days of production data each
// target should be revisited and, if it holds, promoted to 'validated' in a reviewed commit (§186: SLO changes are
// reviewable because they live here, not in a dashboard).
//
// §81 — each SLO names its SLI, target, window, measurement source, what counts as a failure, what is excluded, and
// an owner. §83 — exclusions are few and stated: provider outages are NOT excluded (they still hurt the customer);
// a customer being told "no" (4xx) is not a failure because the system did its job.
//
// SOURCE. platform_request_metrics_minute (Phase 4): per-minute counts by method, route template and status class,
// kept 35 days. Every SLO below is a set of routes, so its SLI is exactly the business SLI of Phase 11 over the window.
import { WORKFLOW_ROUTES } from './sli';

export type SloKind = 'availability' | 'latency';
export type SloStatus = 'proposed' | 'validated';

export interface SloDef {
  id: string; name: string; kind: SloKind; owner: string; status: SloStatus;
  /** 0–1. For availability: share of requests without a system failure. For latency: share at or under thresholdMs. */
  target: number;
  windowDays: number;
  /** Method + route templates in scope. '*' = every route. */
  routes: readonly string[] | '*';
  thresholdMs?: number;
  counts: string; excludes: string;
}

const routesOf = (workflow: string) => Object.entries(WORKFLOW_ROUTES).filter(([, w]) => w === workflow).map(([k]) => k);

export const SLOS: readonly SloDef[] = [
  { id: 'api_availability', name: 'API availability', kind: 'availability', owner: 'platform', status: 'proposed',
    target: 0.995, windowDays: 30, routes: '*',
    counts: 'every 5xx response on any route', excludes: 'nothing — 4xx is the API working correctly, not excluded failure' },
  { id: 'booking_completion', name: 'Booking completion', kind: 'availability', owner: 'booking', status: 'proposed',
    target: 0.99, windowDays: 30, routes: routesOf('booking_completion'),
    counts: '5xx on booking creation, including dependency outages', excludes: 'slot conflicts, validation, abandonment (not requests)' },
  { id: 'phone_verification', name: 'Phone verification', kind: 'availability', owner: 'communications', status: 'proposed',
    target: 0.98, windowDays: 30, routes: [...routesOf('phone_verification'), ...routesOf('phone_verification_send')],
    counts: '5xx on send/check, INCLUDING Twilio outages (§83)', excludes: 'wrong or expired codes, rate-limit blocks (4xx)' },
  { id: 'checkout_payment', name: 'Checkout payment', kind: 'availability', owner: 'payments', status: 'proposed',
    target: 0.995, windowDays: 30, routes: routesOf('checkout_payment'),
    counts: '5xx on pay (card, cash, gift card, split), including processor outages', excludes: 'card declines (4xx / decline body)' },
  { id: 'checkout_latency', name: 'Checkout payment latency', kind: 'latency', owner: 'payments', status: 'proposed',
    target: 0.95, windowDays: 30, routes: routesOf('checkout_payment'), thresholdMs: 2500,
    counts: 'pay requests slower than 2.5 s', excludes: 'nothing' },
];

/** §104: the health component each SLO belongs to. A component already alerting covers its SLO's burn. */
export const SLO_COMPONENT: Readonly<Record<string, string>> = {
  api_availability: 'api', booking_completion: 'booking', phone_verification: 'communications',
  checkout_payment: 'checkout', checkout_latency: 'checkout',
};

export interface SloWindow { total: number; bad: number }

export interface SloReport {
  id: string; name: string; status: SloStatus; target: number; windowDays: number;
  sli: number | null;                  // null: no traffic in the window — unknown, never 100% (§332)
  total: number; bad: number;
  budgetAllowed: number | null;        // bad events the target permits over the traffic seen
  budgetRemaining: number | null;      // 1 = untouched, 0 = spent, < 0 = overspent
  burnRateFast: number | null;         // §106 over the last hour
  burnRateSlow: number | null;         // §106 over the last six hours
  alert: 'page' | 'ticket' | null;
}

/** §82: budget = what the target allows over the traffic actually seen. Remaining is a fraction of it. */
export function budget(w: SloWindow, target: number): { allowed: number | null; remaining: number | null } {
  if (w.total === 0) return { allowed: null, remaining: null };
  const allowed = w.total * (1 - target);
  return { allowed, remaining: allowed === 0 ? (w.bad === 0 ? 1 : -Infinity) : 1 - w.bad / allowed };
}

/** Burn rate: how fast the budget is being spent relative to "exactly on target". 1 = on pace to spend it all. */
export function burnRate(w: SloWindow, target: number): number | null {
  if (w.total === 0 || target >= 1) return null;
  return (w.bad / w.total) / (1 - target);
}

/**
 * §106 multi-window burn-rate alerting (the standard two pairs): PAGE when the budget would be gone in about two
 * days — 14.4× over the last hour AND still above it over the last 5 minutes, so it is happening now; TICKET when it
 * would be gone in about five days — 6× over six hours AND over 30 minutes. The short window of each pair stops a
 * past spike from paging after it has already stopped. Minimum traffic guards against 1 failure in 3 requests.
 */
export const BURN = { page: 14.4, ticket: 6, minRequests: 50 } as const;
export function burnAlert(w: { h1: SloWindow; m5: SloWindow; h6: SloWindow; m30: SloWindow }, target: number): 'page' | 'ticket' | null {
  const hot = (long: SloWindow, short: SloWindow, rate: number) =>
    long.total >= BURN.minRequests && (burnRate(long, target) ?? 0) >= rate && (burnRate(short, target) ?? 0) >= rate;
  if (hot(w.h1, w.m5, BURN.page)) return 'page';
  if (hot(w.h6, w.m30, BURN.ticket)) return 'ticket';
  return null;
}

export function report(def: SloDef, windows: { window: SloWindow; h1: SloWindow; m5: SloWindow; h6: SloWindow; m30: SloWindow }): SloReport {
  const b = budget(windows.window, def.target);
  return {
    id: def.id, name: def.name, status: def.status, target: def.target, windowDays: def.windowDays,
    sli: windows.window.total ? (windows.window.total - windows.window.bad) / windows.window.total : null,
    total: windows.window.total, bad: windows.window.bad,
    budgetAllowed: b.allowed, budgetRemaining: b.remaining,
    burnRateFast: burnRate(windows.h1, def.target), burnRateSlow: burnRate(windows.h6, def.target),
    alert: burnAlert(windows, def.target),
  };
}
