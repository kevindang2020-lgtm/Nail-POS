import type { CaptchaClientConfig } from '@aipowersalon/api-contracts';
import type { CustomerPhoneStatus } from '@aipowersalon/api-contracts';
// customerApi.ts — Customer app client for the real @Controller('customer') routes. Same-origin, session cookie; the
// server derives the customer from the session. Reads are server-truth (no fabrication); they return empty until the
// customer↔user identity decision is made and the customer Kysely adapter is wired (see runbook).
import type { AvailabilityResult, AvailabilitySlot, BookableService, BookableTechnician, BookingOptions, BookingResult, BookingDepositView, CustomerActiveService, CustomerAddress, CustomerAppointmentItem, CustomerDeal, CustomerGiftCard, CustomerHome, CustomerLoyaltySummary, CustomerNextAppointment, CustomerNotification, CustomerNotificationsResult, CustomerPaymentMethod, CustomerProfile, CustomerQueueState, CustomerReceiptItem, CustomerReferral, CustomerReward, CustomerSalonInfo, NearbyDealCard, PhoneVerifyResult, RedeemResult, RewardsView, SalonResult, TopUpResult } from '@aipowersalon/api-contracts/customer';
export type { AvailabilityResult, AvailabilitySlot, BookableService, BookableTechnician, BookingOptions, BookingResult, BookingDepositView, CustomerActiveService, CustomerAddress, CustomerAppointmentItem, CustomerDeal, CustomerGiftCard, CustomerHome, CustomerLoyaltySummary, CustomerNextAppointment, CustomerNotification, CustomerNotificationsResult, CustomerPaymentMethod, CustomerProfile, CustomerQueueState, CustomerReceiptItem, CustomerReferral, CustomerReward, CustomerSalonInfo, NearbyDealCard, PhoneVerifyResult, RedeemResult, RewardsView, SalonResult, TopUpResult };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import { api } from './client';

export interface NearbyResponse { results: SalonResult[]; radiusMiles: number; googleEnabled: boolean; googleMessage: string | null; attribution: string | null; /** B-28: the next browse page (no location); null on the last page or a located search */ nextCursor: string | null }

