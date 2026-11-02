// phoneMessagingTestKit.ts — a server readiness answer for the Phone & Messaging screen tests (shape of
// GET /tenant/messaging/readiness). Tests override the parts they are about.
import type { MessagingReadiness } from '../api/posPhoneApi';

/** a provider-backed registration item (PM-03) */
export const regItem = (state: string, over: Record<string, unknown> = {}) => ({ state, providerStatus: null, verified: false, source: 'none', reasonCode: null, providerIdLast4: null, errorClass: null,
  checkedAt: null, lastSuccessAt: null, retryCount: 0, nextRetryAt: null, stale: false, ...over });
const st = (state: string, reasonCode: string | null = null, fixLink = '/tenant/communications/messaging-setup#credentials') => ({ state, lastCheckedAt: '2026-10-30T15:00:00.000Z', reasonCode, fixLink });

export function readinessFixture(over: Partial<MessagingReadiness> = {}): MessagingReadiness {
  return {
    generatedAt: '2026-10-30T15:05:00.000Z', staleAfterSeconds: 86400, source: 'tenant_default',
    scope: { branchId: null, salonName: 'Luxe Nails', branchName: null, inheritsFromDefault: false, branchOverrides: [], branchesInheriting: [{ branchId: 'b1', name: 'Main' }, { branchId: 'b2', name: 'Uptown' }],
      authorizedBranches: [{ branchId: 'b1', name: 'Main', source: 'tenant_default' }, { branchId: 'b2', name: 'Uptown', source: 'tenant_default' }] },
    account: { ...st('connected'), mode: 'tenant_owned', accountSidLast4: '1111', accountSidMasked: 'AC…1111', authTokenLast4: 'abcd', authMode: 'auth_token', apiKey: { sid: null, sidLast4: null, hasSecret: false, state: 'not_used', scope: null }, accountType: 'Full' },
    sender: { ...st('assigned', null, '/tenant/communications/messaging-setup#number'), number: '+18565550100', senderType: '10dlc', capabilities: { sms: true, voice: true, mms: false }, smsCapable: true },
    a2p: { ...st('not_started', 'REGISTRATION_NOT_STARTED', '/tenant/communications/messaging-setup#registration'), applicable: true, brand: regItem('not_started'), campaign: regItem('not_started'),
      messagingService: { ...regItem('not_started'), sidLast4: null, numberAttached: false }, numberAssociation: regItem('not_started'), lastUpdatedAt: null, stale: false,
      providerVerified: false, lastProviderCheckAt: null, lastProviderSuccessAt: null, lastRun: null },
    tollFree: { ...regItem('not_applicable'), applicable: false, numberType: 'local_10dlc', numberTypeSource: 'nanp_prefix', verificationSidLast4: null, submittedAt: null, rejectionCode: null, rejectionReason: null, nextAction: null },
    config: { state: 'ok', items: [{ name: 'PUBLIC_API_BASE_URL', state: 'ok', reasonCodes: [], value: null, expectedRoute: '/webhooks/twilio/sms/inbound' }, { name: 'TWILIO_STATUS_CALLBACK_URL', state: 'ok', reasonCodes: [], value: null, expectedRoute: '/webhooks/twilio/sms/status' }] },
    outbound: { ...st('blocked', 'A2P_NOT_STARTED', '/tenant/communications/messaging-setup#registration'), blockers: ['A2P_NOT_STARTED'], warnings: [], deliveryTracking: true },
    inbound: { ...st('configured', 'NO_VERIFIED_INBOUND_EVENT', '/tenant/communications/messaging-setup#webhooks'), webhookUrl: '/webhooks/twilio/sms/inbound', lastVerifiedEventAt: null, numbers: [{ number: '+18565550100', state: 'matches', reasonCode: null }],
      statusCallback: { ...st('configured', 'NO_VERIFIED_STATUS_EVENT', '/tenant/communications/messaging-setup#webhooks'), url: '/webhooks/twilio/sms/status', lastVerifiedEventAt: null } },
    verify: { ...st('disabled', 'TENANT_DISABLED', '/tenant/communications/phone-verification'), tenantEnabled: false, requiredByPlatform: false, platformBlocked: false, channel: 'verify_service', serviceSidLast4: 'aaaa', settingsSource: 'default' },
    voice: { numberVoiceCapable: true, fixLink: '/tenant/communications/ai-receptionist' },
    lastTest: null,
    checklist: [
      { key: 'connect', state: 'done', reasonCode: null, fixLink: '/tenant/communications/messaging-setup#credentials' },
      { key: 'number', state: 'done', reasonCode: null, fixLink: '/tenant/communications/messaging-setup#number' },
      { key: 'registration', state: 'action', reasonCode: 'REGISTRATION_NOT_STARTED', fixLink: '/tenant/communications/messaging-setup#registration' },
      { key: 'webhooks', state: 'done', reasonCode: null, fixLink: '/tenant/communications/messaging-setup#webhooks' },
      { key: 'test', state: 'action', reasonCode: 'NO_TEST_YET', fixLink: '/tenant/communications/messaging-setup#test' },
    ],
    lastChanged: { at: '2026-10-30T14:00:00.000Z', byUserLast4: '0001' },
    registeredNumbers: [{ number: '+18565550100', status: 'active' }],
    diagnostics: { checks: [{ id: 'c1', checkedAt: '2026-10-30T15:00:00.000Z', trigger: 'manual', accountState: 'connected', reasonCode: null, senderState: 'assigned', apiKeyState: 'not_used', verifyState: 'ok', inboundUrlState: 'matches', durationMs: 120, current: true }], tests: [] },
    ...over,
  };
}
