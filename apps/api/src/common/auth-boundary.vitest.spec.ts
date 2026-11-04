// auth-boundary.vitest.spec.ts — static guard over the FAIL-CLOSED authentication boundary.
//
// Architecture (audited): TenantContextMiddleware is applied to every route ('*') and throws 401 when there is no valid
// session, and it strips client-supplied tenant/branch keys from body+query (so a client can never assert its own
// tenant). RolePermissionGuard is registered as a global APP_GUARD and enforces @RequirePermission where declared.
// Authentication therefore fails closed for everything EXCEPT the middleware's `.exclude(...)` list — the public surface
// (pre-auth flows, public booking discovery, device/cron-token endpoints, webhooks, health). That exclusion list is the
// single most security-critical configuration in the app: excluding a tenant-operational route from auth is an instant
// bypass. This test pins that boundary so CI blocks any regression.
//
// It does NOT replace runtime/penetration testing; it guards the static configuration that the runtime relies on.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(__dirname, '..', 'app.module.ts'), 'utf8');

// Parse the `.exclude( ... )` block (up to the following `.forRoutes(`) into normalized "METHOD path" entries.
function excludedRoutes(src: string): string[] {
  const block = (src.match(/\.exclude\(([\s\S]*?)\)\s*\.forRoutes\(/) || [])[1] || '';
  const out: string[] = [];
  const re = /path:\s*'([^']+)'\s*,\s*method:\s*RequestMethod\.([A-Z]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) out.push(`${m[2]} ${m[1]}`);
  return out;
}

// Prefixes that must ALWAYS stay behind the session middleware + guards. If any of these is ever added to the auth
// exclusion list, it is an authentication bypass on tenant-operational data.
const PROTECTED_PREFIXES = ['pos/', 'owner/', 'super-admin/', 'tenant/'];

