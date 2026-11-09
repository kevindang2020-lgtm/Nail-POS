// aiCommStatus.ts — AI & Communication Integrations (Nov 9 2026 guide §10): three SEPARATE status axes per assistant.
//   entitlement  — from GET /tenant/ai/packages (the AI access gate's own decision: subscription status + lockReason)
//   provider     — from GET /tenant/messaging/readiness (the salon's own Twilio account, checked server-side)
//   readiness    — the dependencies each assistant needs (voice-capable number, outbound SMS), and never "ready"
//                  without entitlement: a working provider credential does NOT turn a cancelled package on.
// Pure functions only — nothing here activates, buys, cancels or probes anything.
import type { PosAiPackage } from '../api/posAiApi';
import type { MessagingReadiness } from '@aipowersalon/api-contracts/tenant';

export type Entitlement = 'active' | 'trial' | 'trial_expired' | 'cancelled' | 'paused' | 'past_due' | 'unpaid' | 'expired'
  | 'not_subscribed' | 'unavailable' | 'no_permission' | 'limit' | 'branch_off' | 'account_inactive' | 'unknown';
export type AiProviderState = 'connected' | 'unauthorized' | 'stale' | 'untested' | 'not_configured' | 'not_required' | 'unknown';
export type Readiness = 'ready' | 'missing_config' | 'blocked' | 'degraded' | 'not_permitted' | 'unknown';

export const AI_COMM_CODES = ['ai_booking_assistant', 'ai_phone_call_assistant', 'ai_reception_copilot', 'ai_review_reputation_assistant', 'ai_voice_transcription'] as const;

const LOCK: Record<string, Entitlement> = {
  trial_expired: 'trial_expired', cancelled: 'cancelled', subscription_suspended: 'paused', past_due: 'past_due', unpaid: 'unpaid',
  expired: 'expired', not_subscribed: 'not_subscribed', package_disabled: 'unavailable', permission_denied: 'no_permission',
  limit_exceeded: 'limit', branch_disabled: 'branch_off', tenant_not_active: 'account_inactive',
};

/** Commercial entitlement. A "trialing" row whose trial has ended is refused by the gate (lockReason trial_expired) — it is NOT shown as Trial. */
export function entitlementOf(p: PosAiPackage): Entitlement {
  if (p.accessible) return p.subscription?.status === 'trialing' ? 'trial' : 'active';
  if (p.lockReason && LOCK[p.lockReason]) return LOCK[p.lockReason];
  return 'unknown';
}
export const isEntitled = (e: Entitlement) => e === 'active' || e === 'trial';

/** Reception Copilot runs inside the POS only (no phone/SMS provider); the other four ride the salon's own Twilio account. */
const NEEDS_PROVIDER = new Set<string>(['ai_booking_assistant', 'ai_phone_call_assistant', 'ai_review_reputation_assistant', 'ai_voice_transcription']);

export function providerOf(code: string, rd: MessagingReadiness | null): AiProviderState {
  if (!NEEDS_PROVIDER.has(code)) return 'not_required';
  if (!rd) return 'unknown';
  switch (rd.account.state) {
    case 'connected': return 'connected';
    case 'invalid': return 'unauthorized';
    case 'stale': return 'stale';
    case 'not_configured': return 'not_configured';
    default: return 'untested';
  }
}

export function readinessOf(code: string, ent: Entitlement, rd: MessagingReadiness | null): Readiness {
  if (!isEntitled(ent)) return ent === 'unknown' ? 'unknown' : 'not_permitted';
  if (!NEEDS_PROVIDER.has(code)) return 'ready';
  if (!rd) return 'unknown';
  if (rd.account.state !== 'connected') return rd.account.state === 'invalid' ? 'blocked' : 'missing_config';
  if (code === 'ai_phone_call_assistant' || code === 'ai_voice_transcription') {
    // voice: the registered number must be voice-capable; one working SMS endpoint is not proof voice works
    const v = rd.voice?.numberVoiceCapable;
    return v === true ? 'ready' : v === false ? 'missing_config' : 'unknown';
  }
  const o = rd.outbound?.state;   // booking confirmations + review requests go out by SMS
  return o === 'ready_to_attempt' ? 'ready' : o === 'degraded' ? 'degraded' : o === 'blocked' ? 'blocked' : 'unknown';
}

export const ENT_TONE: Record<Entitlement, string> = {
  active: 'ok', trial: 'warn', trial_expired: 'bad', cancelled: 'bad', paused: 'warn', past_due: 'bad', unpaid: 'bad', expired: 'bad',
  not_subscribed: '', unavailable: '', no_permission: 'warn', limit: 'warn', branch_off: '', account_inactive: 'bad', unknown: '',
};
export const PROV_TONE: Record<AiProviderState, string> = { connected: 'ok', unauthorized: 'bad', stale: 'warn', untested: 'warn', not_configured: '', not_required: '', unknown: '' };
export const READY_TONE: Record<Readiness, string> = { ready: 'ok', missing_config: 'warn', blocked: 'bad', degraded: 'warn', not_permitted: '', unknown: '' };

export interface AiCommRow { p: PosAiPackage; ent: Entitlement; prov: AiProviderState; ready: Readiness }
export function aiCommRows(pkgs: PosAiPackage[] | null, rd: MessagingReadiness | null): AiCommRow[] {
  const by = new Map((pkgs ?? []).map((p) => [p.code, p]));
  return AI_COMM_CODES.flatMap((c) => { const p = by.get(c); if (!p) return []; const ent = entitlementOf(p); return [{ p, ent, prov: providerOf(c, rd), ready: readinessOf(c, ent, rd) }]; });
}
/** header metrics — null when the source has not answered (the screen shows "—", never a guessed 0) */
export function aiCommMetrics(rows: AiCommRow[], pkgsLoaded: boolean, rd: MessagingReadiness | null) {
  return {
    configured: pkgsLoaded ? rows.length : null,
    entitled: pkgsLoaded ? rows.filter((r) => isEntitled(r.ent)).length : null,
    verified: pkgsLoaded && rd ? rows.filter((r) => r.prov === 'connected').length : null,
    attention: pkgsLoaded && rd ? rows.filter((r) => isEntitled(r.ent) && r.ready !== 'ready').length : null,
    lastCheck: rd ? (rd.account.lastCheckedAt ?? null) : null,
  };
}