export interface AccountDeletionResult { requestId: string; status: string; requestType: 'delete' | 'deactivate'; submittedAt: string; willRemove: string[]; willRetain: string[]; contactEmail: string | null; message: string }
export interface UpdateProfileBody { phone?: string; email?: string; marketingOptIn?: boolean; smsOptIn?: boolean; emailOptIn?: boolean; firstName?: string; lastName?: string; birthday?: string }
// Public tech "card" — the shape the backend `publicCard` builder returns (tech-profile.service.ts). Shared by the salon
// technician list and (extended) the nearby/marketplace results so those screens' reads are compiler-checked, not `any`.
export interface NSNextAvailable { date: string; startTime: string }
export interface PublicTechCard {
  technicianId: string; publicSlug: string; displayName: string; title: string | null; avatarUrl: string | null;
  averageRating: number; reviewCount: number; specialties: string[]; yearsExperience: number | null;
  featuredPortfolioPhotos: string[]; isBookable: boolean; badges: string[]; isFeatured: boolean;
  styleTags?: string[]; certifications?: { name: string; verified: boolean }[]; verificationStatus?: 'unverified' | 'pending' | 'verified';
  nextAvailable: NSNextAvailable | null;
}
// Nearby/marketplace result = a public card plus the location-relative fields added in `customerNearbyTechs`.
export interface NearbyTechCard extends PublicTechCard {
  salonId: string; salonName: string; city: string | null; state: string | null; distanceMiles: number;
  bookingRoute: string; rankScore?: number;
}
// Detailed public tech profile — the shape `/customer/techs/:slug` returns (tech-profile.service.ts). Sub-shapes are split
// out so the profile screen's portfolio/reviews/availableAt reads are compiler-checked instead of `any`.
export interface TechProfilePhoto { photoId: string; imageUrl: string; thumbnailUrl: string | null; caption: string | null; tags: string[]; serviceCategory: string | null; isFeatured: boolean; nailShape: string | null; nailLength: string | null; designStyle: string | null; complexity: string | null; brand: string | null; colorName: string | null }
export interface TechProfileReview { rating: number; reviewText: string | null; tags: string[]; reviewer: string; serviceName: string | null; createdAt: string; response?: string | null; respondedAt?: string | null }
export interface TechDmThread { threadId: string; status: string; lastMessageAt: string | null; lastMessagePreview: string | null; customerUnread: number; technicianUnread: number; displayName?: string; avatarUrl?: string | null; publicSlug?: string }
export interface TechDmMessage { id: string; sender: 'customer' | 'technician'; body: string; createdAt: string }
export interface TechProfilePost { postId: string; thumbnailUrl: string | null; caption: string; likeCount: number; commentCount: number; createdAt: string }
export interface TechRatingBucket { star: number; pct: number }
export interface TechProfileSalonService { serviceId: string; name: string; durationMinutes: number; priceCents: number; isPrimary: boolean }
export interface TechProfileSalon { salonId: string; technicianId: string | null; salonName: string; address: string; bookingRoute: string; nextAvailableAt: NSNextAvailable | null; services: TechProfileSalonService[] }
export interface TechProfileBeforeAfter { setId: string; beforeImageUrl: string; beforeThumbnailUrl: string | null; afterImageUrl: string; afterThumbnailUrl: string | null; servicePerformed: string | null; designNotes: string | null; productsUsed: string | null; durationMinutes: number | null }
export interface PublicTechProfile {
  publicSlug: string; displayName: string; title: string | null; avatarUrl: string | null;
  coverUrl?: string | null; certifications?: { name: string; verified: boolean }[]; styleTags?: string[]; verificationStatus?: 'unverified' | 'pending' | 'verified';
  bio: string | null; yearsExperience: number | null; wouldBookAgainPct: number | null;
  specialties: string[]; languages: string[]; profileLinks: Record<string, string | null | undefined>;
  careerHistory?: { salonName: string; from: number | null; to: number | null; current: boolean }[];   // §62 — only when she opted in
  averageRating: number; reviewCount: number; ratingBreakdown: TechRatingBucket[];
  isBookable: boolean; badges: string[];
  portfolio: TechProfilePhoto[]; reviews: TechProfileReview[]; posts: TechProfilePost[]; availableAt: TechProfileSalon[]; acceptsMessages?: boolean;
  beforeAfter: TechProfileBeforeAfter[];
}
// Booking-time technician card for a service (serviceTechnicians) — a distinct, leaner shape from PublicTechCard: public-only
// fields (slug/title/rating/reviews) are null for non-public techs, so they're nullable here.
export interface BookingServiceTech {
  technicianId: string; displayName: string; avatarUrl: string | null; title: string | null;
  averageRating: number | null; reviewCount: number | null; publicSlug: string | null;
  isPrimary: boolean; isFeatured: boolean; isBookable: boolean;
}
// Customer's own rating for a tech on a ticket (customerMyTechRating) — drives the 7-day edit-window UI.
export type MyTechRating = { exists: false } | { exists: true; ratingId: string; rating: number; reviewText: string | null; tags: string[]; isPublic: boolean; editable: boolean; editableUntil: string };
export interface CreateAddressBody { label?: string; line1: string; line2?: string; city?: string; state?: string; zip?: string; isDefault?: boolean }
export interface AddPaymentMethodBody { token: string; brand?: string; last4?: string; expMonth?: number; expYear?: number; isDefault?: boolean; cardholderName?: string; zipCode?: string; cardType?: string; consent: boolean; consentVersion: string }
/** The salon's Fiserv hosted card tokenizer (CardSecure iFrame). available:false → card saving is unavailable. */
export interface CardTokenizerConfig { available: boolean; url?: string; origin?: string; reason?: string; consentVersion?: string }
export interface CustomerWalletTxn { id: string; amountCents: number; type: string; reference: string | null; createdAt: string }
export interface CustomerWalletState { balanceCents: number; currency: string; transactions: CustomerWalletTxn[] }

export interface CustomerGiftCardsState { cards: CustomerGiftCard[]; totalBalanceCents: number }

