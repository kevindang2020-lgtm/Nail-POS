import type { CustomerLoyaltySummary, CustomerActiveService, CustomerNextAppointment, CustomerHome, PhoneVerifyResult, CustomerReward, RewardsView, RedeemResult, CustomerAppointmentItem, CustomerReceiptItem, CustomerNotification, CustomerNotificationsResult, CustomerAddress, CustomerDeal, CustomerReferral, CustomerProfile, CustomerSalonInfo, CustomerGiftCard } from '@aipowersalon/api-contracts/customer';
export type { CustomerLoyaltySummary, CustomerActiveService, CustomerNextAppointment, CustomerHome, PhoneVerifyResult, CustomerReward, RewardsView, RedeemResult, CustomerAppointmentItem, CustomerReceiptItem, CustomerNotification, CustomerNotificationsResult, CustomerAddress, CustomerDeal, CustomerReferral, CustomerProfile, CustomerSalonInfo, CustomerGiftCard };   // owned by packages/api-contracts (Constitution 13 §13)
// customer.dto.ts — Customer-facing app contracts (tenant + customer scoped; the customer is derived from the session).
// Loyalty tiers are a business config supplied by the caller (LoyaltyTierConfig[]), never hard-coded here. Pure helpers
// live in customer-core.ts.

export interface LoyaltyTierConfig { tier: string; threshold: number } // points threshold (include a 0-threshold base)






export interface UpdateCustomerProfileRequest {
  phone?: string; email?: string; marketingOptIn?: boolean; smsOptIn?: boolean; emailOptIn?: boolean;
  firstName?: string; lastName?: string; birthday?: string; avatarUrl?: string;
}


export interface GiftCardClaimInput { cardId: string; senderCustomerId: string; senderName?: string; tokenHash: string; recipientName?: string; recipientPhone?: string; recipientEmail?: string; message?: string; expiresAt: Date }
export interface GiftCardClaimRow { id: string; giftCardId: string; claimedAt: string | null; revokedAt: string | null; expiresAt: string }
export interface GiftCardClaimResult { ok: boolean; reference?: string; balanceCents?: number; senderName?: string; message?: string }

export interface CreateAddressRequest { label?: string | null; line1: string; line2?: string | null; city?: string | null; state?: string | null; zip?: string | null; isDefault?: boolean }
export interface CustomerCheckInResult { ok: boolean; queueItemId?: string; alreadyCheckedIn?: boolean; message?: string }