// Documented public baseline. Every entry is intentionally unauthenticated by the session middleware and protected by
// another mechanism (signed cookie/Bearer is N/A pre-auth; device/session tokens; JOBS_SECRET header; webhook signature;
// public-by-design read). Adding/removing an entry should be a deliberate, reviewed change — which flips this test red.
const EXPECTED_PUBLIC = [
  'GET media/(.*)',                                              // public media (images) served by signed/opaque path
  'GET customer/salons/nearby',                                  // public booking discovery
  'GET customer/salons/:salonId',
  'GET customer/salons/:salonId/services',
  'GET customer/salons/:salonId/technicians',
  'GET customer/salons/:salonId/services/:serviceId/technicians',
  'GET customer/techs/nearby',
  'GET customer/techs/:publicSlug',
  // BUILD_PLAN Phase 5, bug 20: the deals marketplace for guests — active, in-window, unsuspended deals only (public
  // marketplace data); the estimate prices catalog services. Saving / the saved list / wallet stay behind the session.
  'GET customer/deals/nearby',
  'GET customer/deals/public/:id',
  'POST customer/deals/public/:id/estimate',
  'POST customer/auth/register',                                 // customer self-registration (pre-auth)

  // First-time Customer App activation. Pre-auth by necessity — the customer has no session until they prove they
  // hold the phone. Reviewed: the request endpoint is ENUMERATION-SAFE (identical response and an SMS sent whether
  // or not the number is known), the OTP is hashed/one-use/expiring/attempt-capped, and it is rate-limited per
  // phone (cooldown), per IP (10/hr) and per device (5/hr). No customer data is resolved or returned until the
  // code verifies; select-salon requires a single-use ticket issued only by a successful verification.
  'POST customer/auth/activation/request-code',
  'POST customer/auth/activation/resend-code',
  'POST customer/auth/activation/verify-code',
  'POST customer/auth/activation/select-salon',

  // Biometric SIGN-IN is pre-auth by definition (you have no session yet). Reviewed: the server verifies the
  // WebAuthn signature with a real (fail-closed) verifier before minting a session — the browser's ceremony proves
  // nothing on its own. NOTE the ENROLLMENT routes (auth/webauthn/register/*) are deliberately NOT here: enrolling
  // a biometric requires an authenticated session, and the user id comes from that session, never the request body.
  // Face ID feature flag. Public by necessity — the app must know before sign-in whether to show the button.
  // Reviewed: returns a single boolean and nothing else.
  'GET auth/webauthn/status',
  'POST auth/webauthn/authenticate/begin',
  'POST auth/webauthn/authenticate/finish',
  'POST public/website/leads',                                   // public marketing forms
  'POST public/website/applications',
  'POST public/website/invitations/accept',                      // invitee redeems a single-use invitation token (no session)
  'POST oauth/token',                                             // Constitution 3 Step 10d: the app authenticates with its code + PKCE verifier (+ client secret) or its rotating refresh token
  'POST oauth/revoke',                                            // RFC 7009: the token itself is the credential; always 200
  'POST public/security/not-me',                                  // Constitution 3 Step 10a: single-use token from the new-device alert; blocks the device + ends every session
  'POST public/security/approve-device',                          // S-A13: single-use token emailed to a platform account holder; approves one device for Super Admin sign-in (no session is created)
  'POST public/mfa-recovery/start',                               // Constitution 7 §24: single-use recovery token + the account's own password
  'POST public/mfa-recovery/confirm',                             // …then a live code from the new authenticator
  'POST auth/login',                                             // auth flows (pre-session by necessity)
  'POST auth/logout',
  'POST auth/refresh',                                           // Constitution 3 Step 2: arrives with an expired access token + the refresh cookie; verifies both itself
  'POST auth/password-reset/request',
  'POST auth/password-reset/temp-login',
  'POST auth/password-reset/complete',
  'POST auth/super-admin/forgot-password',
  'POST auth/temp-password-login',
  'POST auth/change-temporary-password',
  'POST webhooks/payments/:processor',                           // processor webhook — signature-verified, not a session
  'POST webhooks/bank/:token',                                   // bank deposit webhook — HMAC + replay verified, tenant from token, not a session
  'POST internal/hardware-payment/run-monthly',                  // cron — JOBS_SECRET header, not a session
  'POST internal/scheduled-reports/run-due',                     // cron — x-cron-secret header (SCHEDULED_REPORTS_CRON_SECRET), not a session
  // Constitution 12 Phase 5 — self-authenticating routes that were missing from the exclusion list, so the session
  // middleware answered their real callers 401 before any handler ran. Each carries its own authentication:
  'GET health/live',                                             // no data; liveness
  'GET health/ready',                                            // no data; Railway's deploy healthcheck
  'GET metrics',                                                 // Prometheus exposition; METRICS_TOKEN bearer inside the handler (404 in production without a token) — Phase 11
  'POST client-telemetry/errors',                                // capped, scrubbed, rate-limited crash intake
  'POST client-telemetry/events',                                // BUILD_PLAN Phase 13: allow-listed analytics / perf intake, rate-limited, stores nothing
  'GET app-config',                                              // BUILD_PLAN Phase 13 B: mobile app version / flags / maintenance config (platform-wide, rate-limited, read before sign-in)
  'GET .well-known/apple-app-site-association',                  // Phase 13 D: universal-links file iOS fetches anonymously (from env; 404 when unset)
  'GET .well-known/assetlinks.json',                             // Phase 13 D: Android App Links file, fetched anonymously by Android (from env)
  'GET app-links/(.*)',                                          // Phase 13 D: web fallback page for a link opened without the app installed (no data)
  'GET auth/biometric/status',                                   // Phase 13 D: is Face ID switched on at all — the feature flag only, nothing per user
  'POST auth/biometric/login',                                   // Phase 13 D: the Face ID sign-in itself (device id + single-use secret; re-checks the account like a refresh)
  'POST internal/backups/report',                                // x-backup-report-token, constant-time, fails closed
  'POST webhooks/twilio/sms/inbound',                            // Twilio signature (per-tenant token) — STOP opt-outs
  'POST webhooks/twilio/sms/status',                             // Twilio signature
  'POST webhooks/email/sendgrid',                                // SendGrid signed event webhook (ECDSA over timestamp + raw body)
  'POST webhooks/voice/retell',                                  // Retell call events (X-Retell-Signature over raw body + timestamp; 503 when no key)
  'GET public/email/unsubscribe',                                // unsubscribe page — HMAC token, no data shown
  'POST public/email/unsubscribe',                               // one-click unsubscribe — HMAC token, marketing-only opt-out
  'POST webhooks/twilio/booking-verification/status',            // Twilio signature, tenant's own token
  'POST integrations/inbound/:connectionId',                     // provider signature, verified in ingest
  'POST internal/ai-billing/(.*)',                               // x-ai-billing-secret (fails closed) / HMAC on /webhook
  'POST internal/membership-billing/(.*)',                       // x-membership-billing-secret (fails closed)
  'POST internal/tenant-warnings/dispatch',                      // x-cron-secret (fails closed)
  'POST customer-display/checkout/:sessionId/rating',            // display-session token, as tip/method/pay
  'POST customer-display/device/rating',                         // paired-device token
  'POST customer-display/device/phone-code',                     // paired-device token — the phone-change code for ITS current customer only (Phase 3)
  'POST customer-display/device/release',                        // paired-device token — ends ITS OWN completed checkout only (23-inch spec §43–§46; refused unless paid and the receipt question answered)
  'GET customer-display/device/ads',                             // paired-device token — ITS OWN salon's playlist for ITS branch (23-inch spec §47–§74)
  'POST customer-display/device/ads/displays',                   // paired-device token — display counts for ITS OWN salon's ads only (§108)
  'POST customer-display/device/heartbeat',                      // paired-device token — ITS OWN mode/version/screen, validated field by field (§85–§86)
  'POST customer-display/device/receipt',                        // paired-device token — the customer's receipt choice for ITS attached, paid checkout (§97)
  'POST customer-display/device/check-in/session',               // paired-device token — a guest's check-in session on ITS salon + branch (rate-limited per display + instance; §8, §12, §18)
  'POST customer-display/checkout/:sessionId/receipt',           // display-session token — the same, as its siblings tip/method/pay
  'POST customer-display/pairing',                               // NO credential by design: an unpaired display asks for a code (rate-limited per network + instance, capped; §8)
  'POST customer-display/pairing/:pairingId/poll',               // the display's own poll secret (hash compared in constant time); the credential is handed over once (§8–§12)
  'POST api/ai-booking/v1/public/(.*)',                          // signed booking token / verified phone mapping
  'GET api/ai-booking/v1/public/(.*)',                           // Phase 4: captcha widget config (public site key only)
  'ALL api/ai-receptionist/v1/(.*)',                            // Phase 4: VoiceAuthGuard (vk_ key) / sealed keypad callback token
  'POST voice/tool',                                            // Phase 5: the voice agent's tool webhook — VoiceAuthGuard (vk_ key) + Retell signature
  'POST voice/calls/:callId/outcome',                           // Phase 5: the call-outcome callback — VoiceAuthGuard
  'GET health',                                                  // health check
  'GET customer-display/checkout/:sessionId',                    // customer-display device — session/device token auth
  'POST customer-display/checkout/:sessionId/tip',
  'POST customer-display/checkout/:sessionId/method',
  'POST customer-display/checkout/:sessionId/pay',
  'GET customer-display/checkout/:sessionId/stream',
  'GET customer-display/device/current',
  'POST customer-display/device/tip',
  'POST customer-display/device/method',
  'POST customer-display/device/pay',
  'GET customer-display/device/stream',
  'ALL go-check-in/(.*)',                                        // kiosk — device token auth
  'POST jobs/appointment-reminders',                             // external scheduler — JOBS_SECRET header
  'GET public/alert-ack',                                        // Phase 14 C on-call email link — HMAC-signed single-use token; GET only shows, changes nothing
  'POST public/alert-ack',                                       // Phase 14 C — consumes that signed single-use token (acknowledges one platform alert)
  'GET platform/branding',                                       // public branding read (fetched before login)
].sort();

describe('Auth boundary (fail-closed authentication)', () => {
  it('keeps the fail-closed architecture wired (global guard + session middleware on every route)', () => {
    expect(SRC).toContain('provide: APP_GUARD');
    expect(SRC).toMatch(/APP_GUARD,\s*useClass:\s*RolePermissionGuard/);
    expect(SRC).toContain('.apply(TenantContextMiddleware)');
    expect(SRC).toMatch(/\.forRoutes\('\*'\)/);
  });

  const excluded = excludedRoutes(SRC);

  it('parses a non-empty exclusion list', () => {
    expect(excluded.length).toBeGreaterThan(10);
  });

  it('never exempts a tenant-operational prefix from authentication', () => {
    const violations = excluded.filter((e) => {
      const path = e.split(' ')[1] || '';
      return PROTECTED_PREFIXES.some((p) => path.startsWith(p));
    });
    expect(violations).toEqual([]);
  });

  it('matches the documented public baseline (new public routes must be reviewed here)', () => {
    expect([...excluded].sort()).toEqual(EXPECTED_PUBLIC);
  });
});