export const customerApi = {
  giftCards: () => api.get<CustomerGiftCardsState>('/customer/gift-cards'),
  sendGiftCard: (id: string, body: { name?: string; phone?: string; email?: string; message?: string }) => api.post<{ claimToken: string; expiresAt: string; claimUrl: string | null; delivery?: { channel: string; status: string } }>(`/customer/gift-cards/${encodeURIComponent(id)}/send`, body),
  claimGiftCard: (token: string) => api.post<{ ok: boolean; reference?: string; balanceCents?: number; senderName?: string; message?: string; reason?: string }>('/customer/gift-cards/claim', { token }),
  reportLostGiftCard: (id: string) => api.post<{ ok: boolean; reason?: string }>(`/customer/gift-cards/${encodeURIComponent(id)}/report-lost`, {}),
  salonsNearby: (q: { lat?: number; lng?: number; radiusMiles?: number; city?: string; zip?: string; searchText?: string; limit?: number; cursor?: string }) => {
    const qs = Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
    return api.get<NearbyResponse>(`/customer/salons/nearby${qs ? '?' + qs : ''}`);
  },
  /** Default salon (Oct 3 2026): read / change. requiresSignIn = a different salon business — sign in again to land there. */
  homeSalon: () => api.get<{ salonId: string; salonName: string; city: string | null } | null>('/customer/me/home-salon'),
  setHomeSalon: (salonId: string) => api.post<{ ok: boolean; salonName?: string; requiresSignIn?: boolean; message?: string }>('/customer/me/home-salon', { salonId }),
  favoriteSalons: () => api.get<{ salonIds: string[]; salons: SalonResult[] }>('/customer/me/favorite-salons'),
  addFavoriteSalon: (salonId: string) => api.post<{ ok: boolean }>(`/customer/me/favorite-salons/${encodeURIComponent(salonId)}`),
  removeFavoriteSalon: (salonId: string) => api.del<{ ok: boolean }>(`/customer/me/favorite-salons/${encodeURIComponent(salonId)}`),
  // Tech discovery + ratings (tech-profile spec set, P4)
  techsNearby: (q: { lat: number; lng: number; radiusMiles?: number; q?: string; minRating?: number }) => api.get<{ radiusMiles: number; results: NearbyTechCard[] }>('/customer/techs/nearby', q as any),
  techProfile: (slug: string) => api.get<PublicTechProfile>(`/customer/techs/${encodeURIComponent(slug)}`),
  techMessageOpen: (slug: string) => api.post<TechDmThread>(`/customer/techs/${encodeURIComponent(slug)}/message`, {}),
  techMessageList: (threadId: string) => api.get<{ status: string; messages: TechDmMessage[] }>(`/customer/messages/${encodeURIComponent(threadId)}`),
  techMessageSend: (threadId: string, body: string) => api.post<{ ok: true }>(`/customer/messages/${encodeURIComponent(threadId)}`, { body }),
  techMessageBlock: (threadId: string) => api.post<{ ok: true }>(`/customer/messages/${encodeURIComponent(threadId)}/block`, {}),
  techMessageReport: (threadId: string, reason?: string) => api.post<{ ok: true }>(`/customer/messages/${encodeURIComponent(threadId)}/report`, { reason }),
  techTrackEvent: (slug: string, type: 'link_click' | 'post_tap', ref?: string) => api.post(`/customer/techs/${encodeURIComponent(slug)}/event`, { type, ref }),
  salonTechnicians: (salonId: string) => api.get<{ salonId: string; technicians: PublicTechCard[] }>(`/customer/salons/${encodeURIComponent(salonId)}/technicians`),
  bookingServiceTechnicians: (serviceId: string, salonId?: string) => api.get<{ serviceId: string; technicians: BookingServiceTech[] }>('/customer/booking/service-technicians', { serviceId, ...(salonId ? { salonId } : {}) }),
  techFavorites: () => api.get<{ slugs: string[]; techs: PublicTechCard[] }>('/customer/tech-favorites'),
  addTechFavorite: (b: { publicSlug?: string; technicianId?: string }) => api.post<{ ok: boolean; publicSlug: string; displayName: string }>('/customer/tech-favorites', b),
  removeTechFavorite: (slug: string) => api.del<{ ok: boolean }>(`/customer/tech-favorites/${encodeURIComponent(slug)}`),
  myTechRating: (ticketId: string, technicianId: string) => api.get<MyTechRating>(`/customer/tickets/${encodeURIComponent(ticketId)}/technician-ratings/mine`, { technicianId }),
  updateTechRating: (ticketId: string, ratingId: string, b: Record<string, unknown>) => api.patch<{ ok: boolean; message: string }>(`/customer/tickets/${encodeURIComponent(ticketId)}/technician-ratings/${encodeURIComponent(ratingId)}`, b),
  pendingTechRatings: () => api.get<{ pending: any[] }>('/customer/tech-ratings/pending'),
  submitTechRating: (ticketId: string, body: { technicianId: string; rating: number; reviewText?: string; tags?: string[]; isPublic?: boolean }) => api.post<{ ok: boolean; message: string }>(`/customer/tickets/${encodeURIComponent(ticketId)}/technician-ratings`, body),
  salonServices: (salonId: string) => api.get<{ serviceId: string; name: string; priceCents: number; durationMinutes: number }[]>(`/customer/salons/${encodeURIComponent(salonId)}/services`),
  home: () => api.get<CustomerHome>('/customer/home'),
  appointments: () => api.get<CustomerAppointmentItem[]>('/customer/appointments'),
  serviceProgress: () => api.get<CustomerActiveService | null>('/customer/service-progress'),
  receipts: () => api.get<CustomerReceiptItem[]>('/customer/receipts'),
  loyalty: () => api.get<CustomerLoyaltySummary>('/customer/loyalty'),
  bookingOptions: (salonId?: string) => api.get<BookingOptions>(`/customer/booking/options${salonId ? `?salonId=${encodeURIComponent(salonId)}` : ''}`),

  // ── booking phone verification ──
  // The booking is REFUSED with a 428 until the phone behind it is proven. These two close that loop.
  // `bookingSessionId` is SERVER-issued (it arrives in the 428 payload) — never generated here: it is what binds
  // the verification to ONE booking attempt, and a client-chosen one could be pointed at somebody else's.
  // Phase 4: the number is the customer's OWN (resolved server-side) — the client never sends one.
  sendBookingVerification: (b: { bookingSessionId?: string; captchaToken?: string }) =>
    api.post<{ status: string; bookingSessionId: string; maskedPhone: string; message: string }>('/customer/booking/verification/send', b),

  bookingCaptcha: () => api.get<CaptchaClientConfig>('/customer/booking/verification/captcha'),
  checkBookingVerification: (b: { bookingSessionId: string; code: string }) =>
    api.post<{ status: string; message: string }>('/customer/booking/verification/check', b),
  /** `bookingSessionId`: the sealed session a 428 issued — retrying with it after the code books (and spends) it. */
  createBooking: (body: { salonId?: string; serviceId: string; serviceIds?: string[]; technicianId: string; date: string; startTime: string; inspirationNote?: string; inspirationPhotoId?: string; dealId?: string; dealIdempotencyKey?: string; bookingSessionId?: string }, o?: { idempotencyKey?: string }) =>
    // BUILD_PLAN Phase 13: one Idempotency-Key per booking attempt (POST /customer/booking is @Idempotent()) — a retry after a lost
    // answer gets the first booking back instead of booking twice
    o?.idempotencyKey ? api.post<BookingResult>('/customer/booking', body, { idempotencyKey: o.idempotencyKey }) : api.post<BookingResult>('/customer/booking', body),
  availability: (serviceId: string, date: string, technicianId?: string, salonId?: string) => api.get<AvailabilityResult>('/customer/booking/availability', { serviceId, date, ...(technicianId ? { technicianId } : {}), ...(salonId ? { salonId } : {}) }),
  queue: () => api.get<CustomerQueueState>('/customer/queue'),
  wallet: () => api.get<CustomerWalletState>('/customer/wallet'),
  salon: () => api.get<CustomerSalonInfo | null>('/customer/salon'),
  notifications: () => api.get<CustomerNotificationsResult>('/customer/notifications'),
  markNotificationsRead: () => api.post<{ ok: true }>('/customer/notifications/read', {}),
  cancelAppointment: (appointmentId: string) => api.post<{ ok: boolean }>(`/customer/appointments/${appointmentId}/cancel`, {}),
  reschedule: (appointmentId: string, date: string, startTime: string) => api.post<{ appointmentId: string; date: string; startTime: string; endTime: string; status: string }>(`/customer/booking/appointments/${appointmentId}/reschedule`, { date, startTime }),
  rewards: () => api.get<RewardsView>('/customer/rewards'),
  redeemReward: (rewardId: string) => api.post<RedeemResult>(`/customer/rewards/${rewardId}/redeem`, {}),
  checkIn: (appointmentId: string) => api.post<{ ok: boolean; queueItemId?: string; alreadyCheckedIn?: boolean; message?: string }>(`/customer/appointments/${appointmentId}/check-in`, {}),
  addresses: () => api.get<CustomerAddress[]>('/customer/addresses'),
  addAddress: (b: CreateAddressBody) => api.post<CustomerAddress>('/customer/addresses', b as unknown as Record<string, unknown>),
  deleteAddress: (id: string) => api.del<{ ok: boolean }>(`/customer/addresses/${id}`),
  setDefaultAddress: (id: string) => api.post<{ ok: boolean }>(`/customer/addresses/${id}/default`, {}),
  deals: () => api.get<CustomerDeal[]>('/customer/deals'),
  dealsNearby: (q: { lat?: number; lng?: number; radiusMiles?: number; sort?: string; ownerType?: string; maxPriceCents?: number; q?: string }) => api.get<NearbyDealCard[]>('/customer/deals/nearby', q as any),
  saveDeal: (id: string) => api.post<{ saved: boolean }>(`/customer/deals/${id}/save`, {}),
  unsaveDeal: (id: string) => api.del<{ removed: boolean }>(`/customer/deals/${id}/save`),
  savedDeals: () => api.get<SavedDeal[]>(`/customer/deals/saved`),
  // BUILD_PLAN Phase 5 — a deal's page (guests too), "what would I pay", and the coupon wallet
  dealDetail: (id: string, signedIn: boolean) => api.get<DealDetail>(signedIn ? `/customer/deals/${encodeURIComponent(id)}` : `/customer/deals/public/${encodeURIComponent(id)}`),
  dealEstimate: (id: string, serviceIds: string[], signedIn: boolean) => api.post<DealEstimate>(signedIn ? `/customer/deals/${encodeURIComponent(id)}/estimate` : `/customer/deals/public/${encodeURIComponent(id)}/estimate`, { serviceIds }),
  couponWallet: () => api.get<WalletCoupon[]>(`/customer/deals/wallet`),
  referral: () => api.get<CustomerReferral | null>('/customer/referral'),
  getProfile: () => api.get<CustomerProfile | null>('/customer/profile'),
  // BUILD_PLAN Phase 13: through the one transport (bearer on native, UPLOAD timeout, client headers) — no hand-rolled fetch
  uploadAvatar: async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.upload<{ url: string }>('/customer/profile/avatar', fd);
  },
  paymentMethods: () => api.get<CustomerPaymentMethod[]>('/customer/payment-methods'),
  /** The salon's hosted card tokenizer (CardSecure iFrame) — the add-card form lives there, not in this app. */
  /** D11: the deposit the salon asked for at booking — its status, and paying it with the hosted tokenizer's token */
  bookingDeposit: (appointmentId: string) => api.get<BookingDepositView>(`/customer/booking/appointments/${encodeURIComponent(appointmentId)}/deposit`),
  payBookingDeposit: (appointmentId: string, body: { cardToken: string; expiry?: string; cardholderName?: string }) => api.post<BookingDepositView>(`/customer/booking/appointments/${encodeURIComponent(appointmentId)}/deposit`, body),
  paymentTokenizer: () => api.get<CardTokenizerConfig>('/customer/payment-methods/tokenizer'),
  addPaymentMethod: (b: AddPaymentMethodBody) => api.post<CustomerPaymentMethod>('/customer/payment-methods', b as unknown as Record<string, unknown>),
  deletePaymentMethod: (id: string) => api.del<{ ok: boolean }>(`/customer/payment-methods/${id}`),
  setDefaultPaymentMethod: (id: string) => api.post<{ ok: boolean }>(`/customer/payment-methods/${id}/default`, {}),
  topUp: (amountCents: number, paymentMethodId: string, clientKey?: string) => api.post<TopUpResult>('/customer/wallet/top-up', { amountCents, paymentMethodId, ...(clientKey ? { clientKey } : {}) }),
  /** B-79: "Check status" of a top-up the processor did not confirm — asks the processor, never charges. */
  verifyTopUp: (intentId: string) => api.post<TopUpResult>(`/customer/wallet/top-ups/${encodeURIComponent(intentId)}/verify`, {}),
  updateProfile: (body: UpdateProfileBody) => api.patch<{ ok: true }>('/customer/profile', body as Record<string, unknown>),

  // ── changing your phone number is a FLOW, not a field ──
  //
  // `PATCH /customer/profile` used to write the number straight through: no E.164 (its "normalization" stripped the
  // leading "+", so Twilio could not even send to it), no verification, no duplicate check. A signed-in customer
  // could point their booking codes and appointment reminders at ANY number — including somebody else's, who would
  // then start receiving that salon's messages.
  //
  // VERIFY FIRST, then activate: the old number stays live until the new one answers. You are alone with your
  // phone — mistype a digit and swap immediately, and you have cut yourself off from your account AND from the code
  // that would let you fix it.
  /** Phase 3: a password check first (salon setting, on by default) — a stolen session does not carry the password. */
  phoneChangeStart: (phone: string, currentPassword?: string) =>
    api.post<{ sessionId: string; state: string; maskedPhone: string; duplicates: any }>('/customer/profile/phone', { phone, ...(currentPassword ? { currentPassword } : {}), idempotencyKey: `app-${phone}-${Date.now()}` }),
  /** My number (masked), whether it is verified, and any change in flight. */
  phoneStatus: () => api.get<CustomerPhoneStatus>('/customer/profile/phone/status'),
  /** Use the number I just verified to SIGN IN as well (password again; the old number is warned; every session ends). */
  changeLoginNumber: (phone: string, currentPassword: string) =>
    api.post<{ ok: true; maskedNew: string }>('/customer/profile/phone/login-number', { phone, currentPassword }),
  phoneChangeSend: (sessionId: string, phone: string) =>
    api.post<{ state: string; message: string }>(`/customer/profile/phone/${encodeURIComponent(sessionId)}/send`, { sessionId, phone }),
  phoneChangeVerify: (sessionId: string, phone: string, code: string) =>
    api.post<{ state: string; activated: boolean; message: string }>(`/customer/profile/phone/${encodeURIComponent(sessionId)}/verify`, { sessionId, phone, code }),
  phoneChangeCancel: (sessionId: string) =>
    api.post(`/customer/profile/phone/${encodeURIComponent(sessionId)}/cancel`, { sessionId }),
  // Phase 4: the canonical route (the duplicate /customer/verify/phone family was removed).
  requestPhoneCode: () => api.post<PhoneVerifyResult>('/customer/profile/phone/verify-current/request', {}),
  confirmPhoneCode: (code: string) => api.post<PhoneVerifyResult>('/customer/profile/phone/verify-current/confirm', { code }),
  requestAccountDeletion: (reason?: string, contactEmail?: string) => api.post<AccountDeletionResult>('/customer/me/delete-account-request', { ...(reason ? { reason } : {}), ...(contactEmail ? { contactEmail } : {}) }),
  privacyExport: () => api.exportAsync<unknown>('/customer/me/privacy-export'),
};

