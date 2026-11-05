// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: customer. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export interface CustomerLoyaltySummary {
  points: number; tier: string; nextTier: string | null; pointsToNextTier: number; progressPercent: number;
}

export interface CustomerActiveService {
  ticketId: string; serviceName: string; status: string; startedAt: string;
  elapsedSeconds: number; progressPercent: number; estimatedFinishTime: string | null;
}

export interface CustomerNextAppointment {
  appointmentId: string; serviceName: string; startTime: string; technicianName?: string; status: string;
}

export interface CustomerHome {
  customerName: string;
  avatarUrl?: string | null;   // developer merge Sep 2026 (migration: user_avatar_url)
  loyalty: CustomerLoyaltySummary;
  nextAppointment?: CustomerNextAppointment;
  activeService?: CustomerActiveService;
  recentVisitsCount: number;
}

export interface PhoneVerifyResult { ok: boolean; verified?: boolean; message?: string }

export interface CustomerReward { id: string; title: string; description: string; pointsCost: number; affordable: boolean;
  /** Decision 15 (Oct 2 2026): what the reward takes off at checkout, and how long its code stays valid. */
  valueLabel?: string; validDays?: number | null }

export interface RewardsView { points: number; rewards: CustomerReward[] }

export interface RedeemResult { ok: boolean; code?: string; pointsBalance?: number; message?: string }

export interface CustomerAppointmentItem { appointmentId: string; serviceName: string; startTime: string; status: string; technicianName?: string; branchName?: string; serviceId?: string; technicianId?: string; durationMinutes?: number }

export interface CustomerReceiptItem { receiptId: string; date: string; totalCents: number; channel?: string }

export interface CustomerQueueState {
  inQueue: boolean;
  queueItemId?: string;
  position?: number;
  totalWaiting?: number;
  estimatedWaitMinMinutes?: number;
  estimatedWaitMaxMinutes?: number;
  status?: string;
  /** BUILD_PLAN Phase 6 round 2: the technician the customer asked for and whether they are busy now; other technicians
   *  who could take them (only when the requested one is busy) — accept one with POST customer/queue/:id/accept-alternate. */
  requestedTechnician?: { technicianId: string; name: string; busy: boolean; availableInMinutes: number | null } | null;
  alternates?: { technicianId: string; name: string; availableInMinutes: number | null }[];
}
/** POST customer/queue/:queueItemId/accept-alternate → (409 when that technician was just taken) */
export interface CustomerAcceptAlternateResponse { ok: true; queueItemId: string; requestedTechnicianId: string; requestedTechnicianName: string; technicianName: string; version: number }

export interface CustomerNotification { id: string; type: string; title: string; body: string | null; reference: string | null; readAt: string | null; createdAt: string }

export interface CustomerNotificationsResult { unreadCount: number; items: CustomerNotification[] }

export interface CustomerAddress { id: string; label: string | null; line1: string; line2: string | null; city: string | null; state: string | null; zip: string | null; isDefault: boolean }

export interface CustomerDeal { id: string; title: string; description: string | null; code: string | null; startsAt: string | null; endsAt: string | null;
  // BUILD_PLAN Phase 5: the salon's deals come from the one deals domain (customer_deals was written by nothing)
  kind?: 'deal' | 'coupon' | 'announcement'; terms?: string | null; discountType?: string | null; discountPercent?: number | null; discountCents?: number | null;
  originalPriceCents?: number | null; finalPriceCents?: number | null; requiresCode?: boolean; bookable?: boolean }

/** Refer a Friend build (Nov 5 2026): `offer` is the salon's LIVE two-sided voucher offer — null when the salon has none set, the
 *  program is off or its budget is used up; the app then makes no money claim. */
export interface CustomerReferralOffer { friendRewardCents: number; referrerRewardCents: number; minSpendCents: number; expiryDays: number }
export interface CustomerReferral { code: string; shareMessage: string; salonName?: string | null; offer?: CustomerReferralOffer | null }

export interface CustomerProfile { fullName: string | null; firstName: string | null; lastName: string | null; email: string | null; phone: string | null; birthday: string | null; smsOptIn: boolean; emailOptIn: boolean; marketingOptIn: boolean; phoneVerified: boolean; avatarUrl: string | null }

export interface CustomerSalonInfo { id: string; name: string; address: string | null; phone: string | null }

// A gift card the customer owns, for the Customer App Gift Cards module. Only the masked reference is exposed — never
// the raw redeemable code (redemption uses a short-lived presentation token, not this list).
export interface CustomerGiftCard { id: string; reference: string; cardNumberMasked: string | null; balanceCents: number; purchasedCents: number; promoCents: number; status: string; createdAt: string; expiresAt: string | null }
