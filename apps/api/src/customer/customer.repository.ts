// customer.repository.ts — data port for the customer-facing app + an honest empty in-memory adapter. CustomerService
// owns resolution/validation; this port abstracts the reads/writes (resolve customer from session, home pieces,
// appointments, receipts, loyalty points, active-service, profile update) + the loyalty-tier config. The Postgres
// (Kysely) adapter is deferred; the in-memory adapter resolves no customer (so a DB-less deployment reports nothing).
import type { CustomerNextAppointment, CustomerAppointmentItem, CustomerReceiptItem, LoyaltyTierConfig, UpdateCustomerProfileRequest, CustomerSalonInfo , CustomerNotification, CustomerGiftCard, GiftCardClaimInput, GiftCardClaimRow, GiftCardClaimResult, CustomerAddress, CreateAddressRequest, CustomerDeal, CustomerProfile, CustomerCheckInResult, RewardsView, RedeemResult} from './customer.dto';
import type { ActiveServiceRaw } from './customer-core';
import type { CustomerQueueRaw } from './customer-queue';

export interface CustomerContext { tenantId: string; branchId: string; userId: string; role: string; permissions: string[]; }

export interface CustomerHomeRaw {
  customerName: string; avatarUrl?: string | null; points: number; nextAppointment?: CustomerNextAppointment;
  activeService?: ActiveServiceRaw; recentVisitsCount: number;
}

export interface HomeSalon { salonId: string; salonName: string; city: string | null }
export interface SetHomeSalonResult { ok: boolean; message?: string; salonName?: string; /** true = a different salon business: sign in again to land there */ requiresSignIn?: boolean }
export interface CustomerDataPort {
  resolveCustomerId(ctx: CustomerContext): Promise<string | null>;
  /** The customer's default salon location (their home branch) — Oct 3 2026. */
  homeSalon?(ctx: CustomerContext, customerId: string): Promise<HomeSalon | null>;
  /** Change it: same salon business → immediately; another one → their account there (created if needed) becomes the default. */
  setHomeSalon?(ctx: CustomerContext, customerId: string, salonId: string): Promise<SetHomeSalonResult>;
  /** §26 platform kill switch (tenant_app_flags.customer_service_progress). */
  serviceProgressEnabled(ctx: CustomerContext): Promise<boolean>;
  getLoyaltyConfig(ctx: CustomerContext): Promise<LoyaltyTierConfig[]>;
  homeRaw(ctx: CustomerContext, customerId: string): Promise<CustomerHomeRaw>;
  appointments(ctx: CustomerContext, customerId: string): Promise<CustomerAppointmentItem[]>;
  receipts(ctx: CustomerContext, customerId: string): Promise<CustomerReceiptItem[]>;
  loyaltyPoints(ctx: CustomerContext, customerId: string): Promise<number>;
  activeService(ctx: CustomerContext, customerId: string): Promise<ActiveServiceRaw | null>;
  updateProfile(ctx: CustomerContext, customerId: string, patch: UpdateCustomerProfileRequest): Promise<void>;
  customerQueue(ctx: CustomerContext, customerId: string): Promise<CustomerQueueRaw | null>;
  salonInfo(ctx: CustomerContext): Promise<CustomerSalonInfo | null>;
  notifications(ctx: CustomerContext, customerId: string): Promise<CustomerNotification[]>;
  giftCards(ctx: CustomerContext, customerId: string): Promise<CustomerGiftCard[]>;
  // Send-to-friend (§10): verify a transferable owned card, create a claim token, and transfer on claim.
  giftCardForTransfer(ctx: CustomerContext, customerId: string, cardId: string): Promise<{ id: string; status: string; balanceCents: number } | null>;
  createGiftCardClaim(ctx: CustomerContext, args: GiftCardClaimInput): Promise<{ senderName: string | null }>;
  recordGiftCardDelivery(ctx: CustomerContext, args: { cardId: string; channel: 'sms' | 'email' | 'in_app' | 'link'; destination?: string; status: string; providerMessageId?: string; failureReason?: string }): Promise<void>;
  findGiftCardClaimByHash(ctx: CustomerContext, tokenHash: string): Promise<GiftCardClaimRow | null>;
  claimGiftCardTransfer(ctx: CustomerContext, claimId: string, giftCardId: string, claimerCustomerId: string): Promise<GiftCardClaimResult>;
  // §22 report lost/stolen: freeze an owned card (protects the balance) and revoke its outstanding barcodes.
  reportGiftCardLost(ctx: CustomerContext, customerId: string, cardId: string): Promise<{ ok: boolean; reason?: string }>;
  markNotificationsRead(ctx: CustomerContext, customerId: string): Promise<void>;
  cancelAppointment(ctx: CustomerContext, customerId: string, appointmentId: string): Promise<boolean>;
  listAddresses(ctx: CustomerContext, customerId: string): Promise<CustomerAddress[]>;
  createAddress(ctx: CustomerContext, customerId: string, body: CreateAddressRequest): Promise<CustomerAddress>;
  deleteAddress(ctx: CustomerContext, customerId: string, id: string): Promise<boolean>;
  setDefaultAddress(ctx: CustomerContext, customerId: string, id: string): Promise<boolean>;
  listDeals(ctx: CustomerContext): Promise<CustomerDeal[]>;
  getOrCreateReferralCode(ctx: CustomerContext, customerId: string): Promise<string>;
  profile(ctx: CustomerContext, customerId: string): Promise<CustomerProfile>;
  checkInAppointment(ctx: CustomerContext, customerId: string, appointmentId: string): Promise<CustomerCheckInResult>;
  listRewards(ctx: CustomerContext, customerId: string): Promise<RewardsView>;
  redeemReward(ctx: CustomerContext, customerId: string, rewardId: string): Promise<RedeemResult>;
  customerBranchId(ctx: CustomerContext, customerId: string): Promise<string | null>;
}

