// messaging-readiness-model.ts — the salon's Phone & Messaging readiness, as INDEPENDENT status models (owner guide
// §7/§12: "never equate credentials connected, number owned, registration approved, and actual delivery").
//
// Pure: the service reads the rows, this decides. Nothing here receives a secret value — only SIDs, last-4 hints,
// presence flags, timestamps and the stored results of authenticated provider checks.
//
// No false green:
//   • a stored token is NOT "Connected" — only an authenticated provider check of the CURRENT configuration is
//     (the check row carries a fingerprint of what it checked; any change since → Unknown);
//   • a check older than CHECK_STALE_AFTER_MS (24 h) is "Stale", never green;
//   • a 10DLC sender is ready only when brand AND campaign are approved AND the Messaging Service has the number;
//     a toll-free sender or a Verify-only salon is "Not applicable" for A2P 10DLC (not "approved");
//   • inbound is "Verified" only from a signature-verified inbound event, never from an outbound test;
//   • a test SMS is "Delivered" only after the signed status callback said so.
import { createHash } from 'node:crypto';
import { senderTypeOf, type Capabilities } from './twilio-account-probe';
import { itemView, tollfreeView, normalizeBrand, normalizeCampaign, type RegSnapshot, type ItemKind, type RegItemView, type TollfreeView } from './registration-model';
import type { ConfigDiagnostics } from './messaging-config-diagnostics';
import type { NumberInbound } from './messaging-health';

/** a provider check older than this is Stale (never green). Documented in docs/handoff/PHONE_MESSAGING_2026-10-30.md */
export const CHECK_STALE_AFTER_MS = 24 * 3600 * 1000;
/** A2P state recorded by the Super Admin registration flow; a non-final state older than this is flagged stale */
export const A2P_STALE_AFTER_MS = 7 * 24 * 3600 * 1000;
/** a verified webhook event older than this no longer proves the route */
export const WEBHOOK_FRESH_MS = 30 * 24 * 3600 * 1000;

const SETUP = '/tenant/communications/messaging-setup';
export const FIX = {
  credentials: `${SETUP}#credentials`, number: `${SETUP}#number`, verify: `${SETUP}#verify`, registration: `${SETUP}#registration`,
  webhooks: `${SETUP}#webhooks`, search: `${SETUP}#search`, test: `${SETUP}#test`, bookingVerify: '/tenant/communications/phone-verification',
  aiReceptionist: '/tenant/communications/ai-receptionist',
} as const;

export interface CredRow {
  accountMode: 'tenant_owned' | 'platform_managed'; accountSid: string | null; authTokenLast4: string | null; fromNumber: string | null;
  verifyServiceSid: string | null; apiKeySid: string | null; hasApiKeySecret: boolean; messagingServiceSid: string | null;
  lastValidatedAt: Date | null; lastValidationError: boolean; updatedAt: Date | null; updatedByUserId: string | null; fingerprint: string;
}
export interface CheckRow {
  id: string; checkedAt: Date; fingerprint: string | null; accountState: string; accountReasonCode: string | null; accountType: string | null;
  authMode: string | null; apiKeyState: string | null; senderNumber: string | null; senderState: string | null; senderCapabilities: Capabilities | null;
  inboundUrlState: string | null; verifyState: string | null; verifyReasonCode: string | null; triggerKind: string;
  numbersInbound?: NumberInbound[] | null;
}
export interface A2pRow { brandStatus: string | null; brandSid: boolean; campaignStatus: string | null; campaignSid: boolean; messagingServiceSid: string | null; numberAttached: boolean; status: string | null; updatedAt: Date | null; hasError: boolean }
export interface TestRow { id: string; status: string; destinationMasked: string; sender: string | null; providerSidLast6: string | null; errorCode: string | null; warningCodes: string[]; createdAt: Date; statusUpdatedAt: Date; deliveredAt: Date | null;
  branchId?: string | null; configSource?: string | null; accountSidLast4?: string | null }
export interface VerifyPolicy { tenantEnabled: boolean; requiredByPlatform: boolean; blockedByPlatform: boolean; emergencyDisabled: boolean; moduleDisabled: boolean; source: 'branch_override' | 'tenant_default' | 'default' }

