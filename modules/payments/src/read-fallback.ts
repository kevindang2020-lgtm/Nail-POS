import { log } from '@aipowersalon/observability';

/**
 * A best-effort LIST read (a report panel, a history tab) that degrades to an empty list when the database errors —
 * LOGGED as a warning, never silent (check:silent-catch). Not for guard reads: a guard must fail closed, not empty.
 *   rows = await q.execute().catch(emptyOnReadError('invoices.list'))
 */
export function emptyOnReadError(what: string): (e: unknown) => never[] {
  return (e: unknown) => {
    log.warn('read failed — showing an empty list', { what, error: e instanceof Error ? e.message : String(e) });
    return [];
  };
}
