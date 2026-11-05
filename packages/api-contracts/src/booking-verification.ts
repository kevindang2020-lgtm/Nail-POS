// booking-verification.ts — wire shapes of booking phone verification (BUILD_PLAN Phase 4), shared by the API and every
// client (customer app, booking page, POS, Super Admin). Never a full phone number, never a code.

/** GET …/verification/captcha — how to show the human check when a code send is challenged. */
export interface CaptchaClientConfig { provider: 'turnstile' | 'hcaptcha' | 'recaptcha' | null; siteKey: string | null }

/** One booking waiting for its phone code — what a manager may override (GET /pos/booking/verification-override/pending). */
export interface PendingVerificationView {
  id: string; channel: string; maskedPhone: string; status: string; attempts: number;
  createdAt: string; expiresAt: string; slotStartsAt: string | null; technicianId: string | null;
}

/** GET /pos/settings/booking-phone-verification/usage — the salon's verification activity (counts; masked numbers only). */
export interface BookingVerificationUsageView {
  days: number;
  totals: {
    requested: number; codesSent: number; delivered: number; verified: number; overridden: number;
    failed: number; locked: number; expired: number; bookingsCompleted: number;
  };
  /** verified ÷ requested (0–1), null with nothing requested. */
  verifyRate: number | null;
  byChannel: Array<{ channel: string; requested: number; verified: number }>;
  recentFailures: Array<{ at: string; channel: string; status: string; reason: string | null; maskedPhone: string }>;
}

// ── Super Admin → Booking Verification Oversight (counts and switches; never a number, code or credential) ──
export interface BookingVerificationPlatformPolicyView { moduleEnabled: boolean; emergencyDisabled: boolean; reason: string | null; version: number }
export interface BookingVerificationTenantRow {
  tenantId: string; tenantName: string | null;
  /** The salon's own switch. */
  enabled: boolean;
  requiredByPlatform: boolean; blockedByPlatform: boolean;
  /** Phase 4: managers at this salon may not approve a booking without a code. */
  bypassBlocked: boolean;
  providerConnected: boolean; providerValidated: boolean;
  effective: 'active' | 'disabled_by_tenant' | 'blocked_by_platform' | 'provider_not_ready' | 'platform_emergency';
}
export interface BookingVerificationHealthView {
  sinceHours: number;
  requested: number; codesSent: number; verified: number; overridden: number; failed: number; locked: number; expired: number;
  /** Salons with verification ON whose provider is not usable — refusing remote bookings right now. */
  tenantsMisconfigured: number;
}
