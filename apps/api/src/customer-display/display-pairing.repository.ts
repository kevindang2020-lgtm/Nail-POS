// display-pairing.repository.ts — 23-inch dual-screen spec §8–§12: a display pairs ITSELF to a salon.
//
//   the display asks for a code (public) ─→ shows it ─→ the owner types it into the POS ─→ a display row is created for
//   the owner's salon and branch (from the signed session — the display never names them) ─→ the display, polling with
//   the secret only it holds, collects its device token — minted at that moment and handed over exactly once.
//
// CROSS-TENANT BY DESIGN: a pairing belongs to no salon until staff claim it, so the public start and poll find their
// row by the code's hash or by id (the poll secret is checked by the service) — never by tenant. The claim binds the
// row to the claimer's tenant and branch, and the pickup writes only that tenant's display row. No owner credential,
// and no device token, is ever stored here: codes and secrets are kept as SHA-256 hashes.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { DisplayPlatform } from '@aipowersalon/api-contracts/customer';
export type { DisplayPlatform };

/** Who did it, for audit_logs (the display's own pickup has no user). */
export interface DisplayActor { tenantId: string; branchId: string | null; userId: string | null; role: string | null }
export interface PairingRow {
  id: string; pollSecretHash: string; expiresAt: string; platform: DisplayPlatform | null;
  tenantId: string | null; deviceId: string | null; claimedAt: string | null; consumedAt: string | null;
}
/** What the claim writes: the claimer's salon and branch (from the session), the name staff gave it, its register. */
export interface PairingClaim { tenantId: string; branchId: string; name: string; stationId: string | null }
export interface PickedUp { deviceId: string; tenantId: string; branchId: string | null; name: string }

export interface DisplayPairingPort {
  /** Housekeeping on every start: expired codes go; a display whose pickup never happened is revoked (it has no token). */
  purgeExpired(ttlSeconds: number): Promise<void>;
  /** Unclaimed, unexpired codes (a flood guard: the public start is refused above a ceiling). */
  openCount(): Promise<number>;
  /** 'code_taken' when another open pairing already holds this code (the caller draws again). */
  create(p: { codeHash: string; pollSecretHash: string; ttlSeconds: number; platform: DisplayPlatform | null }): Promise<{ id: string; expiresAt: string } | 'code_taken'>;
  byId(id: string): Promise<PairingRow | null>;
  /** ONE transaction: the open code is locked, a new display row (pairing_status 'pending', no token) is created for the
   *  claimer's salon and branch, and the code is marked claimed. null when no open code matches (wrong, used or expired). */
  claim(codeHash: string, c: PairingClaim, actor: DisplayActor): Promise<{ deviceId: string; platform: DisplayPlatform | null } | null>;
  /** The display collects its credential: exactly once, and only while its display row is live. null otherwise. */
  pickUp(id: string, tokenHash: string): Promise<PickedUp | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuidOrNull = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v : null);
/** One audit_logs row, inside the caller's transaction (the change and its record commit together). */
export async function writeDisplayAudit(trx: Kysely<DB>, actor: DisplayActor, action: string, entityType: 'customer_display' | 'pos_station', entityId: string | null, metadata: Record<string, unknown>): Promise<void> {
  await sql`
    INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
    VALUES (${actor.tenantId}, ${uuidOrNull(actor.branchId)}, ${uuidOrNull(actor.userId)}, ${actor.role}, ${action}, ${entityType}, ${entityId}, ${JSON.stringify(metadata)}::jsonb)`.execute(trx);
}

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
/** The display row's type in the POS: what the display runs on. */
export const deviceTypeFor = (p: DisplayPlatform | null): string => (p === 'android' ? 'android' : p === 'ios' ? 'ipad' : p === 'web' ? 'web_display' : 'customer_display');

export class KyselyDisplayPairingRepository implements DisplayPairingPort {
  constructor(private readonly db: Kysely<DB>) {}

  async purgeExpired(ttlSeconds: number): Promise<void> {
    // claimed but never collected within the code's lifetime: the display went away — its row (no token) is revoked
    await sql`
      UPDATE customer_display_devices d SET revoked_at = now(), pairing_status = 'unpaired', updated_at = now()
        FROM customer_display_pairings p
       WHERE p.claimed_at IS NOT NULL AND p.consumed_at IS NULL AND p.claimed_at < now() - make_interval(secs => ${ttlSeconds})
         AND d.tenant_id = p.tenant_id AND d.id = p.device_id AND d.pairing_status = 'pending' AND d.revoked_at IS NULL`.execute(this.db);
    await sql`
      DELETE FROM customer_display_pairings
       WHERE (claimed_at IS NULL AND expires_at < now())
          OR (consumed_at IS NULL AND claimed_at < now() - make_interval(secs => ${ttlSeconds}))
          OR (consumed_at < now() - interval '1 day')`.execute(this.db);
  }

