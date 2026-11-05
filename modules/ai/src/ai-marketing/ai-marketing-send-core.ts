// ai-marketing-send-core.ts — PURE send-safety logic (no I/O). Two responsibilities:
//   1) idempotencyKey(): the stable key (tenant+campaign+recipient+channel+message_version) that the durable
//      ledger's UNIQUE index enforces. A recipient can receive a given campaign/channel/version at most once.
//   2) decideSend(): the AT-SEND-TIME re-validation. Even though consent/audience were checked at approval,
//      state can change afterward — so we re-check here. A customer who opted out AFTER approval is skipped.
// This is the heart of "opt-outs are always enforced" and "duplicate sends are prevented".

export type SendChannel = 'sms' | 'email' | 'push';

export interface SendKeyParts {
  tenantId: string;
  campaignId: string;
  customerId: string;
  channel: SendChannel;
  messageVersion: number;
}

export function idempotencyKey(p: SendKeyParts): string {
  // Order-fixed, lowercased channel; version coerced to an integer. Any field change yields a distinct key.
  return [p.tenantId, p.campaignId, p.customerId, p.channel, String(Math.trunc(p.messageVersion) || 1)].join('|');
}

// Current, freshly-read state of a recipient at execution time.
export interface RecipientState {
  hasConsent: boolean; // channel consent flag on the customer (marketing_sms_opt_in / marketing_email_opt_in)
  hasUsableContact: boolean; // non-empty phone (sms) / email (email) / push token (push)
  isSuppressed: boolean; // present on notification_opt_outs for this (tenant, channel, address)
}

export type SkipReason =
  | 'already_sent'
  | 'opted_out'
  | 'no_consent'
  | 'missing_contact'
  | 'frequency_capped'
  | 'quiet_hours';

export interface SendDecision {
  action: 'send' | 'skip';
  reason?: SkipReason;
}

// Tenant-level messaging-limit decision (from the existing limits evaluator).
export interface LimitDecision {
  action: 'allow' | 'block';
}

// Decide whether to dispatch to one recipient. `alreadySent` comes from the durable ledger (idempotency).
// `quietHoursActive` is optional; when true (tenant quiet-hours window), the recipient is deferred/skipped.
export function decideSend(
  state: RecipientState,
  alreadySent: boolean,
  limit: LimitDecision,
  quietHoursActive = false,
): SendDecision {
  if (alreadySent) return { action: 'skip', reason: 'already_sent' }; // idempotency: never a second send
  if (state.isSuppressed) return { action: 'skip', reason: 'opted_out' }; // opt-out AFTER approval is honored
  if (!state.hasConsent) return { action: 'skip', reason: 'no_consent' };
  if (!state.hasUsableContact) return { action: 'skip', reason: 'missing_contact' };
  if (quietHoursActive) return { action: 'skip', reason: 'quiet_hours' };
  if (limit.action === 'block') return { action: 'skip', reason: 'frequency_capped' };
  return { action: 'send' };
}
