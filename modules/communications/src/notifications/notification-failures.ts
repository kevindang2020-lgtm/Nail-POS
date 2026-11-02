// notification-failures.ts — pure, DB-free rules for Customer Notifications (Customer Notifications Complete Build Guide §05,
// §08, §10). Read-time only: historical rows are never rewritten — a row's category, sanitized text and retry policy are
// DERIVED from what was stored (normalized status, provider error code, the stored failure text and the recipient).
//
// Evidence order: the provider's numeric error code (Twilio REST `code` / status-callback ErrorCode) → our own internal
// reason words (opted_out, over_limit, not_configured, invalid_destination …) → the provider's message text. Nothing that
// does not match is guessed: it is `unknown` and cannot be retried until someone looks at it.

export const FAILURE_CATEGORIES = [
  'auth', 'geo_permission', 'invalid_destination', 'opted_out', 'registration', 'sender', 'carrier_filtered',
  'over_limit', 'not_configured', 'rate_limit', 'transient', 'email_bounce', 'email_sender', 'unknown',
] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

/** never   = no resend from this screen (fix the customer / consent / content first; a genuinely new message is a new send)
 *  after_fix = a resend is allowed only once the salon's current setup shows the cause is gone (checked server-side at retry)
 *  allowed = a bounded, confirmed, idempotent resend is allowed (transient provider / network trouble) */
export type RetryPolicy = 'never' | 'after_fix' | 'allowed';

export interface FailureInfo {
  category: FailureCategory;
  retry: RetryPolicy;
  /** what staff should do next (English; the POS translates by `action`) */
  action: 'messaging_setup' | 'customer_phone' | 'consent' | 'message_content' | 'sms_plan' | 'email_setup' | 'retry' | 'investigate';
  /** extra evidence-backed root cause, e.g. a national number sent without its country code */
  rootCause: string | null;
}

const BY_CODE: Record<string, FailureCategory> = {
  // Twilio REST / callback error codes (https://www.twilio.com/docs/api/errors)
  '20003': 'auth', '20005': 'auth', '20404': 'auth', '20008': 'auth',
  '21408': 'geo_permission', '21612': 'geo_permission',
  '21211': 'invalid_destination', '21614': 'invalid_destination', '21265': 'invalid_destination', '21217': 'invalid_destination', '30005': 'invalid_destination', '30006': 'invalid_destination',
  '21610': 'opted_out',
  '30034': 'registration', '30032': 'registration', '30035': 'registration', '30036': 'registration', '30024': 'registration',
  '21606': 'sender', '21659': 'sender', '21660': 'sender', '21603': 'sender', '21704': 'sender',
  '30007': 'carrier_filtered',
  '20429': 'rate_limit', '14107': 'rate_limit', '30022': 'rate_limit',
  '30001': 'transient', '30002': 'transient', '30003': 'transient', '30008': 'transient', '30010': 'transient',
};

const POLICY: Record<FailureCategory, { retry: RetryPolicy; action: FailureInfo['action'] }> = {
  auth: { retry: 'after_fix', action: 'messaging_setup' },
  geo_permission: { retry: 'never', action: 'messaging_setup' },
  invalid_destination: { retry: 'never', action: 'customer_phone' },
  opted_out: { retry: 'never', action: 'consent' },
  registration: { retry: 'after_fix', action: 'messaging_setup' },
  sender: { retry: 'after_fix', action: 'messaging_setup' },
  carrier_filtered: { retry: 'never', action: 'message_content' },
  over_limit: { retry: 'after_fix', action: 'sms_plan' },
  not_configured: { retry: 'after_fix', action: 'messaging_setup' },
  rate_limit: { retry: 'allowed', action: 'retry' },
  transient: { retry: 'allowed', action: 'retry' },
  email_bounce: { retry: 'never', action: 'customer_phone' },
  email_sender: { retry: 'after_fix', action: 'email_setup' },
  unknown: { retry: 'never', action: 'investigate' },
};

const E164 = /^\+[1-9]\d{6,14}$/;
/** an SMS recipient that is not E.164 (no "+country code") — the provider then picks a country for it */
export const isE164 = (to: string | null | undefined) => E164.test(String(to ?? '').trim());

