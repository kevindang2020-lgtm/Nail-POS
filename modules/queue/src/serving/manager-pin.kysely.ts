// manager-pin.kysely.ts — B-19 (Oct 22 2026): the manager-at-till PIN check behind ManagerPinPort.
//
// A manager allows a sale past the counted stock by typing her PIN on the front desk's POS. The PIN is the staff PIN every
// user already has (users.pin_hash, the same hash the POS lock screen checks through /auth/verify-pin); a "manager" is an
// active user of THIS salon whose role holds checkout.manage_overrides (OWNER / MANAGER by the role templates) AND who may
// enter THIS location (Oct 28 2026 — a manager of another location is refused; see STAFF_BRANCH_ACCESS). Wrong
// guesses are budgeted per salon + location in Postgres (5 in 15 minutes, shared by every replica — Oct 28 2026) —
// and every answer is audited by the caller (serving.service addRetail: manager_override_used, by 'manager_pin').
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { hasPermission, permissionsFor } from '@aipowersalon/permissions';
type Role = Parameters<typeof permissionsFor>[0];
import type { ManagerPinPort } from './serving.service';
import type { ServingContext } from './serving.repository';

/**
 * Kevin's instruction (Oct 28 2026): a manager's PIN works only at a location that manager may enter — and only in her own
 * salon (the user query below is keyed by the tenant). The location rule is the IDENTITY module's (enterableBranchesForUser:
 * role-template scope → user_branch_access grants → home branch; null = every location of the salon, e.g. the owner). The
 * API's composition root provides it under this token (apps/api/src/common/staff-branch-access.wiring.ts) so the queue
 * module never imports identity. Absent or unreadable → the PIN is refused (fail closed), never "any location".
 */
export const STAFF_BRANCH_ACCESS = 'STAFF_BRANCH_ACCESS';
export interface StaffBranchAccessPort { enterableBranches(tenantId: string, userId: string, role: string): Promise<string[] | null> }

export const MANAGER_PIN_MAX_FAILURES = 5;
export const MANAGER_PIN_WINDOW_MS = 15 * 60_000;

export class KyselyManagerPinPort implements ManagerPinPort {
  constructor(private readonly db: Kysely<DB>, private readonly verifyHash: (pin: string, hash: string) => Promise<boolean>, private readonly branchAccess: StaffBranchAccessPort | null = null, private readonly now: () => number = () => Date.now()) {}

  /** May this manager approve at THIS location? null rule (every location) or a list that holds the till's location. */
  private async worksHere(ctx: ServingContext, userId: string, role: string): Promise<boolean> {
    if (!this.branchAccess) { process.emitWarning('manager-pin: no location rule wired (STAFF_BRANCH_ACCESS); refusing the PIN'); return false; }
    let allowed: string[] | null;
    try { allowed = await this.branchAccess.enterableBranches(ctx.tenantId, userId, role); }
    catch (e) { process.emitWarning(`manager-pin: location rule unreadable; refusing: ${(e as Error)?.message ?? String(e)}`); return false; }
    if (allowed === null) return true;   // a salon-wide role (owner, general manager): every location of HER salon
    return !!ctx.branchId && allowed.includes(String(ctx.branchId));
  }

  /**
   * Security Deep Scan (Oct 28 2026 re-audit): the wrong-PIN budget lived in a Map in THIS process, so every API replica
   * granted its own 5 guesses (and a restart reset them). It is now one budget in Postgres for every replica, in the
   * existing auth_events table (event MANAGER_PIN_ATTEMPT, reason = the salon + location key), charged UP FRONT under an
   * advisory lock — the same shape as the sign-in attempt budget: N concurrent guesses admit at most the room left, a
   * correct PIN refunds its charge, a crash between charge and answer counts as a failure (fail closed). The window uses
   * the database clock. A budget that cannot be read refuses the guess.
   */
  private async admit(key: string, tenantId: string): Promise<string | null> {
    const win = `${MANAGER_PIN_WINDOW_MS} milliseconds`;
    let id: string | null = null;
    try {
      await this.db.transaction().execute(async (trx) => {
        await sql`select pg_advisory_xact_lock(hashtextextended(${'manager-pin:' + key}, 0))`.execute(trx);
        const tid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId) ? tenantId : null;
        const r = (await sql<{ n: number }>`select count(*)::int as n from auth_events
          where tenant_id is not distinct from ${tid}::uuid and event_type = 'MANAGER_PIN_ATTEMPT' and reason = ${key} and occurred_at > now() - ${win}::interval`.execute(trx)).rows[0];
        if (Number(r?.n ?? 0) >= MANAGER_PIN_MAX_FAILURES) return;
        const ins = (await sql<{ id: string }>`insert into auth_events (event_type, outcome, tenant_id, reason, metadata)
          values ('MANAGER_PIN_ATTEMPT', 'failure', ${tid}::uuid, ${key}, '{}'::jsonb) returning id`.execute(trx)).rows[0];
        id = ins ? String(ins.id) : null;
      });
    } catch (e) {
      process.emitWarning(`manager-pin budget unavailable; refusing the attempt: ${(e as Error)?.message ?? String(e)}`);
      return null;
    }
    return id;
  }
  private async refund(id: string): Promise<void> {
    await sql`delete from auth_events where id = ${id}::uuid and event_type = 'MANAGER_PIN_ATTEMPT'`.execute(this.db);
  }

  async verify(ctx: ServingContext, pin: string): Promise<{ userId: string; name?: string | null } | null> {
    const key = `${ctx.tenantId}:${ctx.branchId || ''}`;
    if (!/^\d{4,8}$/.test(pin)) return null;
    const charge = await this.admit(key, ctx.tenantId);
    if (!charge) return null;   // over the budget (or the budget cannot be read): refused without checking the PIN
    const rows = await sql<{ id: string; role: string; full_name: string | null; pin_hash: string }>`SELECT id, role, full_name, pin_hash FROM users
      WHERE tenant_id = ${ctx.tenantId} AND status = 'active' AND pin_hash IS NOT NULL AND role IN ('OWNER', 'MANAGER')`.execute(this.db).then((r) => r.rows);
    for (const u of rows) {
      // the role's own template set (a request context carries the effective set; here there is no request for her)
      const role = String(u.role) as Role;
      if (!hasPermission({ userId: String(u.id), tenantId: ctx.tenantId, branchId: String(ctx.branchId || ''), role, permissions: [...permissionsFor(role)] }, 'checkout.manage_overrides')) continue;
      if (!(await this.worksHere(ctx, String(u.id), role))) continue;   // a manager of another location: her PIN is not a PIN here
      if (await this.verifyHash(pin, String(u.pin_hash))) { await this.refund(charge); return { userId: String(u.id), name: u.full_name ?? null }; }
    }
    return null;   // the charge stays: one failure in the window
  }
}
