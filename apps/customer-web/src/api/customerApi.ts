// customerApi.ts — Customer app client for the real @Controller('customer') routes. Same-origin, session cookie; the
// server derives the customer from the session. Reads are server-truth (no fabrication); they return empty until the
// customer↔user identity decision is made and the customer Kysely adapter is wired (see runbook).
import { api } from './client';
import type { AvailabilityResult, BookingOptions, BookingResult, CustomerActiveService, CustomerAddress, CustomerAppointmentItem, CustomerDeal, CustomerGiftCard, CustomerHome, CustomerLoyaltySummary, CustomerNotificationsResult, CustomerPaymentMethod, CustomerProfile, CustomerQueueState, CustomerReceiptItem, CustomerReferral, CustomerSalonInfo, NearbyDealCard, PhoneVerifyResult, RedeemResult, RewardsView, SalonResult, TopUpResult } from '@aipowersalon/api-contracts/customer';
// API contract types (§15): one definition in @aipowersalon/api-contracts, re-exported here so screens keep their imports.
export type { AvailabilityResult, AvailabilitySlot, BookableService, BookableTechnician, BookingOptions, BookingResult, CustomerActiveService, CustomerAddress, CustomerAppointmentItem, CustomerDeal, CustomerGiftCard, CustomerHome, CustomerLoyaltySummary, CustomerNextAppointment, CustomerNotification, CustomerNotificationsResult, CustomerPaymentMethod, CustomerProfile, CustomerQueueState, CustomerReceiptItem, CustomerReferral, CustomerReward, CustomerSalonInfo, NearbyDealCard, PhoneVerifyResult, RedeemResult, RewardsView, SalonResult, TopUpResult } from '@aipowersalon/api-contracts/customer';

// ---- Find Salons Near Me (build doc §14–§18) — PUBLIC directory routes ----
export interface NearbyResponse { results: SalonResult[]; radiusMiles: number; googleEnabled: boolean; googleMessage: string | null; attribution: string | null }

export interface AccountDeletionResult { requestId: string; status: string; requestType: 'delete' | 'deactivate'; submittedAt: string; willRemove: string[]; willRetain: string[]; contactEmail: string | null; message: string }
export interface UpdateProfileBody { phone?: string; email?: string; marketingOptIn?: boolean; smsOptIn?: boolean; emailOptIn?: boolean; firstName?: string; lastName?: string; birthday?: string }
// Public tech "card" — the shape the backend `publicCard` builder returns (tech-profile.service.ts). Shared by the salon
// technician list and (extended) the nearby/marketplace results so those screens' reads are compiler-checked, not `any`.
export interface NSNextAvailable { date: string; startTime: string }
export interface PublicTechCard {
  technicianId: string; publicSlug: string; displayName: string; title: string | null; avatarUrl: string | null;
  averageRating: number; reviewCount: number; specialties: string[]; yearsExperience: number | null;
  featuredPortfolioPhotos: string[]; isBookable: boolean; badges: string[]; isFeatured: boolean;
  styleTags?: string[]; certifications?: string[]; verificationStatus?: 'unverified' | 'pending' | 'verified';
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
  coverUrl?: string | null; certifications?: string[]; styleTags?: string[]; verificationStatus?: 'unverified' | 'pending' | 'verified';
  bio: string | null; yearsExperience: number | null; wouldBookAgainPct: number | null;
  specialties: string[]; languages: string[]; profileLinks: Record<string, string | null | undefined>;
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
  salonsNearby: (q: { lat?: number; lng?: number; radiusMiles?: number; city?: string; zip?: string; searchText?: string }) => {
    const qs = Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
    return api.get<NearbyResponse>(`/customer/salons/nearby${qs ? '?' + qs : ''}`);
  },
  favoriteSalons: () => api.get<{ salonIds: string[]; salons: SalonResult[] }>('/customer/me/favorite-salons'),
  addFavoriteSalon: (salonId: string) => api.post<{ ok: boolean }>(`/customer/me/favorite-salons/${encodeURIComponent(salonId)}`),
  removeFavoriteSalon: (salonId: string) => api.del<{ ok: boolean }>(`/customer/me/favorite-salons/${encodeURIComponent(salonId)}`),
  // Tech discovery + ratings (tech-profile spec set, P4)
  techsNearby: (q: { lat: number; lng: number; radiusMiles?: number; q?: string; minRating?: number }) => api.get<{ radiusMiles: number; results: NearbyTechCard[] }>('/customer/techs/nearby', q as any),
  techProfile: (slug: string, opts?: { bypassCache?: boolean }) =>
    api.get<PublicTechProfile>(`/customer/techs/${encodeURIComponent(slug)}`, opts?.bypassCache ? { _t: Date.now() } : undefined),
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
  salonDetail: (salonId: string) => api.get<SalonResult>(`/customer/salons/${encodeURIComponent(salonId)}`),
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
  // Nov 5 2026: the server takes the phone from the customer's own record and REJECTS a `phone` key in the body
  // (x-forbidden → 400 "may not be set by the client", even when empty). These used to send it, so every code
  // send/check from the app failed. `phone` stays in the signature for callers; it is never sent.
  sendBookingVerification: (b: { bookingSessionId?: string; phone?: string; channel?: string; captchaToken?: string }) =>
    api.post<{ status: string; bookingSessionId: string; maskedPhone: string; message: string }>('/customer/booking/verification/send',
      { bookingSessionId: b.bookingSessionId, ...(b.captchaToken ? { captchaToken: b.captchaToken } : {}) }),

