// account.service.ts — orchestration for account deletion/deactivation requests + privacy export.
import { AccountRepository, AccountCtx } from './account.repository';
import { DeletionRequestResult, RequestType, AccountError, isUuid } from './account.dto';

const REMOVE_CUSTOMER = ['Your profile name, email, and phone number', 'Saved addresses and preferences', 'Marketing/notification opt-ins', 'Loyalty profile and points'];
const RETAIN_CUSTOMER = ['Completed payment and receipt records (financial/tax law)', 'Anonymized booking history required for salon reporting'];
const REMOVE_STAFF = ['Your login access (account deactivated)', 'Personal contact details on your profile', 'Notification opt-ins'];
const RETAIN_STAFF = ['Tickets, commissions, and cash-handoff records tied to your work (financial/audit law)', 'Business records the salon is legally required to keep'];

export class AccountService {
  constructor(private readonly repo: AccountRepository) {}

  async requestDeletion(ctx: AccountCtx, expectedRole: 'customer' | 'owner' | 'tech', body: any): Promise<DeletionRequestResult> {
    if (!isUuid(ctx.userId)) throw new AccountError('unauthenticated', 'You must be signed in.', 401);
    const requestType: RequestType = expectedRole === 'customer' ? 'delete' : 'deactivate';
    const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 1000) : null;
    const contactEmail = typeof body?.contactEmail === 'string' ? body.contactEmail.slice(0, 200) : null;

    const existing = await this.repo.findPending(ctx.userId);
    const row = existing ?? await this.repo.createRequest(ctx, requestType, reason, contactEmail);
    if (!existing) await this.repo.audit(ctx, requestType === 'delete' ? 'account_deletion_requested' : 'account_deactivation_requested', row.id, { requestType, role: ctx.role });

    const isCustomer = expectedRole === 'customer';
    return {
      requestId: row.id, status: row.status, requestType,
      submittedAt: row.requested_at ? new Date(row.requested_at).toISOString() : new Date().toISOString(),
      willRemove: isCustomer ? REMOVE_CUSTOMER : REMOVE_STAFF,
      willRetain: isCustomer ? RETAIN_CUSTOMER : RETAIN_STAFF,
      contactEmail,
      message: existing
        ? 'You already have a pending request. We will follow up at the email on your account.'
        : (isCustomer
          ? 'Your account deletion request has been received. Some financial records are retained as required by law; everything else will be removed.'
          : 'Your account deactivation request has been received. Your access will be disabled; business records tied to your work are retained as required by law.'),
    };
  }

  async privacyExport(ctx: AccountCtx): Promise<any> {
    if (!isUuid(ctx.userId)) throw new AccountError('unauthenticated', 'You must be signed in.', 401);
    const user = await this.repo.userProfile(ctx.userId);
    if (!user) throw new AccountError('not_found', 'No account found.', 404);
    const account = {
      userId: user.id, role: user.role, status: user.status,
      firstName: user.first_name, lastName: user.last_name, fullName: user.full_name,
      email: user.email, phone: user.normalized_phone,
      lastLoginAt: user.last_login_at ? new Date(user.last_login_at).toISOString() : null,
    };
    const out: any = { generatedAt: new Date().toISOString(), account, note: 'This is the personal data associated with your account. Financial/audit records required by law are retained and not included here.' };
    if ((user.role || '').toUpperCase() === 'CUSTOMER' && isUuid(user.tenant_id)) {
      const cust = await this.repo.customerRecord(user.tenant_id, user.id);
      if (cust) {
        out.customerProfile = { customerId: cust.id, fullName: cust.full_name, email: cust.email, phone: cust.phone_display, birthday: cust.birthday };
        const loy = await this.repo.loyaltyForCustomer(user.tenant_id, cust.id);
        if (loy) out.loyalty = { pointsBalance: Number(loy.points_balance ?? 0), totalEarned: Number(loy.total_earned_points ?? 0), totalRedeemed: Number(loy.total_redeemed_points ?? 0), tier: loy.loyalty_tier };
      }
    }
    return out;
  }
}