export class InMemoryCustomerRepository implements CustomerDataPort {
  /** test hook for the §26 kill switch */
  serviceProgressFlag = true;
  async serviceProgressEnabled(_ctx: CustomerContext) { return this.serviceProgressFlag; }

  async resolveCustomerId(): Promise<string | null> { return null; }
  async getLoyaltyConfig(): Promise<LoyaltyTierConfig[]> { return []; }
  async homeRaw(_c: CustomerContext, _id: string): Promise<CustomerHomeRaw> { return { customerName: '', points: 0, recentVisitsCount: 0 }; }
  async appointments(): Promise<CustomerAppointmentItem[]> { return []; }
  async receipts(): Promise<CustomerReceiptItem[]> { return []; }
  async loyaltyPoints(): Promise<number> { return 0; }
  async activeService(): Promise<ActiveServiceRaw | null> { return null; }
  async updateProfile(): Promise<void> { /* no-op */ }
  async customerQueue(): Promise<CustomerQueueRaw | null> { return null; }
  async salonInfo(): Promise<CustomerSalonInfo | null> { return null; }
  async notifications(): Promise<CustomerNotification[]> { return []; }
  async giftCards(): Promise<CustomerGiftCard[]> { return []; }
  async giftCardForTransfer(): Promise<{ id: string; status: string; balanceCents: number } | null> { return null; }
  async createGiftCardClaim(): Promise<{ senderName: string | null }> { return { senderName: null }; }
  async recordGiftCardDelivery(): Promise<void> {}
  async findGiftCardClaimByHash(): Promise<GiftCardClaimRow | null> { return null; }
  async claimGiftCardTransfer(): Promise<GiftCardClaimResult> { return { ok: false }; }
  async reportGiftCardLost(): Promise<{ ok: boolean; reason?: string }> { return { ok: false, reason: 'not_found' }; }
  async markNotificationsRead(): Promise<void> { /* no-op */ }
  async cancelAppointment(): Promise<boolean> { return false; }
  async listAddresses(): Promise<CustomerAddress[]> { return []; }
  async createAddress(_c: CustomerContext, _id: string, b: CreateAddressRequest): Promise<CustomerAddress> { return { id: 'mem', label: b.label ?? null, line1: b.line1, line2: b.line2 ?? null, city: b.city ?? null, state: b.state ?? null, zip: b.zip ?? null, isDefault: !!b.isDefault }; }
  async deleteAddress(): Promise<boolean> { return false; }
  async setDefaultAddress(): Promise<boolean> { return false; }
  async listDeals(): Promise<CustomerDeal[]> { return []; }
  async getOrCreateReferralCode(_c: CustomerContext, id: string): Promise<string> { return 'REF' + String(id).replace(/-/g, '').slice(0, 10).toUpperCase(); }
  async profile(): Promise<CustomerProfile> { return { fullName: null, firstName: null, lastName: null, email: null, phone: null, birthday: null, smsOptIn: false, emailOptIn: false, marketingOptIn: false, phoneVerified: false, avatarUrl: null }; }
  async checkInAppointment(): Promise<CustomerCheckInResult> { return { ok: false, message: 'Check-in is unavailable.' }; }
  async listRewards(): Promise<RewardsView> { return { points: 0, rewards: [] }; }
  async redeemReward(): Promise<RedeemResult> { return { ok: false, message: 'Rewards are unavailable.' }; }
  async customerBranchId(): Promise<string | null> { return null; }
}