  checkBookingVerification: (b: { bookingSessionId: string; phone?: string; code: string }) =>
    api.post<{ status: string; message: string }>('/customer/booking/verification/check', { bookingSessionId: b.bookingSessionId, code: b.code }),
  createBooking: (body: { salonId?: string; serviceId: string; serviceIds?: string[]; technicianId: string; date: string; startTime: string; inspirationNote?: string; inspirationPhotoId?: string; dealId?: string; dealIdempotencyKey?: string }) => api.post<BookingResult>('/customer/booking', body),
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
  dealsNearby: (q: { lat?: number; lng?: number; radiusMiles?: number; sort?: string }) => api.get<NearbyDealCard[]>('/customer/deals/nearby', q as any),
  saveDeal: (id: string) => api.post<{ saved: boolean }>(`/customer/deals/${id}/save`, {}),
  unsaveDeal: (id: string) => api.del<{ removed: boolean }>(`/customer/deals/${id}/save`),
  savedDeals: () => api.get<{ id: string }[]>(`/customer/deals/saved`),
  referral: () => api.get<CustomerReferral | null>('/customer/referral'),
  getProfile: () => api.get<CustomerProfile | null>('/customer/profile'),
  uploadAvatar: async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.upload<{ url: string }>('/customer/profile/avatar', fd);   // the app transport: bearer on native, UPLOAD timeout
  },
  paymentMethods: () => api.get<CustomerPaymentMethod[]>('/customer/payment-methods'),
  cardTokenizer: () => api.get<CardTokenizerConfig>('/customer/payment-methods/tokenizer'),
  addPaymentMethod: (b: AddPaymentMethodBody) => api.post<CustomerPaymentMethod>('/customer/payment-methods', b as unknown as Record<string, unknown>),
  deletePaymentMethod: (id: string) => api.del<{ ok: boolean }>(`/customer/payment-methods/${id}`),
  setDefaultPaymentMethod: (id: string) => api.post<{ ok: boolean }>(`/customer/payment-methods/${id}/default`, {}),
  topUp: (amountCents: number, paymentMethodId: string) => api.post<TopUpResult>('/customer/wallet/top-up', { amountCents, paymentMethodId }),
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
  phoneChangeStart: (phone: string) =>
    api.post<{ sessionId: string; state: string; maskedPhone: string; duplicates: any }>('/customer/profile/phone', { phone }),
  phoneChangeSend: (sessionId: string, phone: string) =>
    api.post<{ state: string; message: string }>(`/customer/profile/phone/${encodeURIComponent(sessionId)}/send`, { sessionId, phone }),
  phoneChangeVerify: (sessionId: string, phone: string, code: string) =>
    api.post<{ state: string; activated: boolean; message: string }>(`/customer/profile/phone/${encodeURIComponent(sessionId)}/verify`, { sessionId, phone, code }),
  phoneChangeCancel: (sessionId: string) =>
    api.post(`/customer/profile/phone/${encodeURIComponent(sessionId)}/cancel`, { sessionId }),
  // Nov 5 2026: /customer/verify/phone/* was removed server-side (BUILD_PLAN Phase 4 moved it to the one phone service);
  // these still called it, so "Verify my number" on Edit Profile always 404'd. Same request/response shape.
  requestPhoneCode: () => api.post<PhoneVerifyResult>('/customer/profile/phone/verify-current/request', {}),
  confirmPhoneCode: (code: string) => api.post<PhoneVerifyResult>('/customer/profile/phone/verify-current/confirm', { code }),
  requestAccountDeletion: (reason?: string, contactEmail?: string) => api.post<AccountDeletionResult>('/customer/me/delete-account-request', { ...(reason ? { reason } : {}), ...(contactEmail ? { contactEmail } : {}) }),
  privacyExport: () => api.get<unknown>('/customer/me/privacy-export'),
};