export interface ReadinessInput {
  now: Date;
  source: 'tenant_default' | 'branch_override' | 'none';
  cred: CredRow | null;
  sharedPlatformAccount: boolean;
  lastCheck: CheckRow | null;
  registryNumber: string | null;
  a2p: A2pRow | null;
  webhooks: { inbound: Date | null; status: Date | null };
  expectedInboundUrl: string | null;
  statusCallbackUrl: string | null;
  verify: VerifyPolicy;
  lastTest: TestRow | null;
  /** PM-03 / PM-04: the latest provider snapshot per registration item (tenant_messaging_registration_snapshots) */
  registration?: { items: Partial<Record<ItemKind, RegSnapshot>>; lastRun: { at: string; outcome: string; trigger: string } | null } | null;
  /** OPS-01: PUBLIC_API_BASE_URL / TWILIO_STATUS_CALLBACK_URL shape validation */
  config?: ConfigDiagnostics | null;
}

export type AccountState = 'connected' | 'invalid' | 'unknown' | 'stale' | 'not_configured';
export type SenderState = 'assigned' | 'not_owned' | 'missing' | 'unknown';
export type RegState = 'not_started' | 'pending' | 'approved' | 'rejected' | 'suspended' | 'not_applicable' | 'unable_to_verify';
export interface Status<S extends string> { state: S; lastCheckedAt: string | null; reasonCode: string | null; fixLink: string }

