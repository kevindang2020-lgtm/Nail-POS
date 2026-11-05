// sli.ts — Constitution 11 §70–79, §201: business SLIs — "is the salon workflow actually working?"
//
// WHERE THEY ARE MEASURED. At the HTTP boundary, in the interceptor that already sees every request's route
// template, status and — on failure — the exception. The workflows §71 names live in a dozen services; editing
// each would repeat the scheduler mistake Phase 7 fixed (a 22nd workflow written without an SLI). Here a workflow
// is one line in WORKFLOW_ROUTES, and a guard test fails if a route in the table does not exist in any controller.
// This measures what the customer or front desk actually experienced: the request they made and how it ended.
//
// THE CLASSIFICATION (§72–73, §77, §201). Each request ends in exactly one outcome:
//   success           2xx / 3xx
//   business_failure  4xx other than 429 — slot taken, wrong code, card declined, validation. The system worked
//                     correctly and said no. NOT a reliability failure (§201: do not page for normal validation).
//   rate_limited      429 — protective behaviour, kept visible as its own outcome (§73, §77)
//   system_failure    5xx — internal error, provider outage, timeout. THE reliability failure.
// Abandonment (§72–73) is not a request and cannot be seen here; it is the gap between funnel steps, which is why
// booking is split into availability → verification → completion rather than measured as one number.
//
// THE RATIO (§72, §83). reliability = (success + business_failure + rate_limited) / all requests: the share of
// requests where the system did its job. A provider outage IS counted as a failure — §83: provider outages may be
// reported separately but still affect the customer, so they are not excluded to keep the number green. The
// category label says which kind of system failure it was, so a Twilio outage is distinguishable from our bug.
//
// CARDINALITY (§79). Labels: workflow (fixed list), outcome (4), category (normalised error code, capped by the
// registry at 200 values). Never tenant — tenant-level workflow health is the aggregator's job (§39, §339).
import { registry } from '@aipowersalon/observability';

export type SliOutcome = 'success' | 'business_failure' | 'rate_limited' | 'system_failure';

/** §71 — method + route TEMPLATE (as routeTemplateOf returns it) → workflow. Verified against the controllers. */
export const WORKFLOW_ROUTES: Readonly<Record<string, string>> = {
  'POST /auth/login': 'login',
  'GET /pos/customers/search': 'customer_search',
  'GET /customer/booking/availability': 'booking_availability',
  'GET /pos/booking/availability': 'booking_availability',
  'POST /customer/booking/verification/send': 'phone_verification_send',
  'POST /customer/booking/verification/check': 'phone_verification',
  'POST /customer/auth/activation/verify-code': 'phone_verification',
  'POST /customer/booking': 'booking_completion',
  'POST /pos/booking/appointments': 'booking_completion',
  'POST /go-check-in/session/:sessionId/check-in-appointment': 'check_in',
  'POST /go-check-in/session/:sessionId/check-in-walk-in': 'check_in',
  'POST /pos/queue/items/:queueItemId/assign-technician': 'queue_assignment',
  'POST /pos/tech-appointments/appointments/:appointmentId/assign-technician': 'queue_assignment',
  'POST /tech/tickets/:id/service-done': 'service_completion',
  'POST /pos/serving/tickets/:ticketId/mark-service-done': 'service_completion',
  'POST /pos/checkout/tickets/:ticketId/pay/card': 'checkout_payment',
  'POST /pos/checkout/tickets/:ticketId/pay/cash': 'checkout_payment',
  'POST /pos/checkout/tickets/:ticketId/pay/gift-card': 'checkout_payment',
  'POST /pos/checkout/tickets/:ticketId/pay/split': 'checkout_payment',
  'POST /pos/checkout/payments/:paymentId/refund': 'refund',
  'POST /mobile-checkout/payments/:paymentId/refund': 'refund',
};

export const sliEvents = registry.counter('aipowersalon_sli_events_total', 'Business workflow outcomes (§71)', ['workflow', 'outcome', 'category']);

export function workflowOf(method: string, route: string): string | null {
  return WORKFLOW_ROUTES[`${method.toUpperCase()} ${route}`] ?? null;
}

/** The domain code of a failure, normalised to a bounded snake_case label. Never a message (messages carry data). */
export function errorCodeOf(err: unknown): string | null {
  if (!err) return null;
  const e = err as { getResponse?: () => unknown; response?: unknown; code?: unknown; name?: string };
  const body = typeof e.getResponse === 'function' ? e.getResponse() : e.response;
  const raw = (body && typeof body === 'object' && 'code' in (body as object) ? (body as { code?: unknown }).code : undefined) ?? e.code ?? e.name;
  if (typeof raw !== 'string' || !raw) return null;
  return raw.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 48) || null;
}

export function classifyOutcome(status: number, code: string | null): { outcome: SliOutcome; category: string } {
  if (status < 400) return { outcome: 'success', category: 'ok' };
  if (status === 429) return { outcome: 'rate_limited', category: code ?? 'rate_limited' };
  if (status >= 500) {
    // §204: a dependency failure is named as one, not folded into "internal".
    const category = status === 504 ? 'timeout'
      : code && /(unavailable|provider|twilio|gateway|processor|timeout|upstream|dependency)/.test(code) ? code
      : status === 502 || status === 503 ? 'dependency_unavailable'
      : code === 'internal' || code === 'internal_error' || code === 'error' || !code ? 'internal' : code;
    return { outcome: 'system_failure', category };
  }
  return { outcome: 'business_failure', category: code ?? `http_${status}` };
}

/** Called once per request by the HTTP interceptor. Never throws into the request path. */
export function recordSli(method: string, route: string, status: number, err?: unknown): void {
  try {
    const workflow = workflowOf(method, route);
    if (!workflow) return;
    const { outcome, category } = classifyOutcome(status, status >= 400 ? errorCodeOf(err) : null);
    sliEvents.inc({ workflow, outcome, category });
  } catch { /* §286 */ }
}

export interface SliSummary { workflow: string; total: number; success: number; businessFailures: number; rateLimited: number; systemFailures: number; reliability: number | null }

/**
 * §72 — the ratio per workflow from the counters. `reliability` is null with no traffic: an unmeasured workflow is
 * UNKNOWN, never 100% (§332). This reads the process's counters; the aggregator (Phase 13) persists windows.
 */
export function sliSummaries(): SliSummary[] {
  const by = new Map<string, SliSummary>();
  for (const w of new Set(Object.values(WORKFLOW_ROUTES))) by.set(w, { workflow: w, total: 0, success: 0, businessFailures: 0, rateLimited: 0, systemFailures: 0, reliability: null });
  for (const s of sliEvents.snapshot()) {
    const row = by.get(s.labels.workflow); if (!row) continue;
    const v = s.value as number; row.total += v;
    if (s.labels.outcome === 'success') row.success += v;
    else if (s.labels.outcome === 'business_failure') row.businessFailures += v;
    else if (s.labels.outcome === 'rate_limited') row.rateLimited += v;
    else row.systemFailures += v;
  }
  for (const r of by.values()) r.reliability = r.total > 0 ? (r.total - r.systemFailures) / r.total : null;
  return [...by.values()].sort((a, b) => a.workflow.localeCompare(b.workflow));
}