function categoryFromText(raw: string, channel: string): FailureCategory | null {
  const t = raw.toLowerCase();
  if (!t) return null;
  // our own reason words first (exact)
  const word = t.replace(/^sms_failed:\s*/, '').trim();
  if (word === 'opted_out') return 'opted_out';
  if (word === 'over_limit') return 'over_limit';
  if (word === 'not_configured') return 'not_configured';
  if (word === 'invalid_destination' || word === 'invalid_message') return 'invalid_destination';
  if (channel === 'email') {
    if (/bounce|mailbox (unavailable|full)|user unknown|does not exist|550\b/.test(t)) return 'email_bounce';
    if (/sender identity|from address|domain.*(verif|authenticat)|not.*verified sender/.test(t)) return 'email_sender';
  }
  if (/authenticat|auth ?token|invalid username|credentials|account.*(suspended|closed|not found)/.test(t)) return 'auth';
  if (/permission to send an sms has not been enabled for the region|geo.?permission|region .*not enabled/.test(t)) return 'geo_permission';
  if (/unsubscribed|21610|blacklist|opted.?out/.test(t)) return 'opted_out';
  if (/a2p|10dlc|toll.?free.*verif|unregistered|campaign.*(not|un)approved|brand/.test(t)) return 'registration';
  if (/not a valid phone number|invalid ['"]?to['"]?|is not a valid|not.*mobile|cannot receive sms|landline/.test(t)) return 'invalid_destination';
  if (/['"]?from['"]? (number|phone).*(not|invalid)|not owned|messaging ?service|sender.*not/.test(t)) return 'sender';
  if (/filtered|spam|carrier.*block/.test(t)) return 'carrier_filtered';
  if (/rate|too many requests|429|throttl/.test(t)) return 'rate_limit';
  if (/timeout|timed out|econn|etimedout|enotfound|socket|network|fetch failed|unreachable|unavailable|\b5\d\d\b|could not reach/.test(t)) return 'transient';
  return null;
}

/** classify one stored ledger row (status 'failed' or 'blocked'); null for rows that did not fail */
export function classifyFailure(r: { status: string; channel: string; toAddress?: string | null; failureReason?: string | null; providerErrorCode?: string | null; providerStatus?: string | null }): FailureInfo | null {
  if (r.status !== 'failed' && r.status !== 'blocked') return null;
  const code = String(r.providerErrorCode ?? '').trim();
  let category: FailureCategory | null = code && BY_CODE[code] ? BY_CODE[code] : null;
  const text = String(r.failureReason ?? '');
  if (!category) {
    // the old sender put Twilio's numeric code nowhere but the message text sometimes carries it
    const inline = /\b(2\d{4}|3\d{4}|14107)\b/.exec(text)?.[1];
    if (inline && BY_CODE[inline]) category = BY_CODE[inline];
  }
  if (!category) category = categoryFromText(text, r.channel);
  if (!category && /^provider_(failed|undelivered)$/.test(text)) category = 'unknown';   // a carrier failure with no code
  if (!category) category = 'unknown';
  let rootCause: string | null = null;
  // Evidence (guide §08): the "region not enabled" refusals in the reference screenshot were sent to a national number with
  // no "+country code" (e.g. 7876299624). Twilio reads the leading digits as a country code (+7 …) and refuses the region —
  // the real cause is the missing country code, not the salon's geo permissions.
  if (r.channel === 'sms' && r.toAddress && !isE164(r.toAddress) && (category === 'geo_permission' || category === 'invalid_destination' || category === 'unknown')) {
    category = 'invalid_destination'; rootCause = 'missing_country_code';
  }
  const p = POLICY[category];
  return { category, retry: p.retry, action: p.action, rootCause };
}

/** provider text safe to show staff: no account / key SIDs, no full phone numbers, no email addresses, no tokens */
export function sanitizeProviderText(raw: string | null | undefined, max = 180): string | null {
  if (raw == null) return null;
  let s = String(raw);
  s = s.replace(/\b(AC|SK|MG|PN|SM|MM|VA|IS)[0-9a-fA-F]{32}\b/g, (m) => `${m.slice(0, 2)}…${m.slice(-4)}`);
  s = s.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, (m) => { const [u, d] = m.split('@'); return `${u.slice(0, 1)}•••@${d}`; });
  s = s.replace(/\+?\d[\d\s().-]{6,}\d/g, (m) => { const d = m.replace(/\D/g, ''); return d.length >= 7 ? `•••${d.slice(-4)}` : m; });
  s = s.replace(/\b(token|secret|password|key)\s*[:=]\s*\S+/gi, '$1=•••');
  s = s.replace(/^sms_failed:\s*/i, '').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export const UNKNOWN_AFTER_MS = 24 * 3600 * 1000;
/** the state staff see. `sent` = the provider accepted it (never "delivered"); with no callback for 24 h it is Unknown */
export type DisplayState = 'delivered' | 'sent' | 'pending' | 'unknown' | 'failed' | 'blocked' | 'simulated';
export function displayState(r: { status: string; createdAt: string | Date; deliveredAt?: string | Date | null }, now = Date.now()): DisplayState {
  if (r.status === 'delivered') return 'delivered';
  if (r.status === 'failed') return 'failed';
  if (r.status === 'blocked') return 'blocked';
  if (r.status === 'simulated') return 'simulated';
  if (r.status === 'sent') return now - new Date(r.createdAt).getTime() > UNKNOWN_AFTER_MS ? 'unknown' : 'pending';
  return 'unknown';
}

/** masked recipient for staff who may not see the full contact */
export function maskRecipient(channel: string, to: string | null | undefined): string {
  const a = String(to ?? '');
  if (!a) return '—';
  if (channel === 'email') { const [u, d] = a.split('@'); return d ? `${(u || '').slice(0, 1)}•••@${d}` : '•••'; }
  const d = a.replace(/\D/g, '');
  return d.length >= 4 ? `•••${d.slice(-4)}` : '•••';
}

// ── alert rules (guide §12 defaults; a salon may change them) ────────────────────────────────────────────────────────────
export interface AlertSettings {
  repeatedFailures: { count: number; windowMinutes: number };
  failureRatio: { minAttempts: number; ratioPercent: number; windowMinutes: number };
  callbackStaleHours: number;
  pendingBacklog: { count: number; oldestMinutes: number };
  enabled: boolean;
}
export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  repeatedFailures: { count: 3, windowMinutes: 15 },
  failureRatio: { minAttempts: 5, ratioPercent: 25, windowMinutes: 30 },
  callbackStaleHours: 24,
  pendingBacklog: { count: 20, oldestMinutes: 120 },
  enabled: true,
};
const clampInt = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export function normalizeAlertSettings(raw: any): AlertSettings {
  const d = DEFAULT_ALERT_SETTINGS; const r = raw && typeof raw === 'object' ? raw : {};
  return {
    repeatedFailures: { count: clampInt(r.repeatedFailures?.count, 2, 50, d.repeatedFailures.count), windowMinutes: clampInt(r.repeatedFailures?.windowMinutes, 5, 240, d.repeatedFailures.windowMinutes) },
    failureRatio: { minAttempts: clampInt(r.failureRatio?.minAttempts, 3, 500, d.failureRatio.minAttempts), ratioPercent: clampInt(r.failureRatio?.ratioPercent, 5, 100, d.failureRatio.ratioPercent), windowMinutes: clampInt(r.failureRatio?.windowMinutes, 10, 720, d.failureRatio.windowMinutes) },
    callbackStaleHours: clampInt(r.callbackStaleHours, 1, 168, d.callbackStaleHours),
    pendingBacklog: { count: clampInt(r.pendingBacklog?.count, 5, 10000, d.pendingBacklog.count), oldestMinutes: clampInt(r.pendingBacklog?.oldestMinutes, 15, 1440, d.pendingBacklog.oldestMinutes) },
    enabled: r.enabled === undefined ? true : !!r.enabled,
  };
}

export type AlertRule = 'repeated_failures' | 'failure_ratio' | 'credential_invalid' | 'callbacks_stale' | 'pending_backlog';
export interface WindowStats { channel: 'sms' | 'email'; failuresInRepeatWindow: { category: FailureCategory; count: number; first: string; last: string }[]; ratioAttempts: number; ratioTerminalFailures: number; ratioFirst: string | null; ratioLast: string | null }
export interface Detection { rule: AlertRule; channel: 'sms' | 'email'; severity: 'warning' | 'high' | 'critical'; title: string; body: string; count: number; first: string | null; last: string | null; category?: FailureCategory | null }

/** which alert rules fire for one channel's window counts (pure; the evaluator supplies the counts) */
export function detectFromStats(s: WindowStats, cfg: AlertSettings): Detection[] {
  const out: Detection[] = [];
  if (!cfg.enabled) return out;
  for (const f of s.failuresInRepeatWindow) {
    if (f.category === 'opted_out') continue;   // a customer's own STOP is not a system failure
    if (f.count >= cfg.repeatedFailures.count) {
      out.push({ rule: 'repeated_failures', channel: s.channel, severity: f.category === 'auth' ? 'critical' : 'high', category: f.category, count: f.count, first: f.first, last: f.last,
        title: `${s.channel === 'sms' ? 'Text messages' : 'Emails'} are failing: ${f.category.replace(/_/g, ' ')}`,
        body: `${f.count} ${s.channel === 'sms' ? 'text' : 'email'} failures of the same kind (${f.category.replace(/_/g, ' ')}) in the last ${cfg.repeatedFailures.windowMinutes} minutes.` });
    }
  }
  if (s.ratioAttempts >= cfg.failureRatio.minAttempts && s.ratioTerminalFailures * 100 > cfg.failureRatio.ratioPercent * s.ratioAttempts) {
    const pct = Math.round((s.ratioTerminalFailures * 100) / s.ratioAttempts);
    out.push({ rule: 'failure_ratio', channel: s.channel, severity: 'high', count: s.ratioTerminalFailures, first: s.ratioFirst, last: s.ratioLast,
      title: `High ${s.channel === 'sms' ? 'text' : 'email'} failure rate (${pct}%)`,
      body: `${s.ratioTerminalFailures} of ${s.ratioAttempts} ${s.channel === 'sms' ? 'texts' : 'emails'} failed or were refused in the last ${cfg.failureRatio.windowMinutes} minutes (alert above ${cfg.failureRatio.ratioPercent}%).` });
  }
  return out;
}
