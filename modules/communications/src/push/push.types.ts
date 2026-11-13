// push.types.ts — framework-agnostic contracts for push delivery. Providers are pluggable and selected from env:
// APNs (HTTP/2, token auth) for iOS device tokens + FCM HTTP v1 (OAuth2 service account) for Android/web, composed
// by platform. With no credentials configured, production selects an honest not-configured provider (every send is
// recorded as failed with 'push_not_configured' — never a fabricated delivery); dev/test default to the mock.
export type PushPlatform = 'ios' | 'android' | 'web';
import type { PushCategory } from '@aipowersalon/api-contracts';
/** `category` (Constitution 6 §60, Phase 13 D) decides which apps receive it and the route a tap opens; every producer
 *  sets one (push-producers.vitest.spec.ts). Title / body are lock-screen text: no customer name, phone or amount (§61). */
export interface PushMessage { title: string; body?: string; data?: Record<string, string>; reference?: string; category?: PushCategory }
export interface PushTarget { token: string; platform: PushPlatform; app?: string | null }
export interface PushSendResult { ok: boolean; providerId?: string; error?: string }
export interface PushProvider { readonly name: string; send(target: PushTarget, msg: PushMessage): Promise<PushSendResult>; }
export interface DispatchSummary { tokens: number; sent: number; failed: number; provider: string; /** extras Customer Notifications 08: devices not sent to because the person is in their quiet hours */ heldForQuietHours?: number;
  /** extras round 11: staff devices not sent to because the person switched this kind of message off (reason staff_pref_off) */ heldForStaffPref?: number }
