// account.repository.ts — persistence for deletion requests + read-only privacy export (the user's OWN data only).
import { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { RequestType, isUuid } from './account.dto';

export interface AccountCtx { tenantId?: string | null; userId?: string | null; role?: string | null; }

export class AccountRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async findPending(userId: string): Promise<any | undefined> {
    return this.db.selectFrom('account_deletion_requests').selectAll().where('user_id', '=', userId).where('status', '=', 'pending').orderBy('requested_at', 'desc').executeTakeFirst().catch(() => undefined);
  }
  async createRequest(ctx: AccountCtx, requestType: RequestType, reason: string | null, contactEmail: string | null): Promise<any> {
    const row = await this.db.insertInto('account_deletion_requests').values({
      tenant_id: (ctx.tenantId as any) ?? null, user_id: ctx.userId as any, role: (ctx.role as any) ?? 'unknown',
      request_type: requestType, status: 'pending', reason, contact_email: contactEmail,
    }).returningAll().executeTakeFirst();
    return row;
  }
  async audit(ctx: AccountCtx, action: string, entityId: string | null, metadata: any): Promise<void> {
    if (!isUuid(ctx.tenantId)) return;
    try { await this.db.insertInto('owner_audit_log').values({ tenant_id: ctx.tenantId, branch_id: null, user_id: isUuid(ctx.userId) ? ctx.userId : null, role: ctx.role ?? null, action, entity_type: 'account_request', entity_id: entityId, metadata: JSON.stringify(metadata ?? {}) }).execute(); } catch { /* audit never blocks */ }
  }

  // ---- privacy export: the authenticated user's own personal data ----
  async userProfile(userId: string): Promise<any | undefined> {
    return this.db.selectFrom('users').select(['id', 'tenant_id', 'branch_id', 'first_name', 'last_name', 'full_name', 'email', 'normalized_phone', 'status', 'role', 'last_login_at']).where('id', '=', userId).executeTakeFirst().catch(() => undefined);
  }
  async customerRecord(tenantId: string, userId: string): Promise<any | undefined> {
    return this.db.selectFrom('customers').select(['id', 'first_name', 'last_name', 'full_name', 'email', 'phone_display', 'birthday']).where('tenant_id', '=', tenantId).where('user_id', '=', userId).executeTakeFirst().catch(() => undefined);
  }
  async loyaltyForCustomer(tenantId: string, customerId: string): Promise<any | undefined> {
    return this.db.selectFrom('customer_loyalty_profiles').select(['points_balance', 'total_earned_points', 'total_redeemed_points', 'loyalty_tier']).where('tenant_id', '=', tenantId).where('customer_id', '=', customerId).executeTakeFirst().catch(() => undefined);
  }
}