  async openCount(): Promise<number> {
    const r = await sql<{ n: number }>`SELECT count(*)::int AS n FROM customer_display_pairings WHERE claimed_at IS NULL AND expires_at > now()`.execute(this.db);
    return Number(r.rows[0]?.n ?? 0);
  }

  async create(p: { codeHash: string; pollSecretHash: string; ttlSeconds: number; platform: DisplayPlatform | null }): Promise<{ id: string; expiresAt: string } | 'code_taken'> {
    const r = await sql<{ id: string; expires_at: unknown }>`
      INSERT INTO customer_display_pairings (code_hash, poll_secret_hash, expires_at, platform)
      VALUES (${p.codeHash}, ${p.pollSecretHash}, now() + make_interval(secs => ${p.ttlSeconds}), ${p.platform})
      ON CONFLICT (code_hash) WHERE claimed_at IS NULL DO NOTHING
      RETURNING id, expires_at`.execute(this.db);
    const row = r.rows[0];
    return row ? { id: String(row.id), expiresAt: iso(row.expires_at)! } : 'code_taken';
  }

  async byId(id: string): Promise<PairingRow | null> {
    if (!UUID.test(id)) return null;
    const r = await sql<any>`
      SELECT id, poll_secret_hash, expires_at, platform, tenant_id, device_id, claimed_at, consumed_at
        FROM customer_display_pairings WHERE id = ${id}`.execute(this.db);
    const x = r.rows[0];
    return x ? {
      id: String(x.id), pollSecretHash: String(x.poll_secret_hash), expiresAt: iso(x.expires_at)!, platform: (x.platform ?? null) as DisplayPlatform | null,
      tenantId: x.tenant_id ?? null, deviceId: x.device_id ?? null, claimedAt: iso(x.claimed_at), consumedAt: iso(x.consumed_at),
    } : null;
  }

  async claim(codeHash: string, c: PairingClaim, actor: DisplayActor): Promise<{ deviceId: string; platform: DisplayPlatform | null } | null> {
    return this.db.transaction().execute(async (trx) => {
      const open = await sql<{ id: string; platform: string | null }>`
        SELECT id, platform FROM customer_display_pairings
         WHERE code_hash = ${codeHash} AND claimed_at IS NULL AND expires_at > now()
         FOR UPDATE`.execute(trx);
      const p = open.rows[0];
      if (!p) return null;
      const platform = (p.platform ?? null) as DisplayPlatform | null;
      const dev = await sql<{ id: string }>`
        INSERT INTO customer_display_devices (tenant_id, branch_id, pos_station_id, device_name, device_type, pairing_status)
        VALUES (${c.tenantId}, ${c.branchId}, ${c.stationId}, ${c.name}, ${deviceTypeFor(platform)}, 'pending')
        RETURNING id`.execute(trx);
      const deviceId = String(dev.rows[0].id);
      await sql`
        UPDATE customer_display_pairings SET tenant_id = ${c.tenantId}, device_id = ${deviceId}, claimed_at = now()
         WHERE id = ${p.id} AND claimed_at IS NULL`.execute(trx);
      await writeDisplayAudit(trx, actor, 'customer_display_paired', 'customer_display', deviceId, { name: c.name, stationId: c.stationId, platform });
      return { deviceId, platform };
    });
  }

  async pickUp(id: string, tokenHash: string): Promise<PickedUp | null> {
    if (!UUID.test(id)) return null;
    return this.db.transaction().execute(async (trx) => {
      const claimed = await sql<{ tenant_id: string; device_id: string }>`
        SELECT tenant_id, device_id FROM customer_display_pairings
         WHERE id = ${id} AND claimed_at IS NOT NULL AND consumed_at IS NULL
         FOR UPDATE`.execute(trx);
      const p = claimed.rows[0];
      if (!p) return null;
      // whatever happens next, this pairing is spent: a credential is handed over once or never
      await sql`UPDATE customer_display_pairings SET consumed_at = now() WHERE id = ${id}`.execute(trx);
      const dev = await sql<{ id: string; branch_id: string | null; device_name: string | null }>`
        UPDATE customer_display_devices
           SET device_token_hash = ${tokenHash}, pairing_status = 'paired', last_seen_at = now(), updated_at = now()
         WHERE tenant_id = ${p.tenant_id} AND id = ${p.device_id} AND revoked_at IS NULL AND pairing_status = 'pending'
         RETURNING id, branch_id, device_name`.execute(trx);
      const d = dev.rows[0];
      if (!d) return null;
      await writeDisplayAudit(trx, { tenantId: String(p.tenant_id), branchId: d.branch_id ?? null, userId: null, role: 'CUSTOMER_DISPLAY' }, 'customer_display_connected', 'customer_display', String(d.id), {});
      return { deviceId: String(d.id), tenantId: String(p.tenant_id), branchId: d.branch_id ?? null, name: d.device_name || 'Customer Display' };
    });
  }
}
