import { sql } from 'kysely';
// Shared, best-effort appointment change recorder.
//
// Writes tamper-evident rows into the append-only `appointment_change_log` (migration 175).
// Design contract (identical to the original tech-appointments recorder it was extracted from):
//   • best-effort — every failure is swallowed; recording a change must NEVER break the mutation
//     that triggered it (a booking/check-in must succeed even if the audit insert fails).
//   • uses the Kysely BUILDER (insertInto), never a raw sql`` block touching a tenant table, so
//     tenant-scoped repositories that call this stay clear of the tenant-isolation CI scanner.
//   • no-op when nothing actually changed (old === new is filtered out), so callers can pass a
//     field list without pre-diffing.
//
// Each caller supplies its own `source` (e.g. 'tech_app', 'check_in') and actor metadata, so the
// change log honestly attributes which platform surface produced the change.

export type ApptChangeMeta = {
  tenantId: string;
  branchId?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  source: string;
};

export type ApptFieldChange = { field: string; old: unknown; new: unknown };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function recordAppointmentChanges(
  db: any,
  meta: ApptChangeMeta,
  appointmentId: string,
  changeType: string,
  changes: ApptFieldChange[],
): Promise<void> {
  try {
    const rows = changes
      .filter((c) => String(c.old ?? '') !== String(c.new ?? ''))
      .map((c) => ({
        tenant_id: meta.tenantId,
        branch_id: meta.branchId ?? null,
        appointment_id: appointmentId,
        change_type: changeType,
        field: c.field,
        old_value: c.old == null ? null : String(c.old),
        new_value: c.new == null ? null : String(c.new),
        actor_type: meta.actorType ?? null,
        // actor_id is a UUID column: a non-UUID actor (kiosk, customer app, test id) would make the whole insert fail and
        // the row be lost — keep the row, drop only the unrepresentable id (actor_type still says who acted).
        actor_id: meta.actorId && UUID_RE.test(String(meta.actorId)) ? meta.actorId : null,
        source: meta.source,
      }));
    if (!rows.length) return;
    // Best-effort INSIDE the caller's transaction (Sep 30 2026): a failed statement puts a PostgreSQL transaction into
    // the aborted state, and the caller's later COMMIT then silently becomes a ROLLBACK — so swallowing an error here
    // used to discard the whole appointment change (a reschedule "succeeded" and nothing moved). A savepoint confines
    // the failure to the log row. Found by the real-Postgres race test; PGlite never showed it.
    //
    // ONLY inside a transaction: most callers (assign, customer check-in, customer booking) pass the plain pool, where
    // PostgreSQL refuses SAVEPOINT ("can only be used in transaction blocks") — the first version of this fix threw
    // there, the catch below swallowed it, and those paths silently stopped writing change history.
    if (!db?.isTransaction) { await db.insertInto('appointment_change_log').values(rows).execute(); return; }
    await sql`savepoint appt_change_log`.execute(db);
    try {
      await db.insertInto('appointment_change_log').values(rows).execute();
      await sql`release savepoint appt_change_log`.execute(db);
    } catch (e) {
      await sql`rollback to savepoint appt_change_log`.execute(db).catch(() => undefined);
      throw e;
    }
  } catch {
    /* audit logging is best-effort; never breaks the mutation that triggered it */
  }
}
