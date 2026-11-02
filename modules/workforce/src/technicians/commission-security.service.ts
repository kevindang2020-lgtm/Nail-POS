import { ForbiddenException, BadRequestException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { createHash, randomBytes } from 'node:crypto';
import { isPlatformPrincipal } from '@aipowersalon/permissions';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

/** SHA-256 of the normalised code — the only form stored (column code_enc). */
export function hashCommissionAuthCode(code: string): string { return 'sha256:' + createHash('sha256').update(code.trim().toUpperCase()).digest('hex'); }
/** A new code: 10 characters from a 32-letter alphabet (no 0/O/1/I), ~50 bits from the CSPRNG. */
export function newCommissionAuthCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const b = randomBytes(10);
  return 'AUTH-COMM-' + Array.from(b, (x) => A[x % 32]).join('');
}
/** 'AUTH-COMM-ABCDEFGHJK' → 'AUTH-COMM-••••••••••' — the WHOLE secret segment is masked for the history row (the
 *  earlier last-4 mask leaked part of the code). Technician Profile merge, Oct 12 2026. */
export function maskCommissionAuthCode(code: string): string {
  const s = String(code ?? ''); const dash = s.lastIndexOf('-');
  const secret = dash >= 0 ? s.slice(dash + 1) : s;
  if (!secret.length || s.length <= 4) return '••••';
  return (dash >= 0 ? s.slice(0, dash + 1) : '') + '•'.repeat(Math.max(4, secret.length));
}
export class ForbiddenError extends ForbiddenException {
  constructor(msg = 'Invalid Admin Authorization Code. Commission change unauthorized.') {
    super(msg);
  }
}
export class ValidationError extends BadRequestException {
  constructor(msg: string) {
    super(msg);
  }
}

export interface CommissionAuditRecord {
  id: string;
  tenantId: string;
  technicianId?: string | null;
  serviceId?: string | null;
  targetType: string;
  oldCommissionPercent: number;
  newCommissionPercent: number;
  requestedByUserId: string;
  requestedByName: string;
  requestedByRole: string;
  authorizedByUserId?: string | null;
  authorizedByName?: string | null;
  authCodeUsed?: string | null;
  createdAt: string;
}

export interface RecordCommissionChangeInput {
  tenantId: string;
  branchId?: string | null;
  technicianId?: string | null;
  serviceId?: string | null;
  targetType?: 'technician' | 'service' | 'owner_creation' | 'salon_default' | string;
  oldCommissionPercent: number;
  newCommissionPercent: number;
  requestedByUserId: string;
  requestedByName: string;
  requestedByRole: string;
  authorizedByUserId?: string | null;
  authorizedByName?: string | null;
  authCodeUsed?: string | null;
}