// BUILD_PLAN Phase 5 — deal page, estimate, wallet (the server's shapes)
export interface SavedDeal { id: string; title: string; imageUrl: string | null; ownerType: string; technicianName: string | null; salonName: string | null; discountType: string; discountPercent: number | null; discountCents: number | null; originalPriceCents: number | null; finalPriceCents: number | null; savingsCents: number | null; status: string }
export interface DealDetail {
  id: string; tenantId: string; branchId: string | null; kind: string; title: string; shortDescription: string | null; terms: string | null; imageUrl: string | null; ownerType: string; technicianName: string | null;
  salonName: string | null; branchName: string | null; address: string | null; discountType: string; discountPercent: number | null; discountCents: number | null; originalPriceCents: number | null; finalPriceCents: number | null; savingsCents: number | null;
  startsAt: string | null; endsAt: string | null; newCustomersOnly: boolean; memberOnly: boolean; maxPerCustomer: number | null; minSpendCents: number | null; daysOfWeek: number[] | null; validFromMinute: number | null; validToMinute: number | null;
  bookingLeadMinutes: number | null; serviceIds: string[]; status: string; saved: boolean;
}
export interface DealEstimate { eligible: boolean; reasons: { code: string; message: string }[]; subtotalCents: number; discountCents: number; totalCents: number; lines: { serviceId: string; priceCents: number; discountCents: number }[] }
export interface WalletCoupon { id: string; dealId: string; title: string; description: string | null; terms: string | null; codeHint: string; status: string; usable: boolean; expiresAt: string | null; qr: string; discountType: string; discountPercent: number | null; discountCents: number | null }