export interface MessagingReadiness {
  generatedAt: string;
  staleAfterSeconds: number;
  source: ReadinessInput['source'];
  account: Status<AccountState> & { mode: 'tenant_owned' | 'platform_managed' | 'shared_platform' | 'none'; accountSidLast4: string | null; accountSidMasked: string | null; authTokenLast4: string | null; authMode: 'auth_token' | 'api_key' | null; apiKey: { sid: string | null; sidLast4: string | null; hasSecret: boolean; state: string | null; scope: 'sufficient' | 'insufficient' | 'unknown' | null }; accountType: string | null };
  sender: Status<SenderState> & { number: string | null; senderType: ReturnType<typeof senderTypeOf>; capabilities: Capabilities | null; smsCapable: boolean | null };
  a2p: Status<RegState> & { applicable: boolean; brand: RegItemOut; campaign: RegItemOut; messagingService: RegItemOut & { sidLast4: string | null; numberAttached: boolean }; numberAssociation: RegItemOut; lastUpdatedAt: string | null; stale: boolean;
    providerVerified: boolean; lastProviderCheckAt: string | null; lastProviderSuccessAt: string | null; lastRun: { at: string; outcome: string; trigger: string } | null };
  tollFree: TollfreeView;
  config: ConfigDiagnostics | null;
  outbound: Status<'ready_to_attempt' | 'blocked' | 'degraded'> & { blockers: string[]; warnings: string[]; deliveryTracking: boolean };
  inbound: Status<'configured' | 'verified' | 'failed' | 'untested'> & { webhookUrl: string | null; lastVerifiedEventAt: string | null; numbers: NumberInbound[]; statusCallback: Status<'configured' | 'verified' | 'untested'> & { url: string | null; lastVerifiedEventAt: string | null } };
  verify: Status<'ready' | 'disabled' | 'misconfigured'> & { tenantEnabled: boolean; requiredByPlatform: boolean; platformBlocked: boolean; channel: 'verify_service' | 'sms_code' | null; serviceSidLast4: string | null; settingsSource: VerifyPolicy['source'] };
  voice: { numberVoiceCapable: boolean | null; fixLink: string };
  lastTest: (Omit<TestRow, 'createdAt' | 'statusUpdatedAt' | 'deliveredAt'> & { createdAt: string; statusUpdatedAt: string; deliveredAt: string | null; final: boolean; displayState: TestDisplayState }) | null;
  checklist: { key: 'connect' | 'number' | 'registration' | 'webhooks' | 'test'; state: 'done' | 'action' | 'pending' | 'blocked' | 'not_applicable'; reasonCode: string | null; fixLink: string }[];
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const last4 = (s: string | null | undefined) => (s ? String(s).slice(-4) : null);

/** a registration item as the pages show it: the shown state + the provider snapshot it came from */
export type RegItemOut = { state: RegState; providerStatus: string | null } & Omit<RegItemView, 'state' | 'providerStatus' | 'kind'>;

/** PM-02: a SID as shown in every ordinary response — its 2-letter prefix and last 4 (`AC…1234`); null stays null */
export function maskSid(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return s.length > 6 ? `${s.slice(0, 2)}…${s.slice(-4)}` : '…';
}
/** a value the edit form sent back unchanged from a masked read (`AC…1234` / `AC...1234` / `AC••1234`) */
export function isMaskedSid(v: string, prefix: string): boolean {
  return new RegExp(`^${prefix}(…|\\.{2,3}|•+|\\*+)[0-9a-fA-F]{4}$`).test(v.trim());
}

/** PM-01: the test SMS states the pages show — requested / accepted / sent / delivered / undelivered / failed / unknown */
export type TestDisplayState = 'requested' | 'accepted' | 'sent' | 'delivered' | 'undelivered' | 'failed' | 'unknown';
/** a "sending" row older than this never reached a provider answer; an accepted / sent one without a callback after this is unknown */
export const TEST_REQUEST_LOST_MS = 10 * 60_000;
export const TEST_CALLBACK_WAIT_MS = 24 * 3600 * 1000;
export function testDisplayState(status: string, statusUpdatedAt: Date | null, now: Date): TestDisplayState {
  const age = statusUpdatedAt ? now.getTime() - statusUpdatedAt.getTime() : 0;
  if (status === 'sending') return age > TEST_REQUEST_LOST_MS ? 'unknown' : 'requested';
  if (status === 'accepted' || status === 'sent') return age > TEST_CALLBACK_WAIT_MS ? 'unknown' : status;
  if (status === 'delivered' || status === 'undelivered' || status === 'failed') return status;
  if (status === 'rejected') return 'failed';
  return 'unknown';
}

const recordState = (kind: ItemKind, r: A2pRow | null): RegState | null => {
  if (!r) return null;
  if (kind === 'brand') return r.brandStatus ? (normalizeBrand(r.brandStatus) === 'unknown' ? 'unable_to_verify' : normalizeBrand(r.brandStatus) as RegState) : r.brandSid ? 'pending' : null;
  if (kind === 'campaign') return r.campaignStatus ? (normalizeCampaign(r.campaignStatus) === 'unknown' ? 'unable_to_verify' : normalizeCampaign(r.campaignStatus) as RegState) : r.campaignSid ? 'pending' : null;
  if (kind === 'messaging_service') return r.messagingServiceSid ? 'pending' : null;
  return r.messagingServiceSid ? (r.numberAttached ? 'approved' : 'pending') : null;
};
/** registration item → the readiness' RegState vocabulary ("unknown — not verified" = unable_to_verify) */
const regOut = (v: RegItemView): RegItemOut => {
  const { kind: _k, state, ...rest } = v;
  return { ...rest, state: state === 'unknown' ? 'unable_to_verify' : (state as RegState) };
};

/** A fingerprint of the configuration a check is about — SIDs, the sender and the secrets' CIPHERTEXT, hashed. */
export function configFingerprint(r: { account_sid?: unknown; auth_token_enc?: unknown; api_key_sid?: unknown; api_key_secret_enc?: unknown; from_number?: unknown; verify_service_sid?: unknown }): string {
  const parts = [r.account_sid, r.auth_token_enc, r.api_key_sid, r.api_key_secret_enc, r.from_number, r.verify_service_sid].map((x) => String(x ?? ''));
  return createHash('sha256').update(parts.join('\u0001')).digest('hex');
}

export function mapBrand(status: string | null, hasSid: boolean): RegState {
  const s = String(status ?? '').toUpperCase();
  if (!s) return hasSid ? 'unable_to_verify' : 'not_started';
  if (s === 'PENDING' || s === 'IN_REVIEW' || s === 'IN_PROGRESS') return 'pending';
  if (s === 'APPROVED' || s === 'VERIFIED' || s === 'REGISTERED') return 'approved';
  if (s === 'FAILED' || s === 'REJECTED') return 'rejected';
  if (s === 'SUSPENDED') return 'suspended';
  return 'unable_to_verify';
}
export function mapCampaign(status: string | null, hasSid: boolean): RegState {
  const s = String(status ?? '').toUpperCase();
  if (!s) return hasSid ? 'unable_to_verify' : 'not_started';
  if (s === 'PENDING' || s === 'IN_PROGRESS' || s === 'IN_REVIEW') return 'pending';
  if (s === 'VERIFIED' || s === 'APPROVED' || s === 'ACTIVE') return 'approved';
  if (s === 'FAILED' || s === 'REJECTED') return 'rejected';
  if (s === 'SUSPENDED' || s === 'EXPIRED') return 'suspended';
  return 'unable_to_verify';
}
const FINAL_TEST = new Set(['delivered', 'failed', 'undelivered', 'rejected']);

export function evaluateReadiness(i: ReadinessInput): MessagingReadiness {
  const now = i.now.getTime();
  const c = i.cred;
  // the check is evidence about THIS configuration only, and only while fresh
  const checkMatches = !!(c && i.lastCheck && i.lastCheck.fingerprint === c.fingerprint);
  const checkFresh = checkMatches && now - i.lastCheck!.checkedAt.getTime() <= CHECK_STALE_AFTER_MS;
  const chk = checkMatches ? i.lastCheck : null;

  // ── (a) account connectivity ──
  let account: MessagingReadiness['account'];
  {
    const mode = c ? c.accountMode : i.sharedPlatformAccount ? 'shared_platform' : 'none';
    const keyState = chk?.apiKeyState ?? null;
    const base = { mode, accountSidLast4: last4(c?.accountSid), accountSidMasked: maskSid(c?.accountSid), authTokenLast4: c?.authTokenLast4 ?? null, authMode: (c ? (c.apiKeySid && c.hasApiKeySecret ? 'api_key' : 'auth_token') : null) as 'api_key' | 'auth_token' | null,
      apiKey: { sid: maskSid(c?.apiKeySid), sidLast4: last4(c?.apiKeySid), hasSecret: !!c?.hasApiKeySecret, state: keyState,
        scope: (!c?.apiKeySid ? null : keyState === 'connected' ? 'sufficient' : keyState === 'limited' ? 'insufficient' : 'unknown') as 'sufficient' | 'insufficient' | 'unknown' | null },
      accountType: chk?.accountType ?? null, fixLink: FIX.credentials } as const;
    if (!c) account = { ...base, state: 'not_configured', lastCheckedAt: null, reasonCode: i.sharedPlatformAccount ? 'USING_PLATFORM_SHARED_ACCOUNT' : 'NO_CREDENTIALS' };
    else if (!chk) account = { ...base, state: 'unknown', lastCheckedAt: iso(i.lastCheck?.checkedAt), reasonCode: i.lastCheck ? 'NOT_CHECKED_SINCE_CHANGE' : 'NEVER_CHECKED' };
    else if (chk.accountState === 'connected' && c.apiKeySid && !c.hasApiKeySecret) account = { ...base, state: 'invalid', lastCheckedAt: iso(chk.checkedAt), reasonCode: 'API_KEY_SECRET_MISSING' };
    else if (chk.accountState === 'connected') account = { ...base, state: checkFresh ? 'connected' : 'stale', lastCheckedAt: iso(chk.checkedAt), reasonCode: checkFresh ? chk.accountReasonCode : 'CHECK_STALE' };
    else if (chk.accountState === 'invalid') account = { ...base, state: 'invalid', lastCheckedAt: iso(chk.checkedAt), reasonCode: chk.accountReasonCode ?? 'TWILIO_AUTH_FAILED' };
    else account = { ...base, state: 'unknown', lastCheckedAt: iso(chk.checkedAt), reasonCode: chk.accountReasonCode ?? 'PROVIDER_UNREACHABLE' };
  }

  // ── (b) sender number: ownership + capability ──
  let sender: MessagingReadiness['sender'];
  {
    const number = c?.fromNumber ?? (c?.messagingServiceSid ? null : i.registryNumber);
    const senderType = senderTypeOf(number ?? c?.messagingServiceSid);
    const base = { number, senderType, fixLink: FIX.number };
    if (!number && !c?.messagingServiceSid) sender = { ...base, state: 'missing', lastCheckedAt: null, reasonCode: c?.verifyServiceSid ? 'VERIFY_ONLY_NO_SENDER' : 'NO_SENDER_NUMBER', capabilities: null, smsCapable: null };
    else if (!number) sender = { ...base, state: 'unknown', lastCheckedAt: null, reasonCode: 'MESSAGING_SERVICE_SENDER_POOL', capabilities: null, smsCapable: null };
    else if (!c) sender = { ...base, state: 'unknown', lastCheckedAt: null, reasonCode: 'PLATFORM_NUMBER_NOT_CHECKED_HERE', capabilities: null, smsCapable: null };
    else if (!chk || chk.senderNumber !== number || !chk.senderState) sender = { ...base, state: 'unknown', lastCheckedAt: iso(chk?.checkedAt), reasonCode: chk ? 'SENDER_NOT_CHECKED' : 'NOT_CHECKED_SINCE_CHANGE', capabilities: null, smsCapable: null };
    else if (!checkFresh) sender = { ...base, state: 'unknown', lastCheckedAt: iso(chk.checkedAt), reasonCode: 'CHECK_STALE', capabilities: chk.senderCapabilities, smsCapable: chk.senderCapabilities ? chk.senderCapabilities.sms : null };
    else if (chk.senderState === 'assigned') sender = { ...base, state: 'assigned', lastCheckedAt: iso(chk.checkedAt), reasonCode: chk.senderCapabilities && !chk.senderCapabilities.sms ? 'NUMBER_NO_SMS_CAPABILITY' : null, capabilities: chk.senderCapabilities, smsCapable: chk.senderCapabilities ? chk.senderCapabilities.sms : null };
    else if (chk.senderState === 'not_owned') sender = { ...base, state: 'not_owned', lastCheckedAt: iso(chk.checkedAt), reasonCode: 'TWILIO_NUMBER_NOT_ON_ACCOUNT', capabilities: null, smsCapable: null };
    else sender = { ...base, state: 'unknown', lastCheckedAt: iso(chk.checkedAt), reasonCode: 'SENDER_CHECK_FAILED', capabilities: null, smsCapable: null };
  }

  // ── (c–f) A2P brand / campaign / Messaging Service / number association — PROVIDER-backed (PM-03) ──
  // A Super Admin submission (tenant_a2p_registrations) is a claim; "approved" needs a fresh provider snapshot.
  let a2p: MessagingReadiness['a2p'];
  const regItems = i.registration?.items ?? {};
  const tollFree = tollfreeView(sender.number, regItems.tollfree_verification ?? null, i.now);
  {
    const r = i.a2p;
    const brandV = regOut(itemView('brand', regItems.brand ?? null, recordState('brand', r) as never, i.now));
    const campaignV = regOut(itemView('campaign', regItems.campaign ?? null, recordState('campaign', r) as never, i.now));
    const assocV = regOut(itemView('number_association', regItems.number_association ?? null, recordState('number_association', r) as never, i.now));
    const svcSnap = regItems.messaging_service ?? null;
    const svcV = regOut(itemView('messaging_service', svcSnap, recordState('messaging_service', r) as never, i.now));
    // the service is usable for this sender when the provider shows the number in it (the association decides)
    const msState: RegState = !r?.messagingServiceSid && !svcSnap ? 'not_started' : assocV.source !== 'none' ? assocV.state : svcV.state;
    const brand = brandV.state, campaign = campaignV.state, ms = msState;
    const nonApplicable = sender.senderType === 'toll_free' ? 'TOLL_FREE_VERIFICATION_SEPARATE' : sender.senderType === 'short_code' ? 'SHORT_CODE_SEPARATE' : sender.state === 'missing' && c?.verifyServiceSid ? 'VERIFY_ONLY_NO_SENDER' : null;
    const states = [brand, campaign, ms];
    let overall: RegState;
    let reason: string | null = null;
    if (nonApplicable) { overall = 'not_applicable'; reason = nonApplicable; }
    else if (states.includes('rejected') || (String(r?.status ?? '') === 'failed' && !brandV.verified)) { overall = 'rejected'; reason = brand === 'rejected' ? 'BRAND_REJECTED' : campaign === 'rejected' ? 'CAMPAIGN_REJECTED' : 'REGISTRATION_FAILED'; }
    else if (states.includes('suspended')) { overall = 'suspended'; reason = campaign === 'suspended' ? 'CAMPAIGN_SUSPENDED' : 'BRAND_SUSPENDED'; }
    else if (states.every((x) => x === 'approved')) overall = 'approved';
    else if (states.every((x) => x === 'not_started')) { overall = 'not_started'; reason = 'REGISTRATION_NOT_STARTED'; }
    // a KNOWN missing step (pending / not started) outranks "could not verify": it blocks; an unverified one only warns
    else if (states.some((x) => x === 'pending' || x === 'not_started')) {
      overall = 'pending';
      reason = brand === 'pending' || brand === 'not_started' ? 'BRAND_PENDING' : campaign === 'pending' || campaign === 'not_started' ? 'CAMPAIGN_PENDING' : 'NUMBER_NOT_IN_MESSAGING_SERVICE';
    }
    else {
      overall = 'unable_to_verify';
      const why = [brandV, campaignV, assocV, svcV].find((x) => x.state === 'unable_to_verify');
      reason = why?.reasonCode ?? 'PROVIDER_STATUS_UNRECOGNISED';
    }
    const stale = !!(r?.updatedAt && overall === 'pending' && now - r.updatedAt.getTime() > A2P_STALE_AFTER_MS);
    const views = [brandV, campaignV, assocV, svcV];
    const checks = views.map((x) => x.checkedAt).filter(Boolean).sort() as string[];
    const successes = views.map((x) => x.lastSuccessAt).filter(Boolean).sort() as string[];
    a2p = { state: overall, lastCheckedAt: checks[checks.length - 1] ?? iso(r?.updatedAt), reasonCode: reason, fixLink: FIX.registration, applicable: !nonApplicable,
      brand: brandV, campaign: campaignV, messagingService: { ...svcV, state: msState, sidLast4: last4(r?.messagingServiceSid), numberAttached: assocV.state === 'approved' }, numberAssociation: assocV,
      lastUpdatedAt: iso(r?.updatedAt), stale, providerVerified: !nonApplicable && views.every((x) => x.verified), lastProviderCheckAt: checks[checks.length - 1] ?? null,
      lastProviderSuccessAt: successes[successes.length - 1] ?? null, lastRun: i.registration?.lastRun ?? null };
  }

  // ── inbound + status webhooks ──
  const fresh = (d: Date | null) => !!d && now - d.getTime() <= WEBHOOK_FRESH_MS;
  let inboundState: MessagingReadiness['inbound']['state']; let inboundReason: string | null = null;
  if (fresh(i.webhooks.inbound)) inboundState = 'verified';
  else if (chk?.inboundUrlState === 'matches' && checkFresh) { inboundState = 'configured'; inboundReason = 'NO_VERIFIED_INBOUND_EVENT'; }
  else if (chk?.inboundUrlState === 'mismatch' && checkFresh) { inboundState = 'failed'; inboundReason = 'INBOUND_URL_MISMATCH'; }
  else if (chk?.inboundUrlState === 'not_set' && checkFresh) { inboundState = 'failed'; inboundReason = 'INBOUND_URL_NOT_SET'; }
  else { inboundState = 'untested'; inboundReason = i.expectedInboundUrl ? 'NOT_CHECKED' : 'PUBLIC_API_BASE_URL_NOT_SET'; }
  const statusState: 'configured' | 'verified' | 'untested' = fresh(i.webhooks.status) ? 'verified' : i.statusCallbackUrl ? 'configured' : 'untested';
  const inbound: MessagingReadiness['inbound'] = {
    state: inboundState, lastCheckedAt: iso(chk?.checkedAt), reasonCode: inboundReason, fixLink: FIX.webhooks, webhookUrl: i.expectedInboundUrl, lastVerifiedEventAt: iso(i.webhooks.inbound),
    numbers: checkFresh && Array.isArray(chk?.numbersInbound) ? chk!.numbersInbound! : [],
    statusCallback: { state: statusState, lastCheckedAt: iso(i.webhooks.status), reasonCode: statusState === 'untested' ? 'STATUS_CALLBACK_NOT_SET' : statusState === 'configured' ? 'NO_VERIFIED_STATUS_EVENT' : null, fixLink: FIX.webhooks, url: i.statusCallbackUrl, lastVerifiedEventAt: iso(i.webhooks.status) },
  };

  // ── (g) outbound readiness ──
  const blockers: string[] = []; const warnings: string[] = [];
  if (account.state === 'invalid') blockers.push(account.reasonCode ?? 'ACCOUNT_INVALID');
  else if (account.state === 'not_configured') (i.sharedPlatformAccount ? warnings : blockers).push(account.reasonCode ?? 'NO_CREDENTIALS');
  else if (account.state !== 'connected') warnings.push(account.state === 'stale' ? 'ACCOUNT_CHECK_STALE' : 'ACCOUNT_NOT_CHECKED');
  if (sender.state === 'missing') blockers.push('NO_SENDER_NUMBER');
  else if (sender.state === 'not_owned') blockers.push('TWILIO_NUMBER_NOT_ON_ACCOUNT');
  else if (sender.smsCapable === false) blockers.push('NUMBER_NO_SMS_CAPABILITY');
  else if (sender.state === 'unknown') warnings.push('SENDER_NOT_CHECKED');
  if (a2p.applicable) {
    if (a2p.state === 'unable_to_verify') warnings.push('A2P_UNABLE_TO_VERIFY');
    else if (a2p.state !== 'approved') blockers.push(`A2P_${a2p.state.toUpperCase()}`);
  } else if (tollFree.applicable) {
    // PM-04: a toll-free sender needs ITS verification (not 10DLC); unverified toll-free traffic is blocked by carriers
    if (tollFree.state === 'unknown') warnings.push('TOLL_FREE_UNABLE_TO_VERIFY');
    else if (tollFree.state !== 'approved') blockers.push(`TOLL_FREE_${tollFree.state.toUpperCase()}`);
  }
  if (account.apiKey.scope === 'insufficient') warnings.push('API_KEY_SCOPE_INSUFFICIENT');
  if (i.config && i.config.state === 'invalid') warnings.push('MESSAGING_CONFIG_INVALID');
  if (statusState === 'untested') warnings.push('DELIVERY_NOT_TRACKED');
  const outbound: MessagingReadiness['outbound'] = {
    state: blockers.length ? 'blocked' : warnings.filter((w) => w !== 'DELIVERY_NOT_TRACKED').length ? 'degraded' : 'ready_to_attempt',
    lastCheckedAt: iso(chk?.checkedAt), reasonCode: blockers[0] ?? warnings[0] ?? null, fixLink: blockers.length ? fixFor(blockers[0]) : FIX.test, blockers, warnings, deliveryTracking: statusState !== 'untested',
  };

  // ── booking Verify: platform policy + tenant toggle + provider readiness (independent of A2P) ──
  let verify: MessagingReadiness['verify'];
  {
    const p = i.verify;
    const base = { tenantEnabled: p.tenantEnabled, requiredByPlatform: p.requiredByPlatform, platformBlocked: p.blockedByPlatform || p.moduleDisabled || p.emergencyDisabled,
      channel: (c?.verifyServiceSid ? 'verify_service' : c?.fromNumber ? 'sms_code' : null) as 'verify_service' | 'sms_code' | null, serviceSidLast4: last4(c?.verifyServiceSid), settingsSource: p.source, lastCheckedAt: iso(c?.lastValidatedAt) };
    if (p.emergencyDisabled) verify = { ...base, state: 'disabled', reasonCode: 'PLATFORM_EMERGENCY_OFF', fixLink: FIX.bookingVerify };
    else if (p.moduleDisabled) verify = { ...base, state: 'disabled', reasonCode: 'PLATFORM_MODULE_OFF', fixLink: FIX.bookingVerify };
    else if (p.blockedByPlatform) verify = { ...base, state: 'disabled', reasonCode: 'PLATFORM_BLOCKED', fixLink: FIX.bookingVerify };
    else if (!p.tenantEnabled && !p.requiredByPlatform) verify = { ...base, state: 'disabled', reasonCode: 'TENANT_DISABLED', fixLink: FIX.bookingVerify };
    else if (!c) verify = { ...base, state: 'misconfigured', reasonCode: 'NO_CREDENTIALS', fixLink: FIX.credentials };
    else if (c.apiKeySid && !c.hasApiKeySecret) verify = { ...base, state: 'misconfigured', reasonCode: 'API_KEY_SECRET_MISSING', fixLink: FIX.credentials };
    else if (!c.verifyServiceSid && !c.fromNumber) verify = { ...base, state: 'misconfigured', reasonCode: 'VERIFY_SERVICE_MISSING', fixLink: FIX.verify };
    else if (!c.lastValidatedAt) verify = { ...base, state: 'misconfigured', reasonCode: c.lastValidationError ? 'VERIFY_TEST_FAILED' : 'VERIFY_NOT_TESTED', fixLink: FIX.verify };
    else verify = { ...base, state: 'ready', reasonCode: null, fixLink: FIX.bookingVerify };
  }

  const t = i.lastTest;
  const lastTest = t ? { ...t, createdAt: t.createdAt.toISOString(), statusUpdatedAt: t.statusUpdatedAt.toISOString(), deliveredAt: iso(t.deliveredAt), final: FINAL_TEST.has(t.status), displayState: testDisplayState(t.status, t.statusUpdatedAt, i.now) } : null;

  const step = (key: MessagingReadiness['checklist'][number]['key'], state: MessagingReadiness['checklist'][number]['state'], reasonCode: string | null, fixLink: string) => ({ key, state, reasonCode, fixLink });
  const checklist: MessagingReadiness['checklist'] = [
    step('connect', account.state === 'connected' ? 'done' : account.state === 'invalid' ? 'blocked' : 'action', account.reasonCode, FIX.credentials),
    step('number', sender.state === 'assigned' && sender.smsCapable !== false ? 'done' : sender.state === 'not_owned' || sender.smsCapable === false ? 'blocked' : 'action', sender.reasonCode, sender.state === 'missing' ? FIX.search : FIX.number),
    tollFree.applicable
      ? step('registration', tollFree.state === 'approved' ? 'done' : tollFree.state === 'pending' ? 'pending' : tollFree.state === 'rejected' ? 'blocked' : 'action', tollFree.nextAction ?? tollFree.reasonCode, FIX.registration)
      : step('registration', !a2p.applicable ? 'not_applicable' : a2p.state === 'approved' ? 'done' : a2p.state === 'pending' ? 'pending' : a2p.state === 'rejected' || a2p.state === 'suspended' ? 'blocked' : 'action', a2p.reasonCode, FIX.registration),
    step('webhooks', (inbound.state === 'verified' || inbound.state === 'configured') && statusState !== 'untested' ? 'done' : inbound.state === 'failed' ? 'blocked' : 'action', inbound.state === 'failed' ? inbound.reasonCode : statusState === 'untested' ? 'STATUS_CALLBACK_NOT_SET' : inbound.reasonCode, FIX.webhooks),
    step('test', t?.status === 'delivered' ? 'done' : t && FINAL_TEST.has(t.status) ? 'blocked' : t ? 'pending' : 'action', t ? (t.status === 'delivered' ? null : t.errorCode ?? `TEST_${t.status.toUpperCase()}`) : 'NO_TEST_YET', FIX.test),
  ];

  return { generatedAt: i.now.toISOString(), staleAfterSeconds: CHECK_STALE_AFTER_MS / 1000, source: i.source, account, sender, a2p, tollFree, config: i.config ?? null, outbound, inbound, verify,
    voice: { numberVoiceCapable: sender.capabilities ? sender.capabilities.voice : null, fixLink: FIX.aiReceptionist }, lastTest, checklist };
}

function fixFor(code: string): string {
  if (/^A2P_|^TOLL_FREE_/.test(code)) return FIX.registration;
  if (/NUMBER|SENDER/.test(code)) return FIX.number;
  return FIX.credentials;
}