export class CommissionSecurityService {
  /**
   * Validates Admin Authorization Code when an Owner attempts to change a technician's commission.
   * If caller is SUPER_ADMIN, no code is required.
   * If caller is OWNER / MANAGER, an active Admin Authorization Code must be supplied.
   */
  static async verifyAuthorization(
    db: Kysely<DB>,
    tenantId: string,
    role: string,
    adminAuthCode?: string | null
  ): Promise<{ authorizedByUserId: string | null; authorizedByName: string | null; codeUsed: string | null }> {
    const isSuperAdmin = isPlatformPrincipal(role);
    if (isSuperAdmin) {
      return { authorizedByUserId: 'super_admin', authorizedByName: 'Super Admin', codeUsed: 'SUPER_ADMIN_DIRECT' };
    }

    if (!adminAuthCode || !adminAuthCode.trim()) {
      throw new ForbiddenError(
        'Admin Authorization Code is required to change technician commission percentages. Please contact Super Admin for authorization.'
      );
    }

    const codeTrim = adminAuthCode.trim().toUpperCase();
    // Hardened in the Sep 2026 merge: codes are stored only as a SHA-256 hash, are issued for ONE salon (the '*' code valid
    // for every salon is gone), and are spent by a single conditional UPDATE — two simultaneous uses cannot both succeed.
    const codeHash = hashCommissionAuthCode(codeTrim);
    const spent: any = await db
      .updateTable('admin_commission_auth_codes')
      .set({ used_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .where('code_enc', '=', codeHash)
      .where('used_at', 'is', null)
      .where('expires_at', '>', new Date())
      .returning(['id', 'generated_by_user_id', 'generated_by_name'])
      .executeTakeFirst()
      .catch(() => undefined);
    if (spent) {
      return { authorizedByUserId: spent.generated_by_user_id || 'admin', authorizedByName: spent.generated_by_name || 'Super Admin', codeUsed: maskCommissionAuthCode(codeTrim) };
    }
    // no usable code: say why when it exists but is spent/expired, without confirming codes for other salons
    const known: any = await db.selectFrom('admin_commission_auth_codes').where('tenant_id', '=', tenantId).where('code_enc', '=', codeHash)
      .select(['used_at', 'expires_at']).executeTakeFirst().catch(() => undefined);
    if (known?.used_at) throw withCode(new ValidationError('This Admin Authorization Code has already been used once. Each authorization code is valid for one-time use only.'), 'ADMIN_CODE_USED');
    if (known) throw withCode(new ValidationError('Admin Authorization Code has expired.'), 'ADMIN_CODE_EXPIRED');

    throw new ForbiddenError('Invalid Admin Authorization Code. Commission change unauthorized.');
  }

  /**
   * Records a complete history log entry for a commission percentage change.
   */
  static async recordChange(db: Kysely<DB>, input: RecordCommissionChangeInput): Promise<CommissionAuditRecord> {
    const row = {
      tenant_id: input.tenantId,
      branch_id: input.branchId || null,
      technician_id: input.technicianId || null,
      service_id: input.serviceId || null,
      target_type: input.targetType || 'technician',
      old_commission_percent: input.oldCommissionPercent,
      new_commission_percent: input.newCommissionPercent,
      requested_by_user_id: input.requestedByUserId,
      requested_by_name: input.requestedByName,
      requested_by_role: input.requestedByRole,
      authorized_by_user_id: input.authorizedByUserId || null,
      authorized_by_name: input.authorizedByName || null,
      auth_code_used: input.authCodeUsed || null,
    };

    const ins: any = await db
      .insertInto('commission_change_audit_logs')
      .values(row)
      .returningAll()
      .executeTakeFirstOrThrow();

    return {
      id: ins.id,
      tenantId: ins.tenant_id,
      technicianId: ins.technician_id,
      serviceId: ins.service_id,
      targetType: ins.target_type,
      oldCommissionPercent: Number(ins.old_commission_percent || 0),
      newCommissionPercent: Number(ins.new_commission_percent || 0),
      requestedByUserId: ins.requested_by_user_id,
      requestedByName: ins.requested_by_name,
      requestedByRole: ins.requested_by_role,
      authorizedByUserId: ins.authorized_by_user_id,
      authorizedByName: ins.authorized_by_name,
      authCodeUsed: ins.auth_code_used,
      createdAt: new Date(ins.created_at).toISOString(),
    };
  }

  /**
   * Fetches commission change history for a tenant / technician.
   */
  static async getHistory(
    db: Kysely<DB>,
    tenantId: string,
    technicianId?: string
  ): Promise<CommissionAuditRecord[]> {
    let q = db
      .selectFrom('commission_change_audit_logs')
      .where('tenant_id', '=', tenantId);

    if (technicianId) {
      q = q.where('technician_id', '=', technicianId);
    }

    const rows: any[] = await q
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute()
      .catch(() => []);

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      technicianId: r.technician_id,
      serviceId: r.service_id,
      targetType: r.target_type,
      oldCommissionPercent: Number(r.old_commission_percent || 0),
      newCommissionPercent: Number(r.new_commission_percent || 0),
      requestedByUserId: r.requested_by_user_id,
      requestedByName: r.requested_by_name,
      requestedByRole: r.requested_by_role,
      authorizedByUserId: r.authorized_by_user_id,
      authorizedByName: r.authorized_by_name,
      authCodeUsed: r.auth_code_used,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }
}
