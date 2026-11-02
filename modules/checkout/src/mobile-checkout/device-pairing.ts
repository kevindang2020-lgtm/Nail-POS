// device-pairing.ts — Secure Tap to Pay mandate §7 / §70 (Oct 23 2026): the optional POS QR pairing. An authorized POS user
// (pos.devices.manage, fresh step-up) creates a SHORT-LIVED, SINGLE-USE pairing code scoped to the tenant, a branch and
// the purpose "tap_to_pay_device"; the phone scans it, the employee signs in, and the registration presents the code. The
// code is 32 random bytes; only its sha256 is stored. No password, token, merchant or provider secret is ever in it.
// Consumption is one conditional UPDATE (unused, unexpired, same tenant) — a replay or an expired code matches nothing.
import { createHash, randomBytes } from 'node:crypto';
import { sql, type Kysely } from 'kysely';

export const PAIRING_TTL_MS = 5 * 60_000;
export const PAIRING_PURPOSE = 'tap_to_pay_device' as const;
export const pairingHash = (code: string) => createHash('sha256').update(String(code)).digest('hex');
export const newPairingCode = () => randomBytes(32).toString('base64url');

export interface PairingRecord { id: string; tenantId: string; branchId: string; createdBy: string; expiresAt: string; label: string | null; shared: boolean }
export interface DevicePairingStore {
  create(p: { tenantId: string; branchId: string; createdBy: string; label?: string | null; codeHash: string; expiresAt: Date; shared?: boolean }): Promise<PairingRecord>;
  /** Single use: the pairing for this code in this tenant, if unused and unexpired — marked used in the same statement. */
  consume(tenantId: string, codeHash: string, by: { userId: string; deviceId: string }, now: Date): Promise<PairingRecord | null>;
}

export class InMemoryDevicePairingStore implements DevicePairingStore {
  private rows = new Map<string, PairingRecord & { codeHash: string; usedAt: string | null }>();
  async create(p: { tenantId: string; branchId: string; createdBy: string; label?: string | null; codeHash: string; expiresAt: Date; shared?: boolean }): Promise<PairingRecord> {
    const r = { id: randomBytes(8).toString('hex'), tenantId: p.tenantId, branchId: p.branchId, createdBy: p.createdBy, expiresAt: p.expiresAt.toISOString(), label: p.label ?? null, shared: !!p.shared, codeHash: p.codeHash, usedAt: null };
    this.rows.set(p.codeHash, r); return r;
  }
  async consume(tenantId: string, codeHash: string, _by: { userId: string; deviceId: string }, now: Date): Promise<PairingRecord | null> {
    const r = this.rows.get(codeHash);
    if (!r || r.tenantId !== tenantId || r.usedAt || Date.parse(r.expiresAt) <= now.getTime()) return null;
    r.usedAt = now.toISOString(); return r;
  }
}

export class KyselyDevicePairingStore implements DevicePairingStore {
  constructor(private readonly db: Kysely<any>) {}
  async create(p: { tenantId: string; branchId: string; createdBy: string; label?: string | null; codeHash: string; expiresAt: Date; shared?: boolean }): Promise<PairingRecord> {
    const r: any = await sql`insert into payment_device_pairings (tenant_id, branch_id, purpose, code_hash, label, created_by, expires_at, shared)
      values (${p.tenantId}, ${p.branchId}, ${PAIRING_PURPOSE}, ${p.codeHash}, ${p.label ?? null}, ${p.createdBy}, ${p.expiresAt}, ${!!p.shared})
      returning id, tenant_id, branch_id, created_by, expires_at, label, shared`.execute(this.db);
    return map(r.rows[0]);
  }
  async consume(tenantId: string, codeHash: string, by: { userId: string; deviceId: string }, now: Date): Promise<PairingRecord | null> {
    const r: any = await sql`update payment_device_pairings set used_at = ${now}, used_by_user_id = ${by.userId}, used_device_id = ${by.deviceId}
      where code_hash = ${codeHash} and tenant_id = ${tenantId} and purpose = ${PAIRING_PURPOSE} and used_at is null and expires_at > ${now}
      returning id, tenant_id, branch_id, created_by, expires_at, label, shared`.execute(this.db);
    return r.rows[0] ? map(r.rows[0]) : null;
  }
}
function map(r: any): PairingRecord {
  return { id: String(r.id), tenantId: String(r.tenant_id), branchId: String(r.branch_id), createdBy: String(r.created_by), expiresAt: new Date(r.expires_at).toISOString(), label: r.label ?? null, shared: !!r.shared };
}
