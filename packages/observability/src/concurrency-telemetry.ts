// concurrency-telemetry.ts — Smooth Refresh spec §100: booking-conflict and version-conflict RATES, one counter for the
// whole platform. Incremented where each module turns a lost race into a 409, labelled by module and the stable code
// (APPOINTMENT_CONFLICT | VERSION_CONFLICT | OVERBOOK_CONFIRMATION_REQUIRED | CHECKOUT_ALREADY_IN_PROGRESS | PAYMENT_IN_PROGRESS |
// RESYNC_REQUIRED). No tenant label: per-tenant cardinality belongs in logs, not in a metric series.
import { registry } from './metrics';

export const concurrencyConflicts = registry.counter('aipowersalon_concurrency_conflicts_total',
  'Writes refused because another device changed the same thing first (409), by module and code', ['module', 'code']);

/** Count one refused write. Never throws — telemetry must not turn a clean 409 into a 500. */
export function recordConflict(module: string, code: string): void {
  try { concurrencyConflicts.inc({ module, code }); } catch { /* metrics are best-effort */ }
}
