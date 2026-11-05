// nail-photo-consent.service.ts — lets a CUSTOMER (the data subject) view and withdraw consent for their own
// before/after & service photos that a salon published. This mirrors the existing tech-side withdrawal effect
// (revoked + public_blocked → the photo drops from every public view + audited), but the authorization is the
// customer's OWN consent: the photo's nail_photo_consent.customer_id must equal the customers.id resolved from the
// signed-in customer (customers.user_id = ctx.userId). A customer can never see or touch another customer's consent.
import type { NailShowcaseContext } from './nail-showcase.repository';
// The wire type is the customer realm contract (Constitution 13 §15).
export type { MyConsentedPhoto } from '@aipowersalon/api-contracts/customer';
import type { MyConsentedPhoto } from '@aipowersalon/api-contracts/customer';

export class NailPhotoConsentError extends Error {
  constructor(public code: 'not_customer' | 'not_found' | 'invalid', message: string) { super(message); this.name = 'NailPhotoConsentError'; }
}


export interface NailPhotoConsentPort {
  resolveCustomerRecordId(ctx: NailShowcaseContext): Promise<string | null>;
  listConsentedPhotos(ctx: NailShowcaseContext, customerRecordId: string): Promise<MyConsentedPhoto[]>;
  activeConsentExists(photoId: string, customerRecordId: string, tenantId: string | null): Promise<boolean>;
  withdrawConsent(photoId: string, customerRecordId: string): Promise<void>;
  writeAudit(input: { tenantId: string | null; branchId: string | null; userId: string; role: string | null; actionType: string; entityType: string; entityId: string; metadata?: unknown }): Promise<void>;
}

export class NailPhotoConsentService {
  constructor(private readonly repo: NailPhotoConsentPort) {}

  private customerId(ctx: NailShowcaseContext): string {
    if (!ctx?.userId) throw new NailPhotoConsentError('not_customer', 'You must be signed in as a customer.');
    return ctx.userId;
  }

  /** GET /customer/my-photo-consents — the customer's active (non-revoked) photo consents. */
  async listMine(ctx: NailShowcaseContext): Promise<{ photos: MyConsentedPhoto[] }> {
    this.customerId(ctx);
    const recordId = await this.repo.resolveCustomerRecordId(ctx);
    if (!recordId) return { photos: [] }; // signed-in user isn't linked to a salon customer record → nothing to show
    return { photos: await this.repo.listConsentedPhotos(ctx, recordId) };
  }

  /** POST /customer/my-photo-consents/:photoId/withdraw — revoke consent for one of the customer's OWN photos. */
  async withdraw(ctx: NailShowcaseContext, photoId: string): Promise<{ ok: true; photoId: string }> {
    this.customerId(ctx);
    const id = String(photoId ?? '').trim();
    if (!id) throw new NailPhotoConsentError('invalid', 'A photo id is required.');
    const recordId = await this.repo.resolveCustomerRecordId(ctx);
    if (!recordId) throw new NailPhotoConsentError('not_found', 'No active consent of yours was found for this photo.');
    const owned = await this.repo.activeConsentExists(id, recordId, ctx.tenantId ?? null);
    if (!owned) throw new NailPhotoConsentError('not_found', 'No active consent of yours was found for this photo.');
    await this.repo.withdrawConsent(id, recordId); // WHERE customer_id = recordId enforces ownership at the write too
    await this.repo.writeAudit({ tenantId: ctx.tenantId ?? null, branchId: ctx.branchId || null, userId: ctx.userId, role: ctx.role ?? null, actionType: 'nail_photo_consent_withdrawn_by_customer', entityType: 'nail_photo_consent', entityId: id, metadata: { customerRecordId: recordId } });
    return { ok: true, photoId: id };
  }
}
