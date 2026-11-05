// @aipowersalon/notifications — Constitution 13 §78: provider infrastructure only. The SMS and email PORTS
// (SmsSender, EmailSender), their provider implementations (Twilio, SendGrid) and in-memory mocks. What a message
// says, who may receive it and when (opt-outs, quiet hours, credits) stay in the sending domain.
export * from './email.service';   // moved from apps/api/src/auth/email.service.ts (Constitution 13 §219)
export * from './sms.service';   // moved from apps/api/src/auth/sms.service.ts (Constitution 13 §219)
export { computeTwilioSignature, verifyTwilioSignature, classifyInboundKeyword, type InboundKeyword } from './twilio-inbound-core';   // Twilio inbound: signature verification and STOP/START/HELP keywords (moved from apps/api/src/messaging-inbound)
export * from './tenant-messenger';   // Phase 2 (Oct 2026): the one send path every module uses (TENANT_MESSENGER)
export * from './twilio-verify-service';   // Phase 4: the salon's own Verify Service (base URL, signing, the "Test Verify" probe)
export * from './sender-selection';   // P-11 (wave 4 pilot): the one sender selection — never a mock in production
