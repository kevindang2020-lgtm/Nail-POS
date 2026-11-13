// inbox-core.ts — the PURE rules of the Communications / SMS Inbox (Communications guide Oct 30 2026 + Claude Build Addendum
// §4.1–§4.3). No database, no Nest: every rule here is unit-testable and shared by the repository, the service and the
// inbound webhook so they can never disagree.
//
//   • sorts        newest (default: last activity DESC, id DESC) · unread (unread first, then newest) · oldest_unanswered
//                  (the conversation whose OLDEST unanswered customer message is oldest comes first — a newly active but
//                  answered thread can never bury it) · follow_up_due (earliest follow-up time first). Every sort ends in
//                  the thread id, so paging is stable while new messages arrive.
//   • period       Today · This Week (Mon–Sun) · This Month · This Year · Custom From/To, resolved in the SALON's time zone;
//                  a timestamp is inside when [from 00:00 local, to+1 00:00 local) — the whole end day, DST-safe.
//                  Date basis: last activity (default) · conversation created · last customer message received.
//   • delivery     what the screen may say about an outbound text comes ONLY from the SMS ledger row the send created
//                  (notifications, updated by signed Twilio callbacks): submitted → sent → delivered | failed |
//                  undelivered. A message recorded before this guide, with no ledger row, is "not tracked" — never "sent".
//   • unanswered   the oldest customer message that has not had a qualifying STAFF reply. An AI / automated reply does
//                  not answer it; a staff reply that was refused before reaching the provider does not answer it either.
//   • identity     an inbound number links to a customer only when exactly ONE customer of THIS salon has that number;
//                  several → "ambiguous" (left unlinked, staff choose); none → Unknown Contact. Never by name.
import { businessDate, addDays } from '@aipowersalon/date-time';
import type { InboxPeriod, InboxTimelineEvent, InboxTimelineSource } from '@aipowersalon/api-contracts/tenant';

export const INBOX_SORTS = ['newest', 'unread', 'oldest_unanswered', 'follow_up_due'] as const;
export type InboxSort = typeof INBOX_SORTS[number];
export const INBOX_CHANNELS = ['sms', 'email', 'call'] as const;
export type InboxChannel = typeof INBOX_CHANNELS[number];
export const INBOX_STATUSES = ['open', 'pending', 'replied', 'missed', 'closed'] as const;
export type InboxStatus = typeof INBOX_STATUSES[number];
export const INBOX_DATE_BASES = ['last_activity', 'created', 'received'] as const;
export type InboxDateBasis = typeof INBOX_DATE_BASES[number];
export const INBOX_PRESETS = ['all', 'today', 'week', 'month', 'year', 'custom'] as const;
export type InboxPreset = typeof INBOX_PRESETS[number];
export const INBOX_PAGE_SIZES = [10, 20, 50] as const;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_RANGE_DAYS = 3700;
export const MAX_BODY_CHARS = 1600;            // ten SMS segments; a longer reply is refused, not silently cut
export const TIMELINE_PAGE = 40;
export const TIMELINE_SOURCES = ['message', 'automated', 'review_request', 'call', 'ai_follow_up', 'appointment'] as const satisfies readonly InboxTimelineSource[];
export type TimelineSource = InboxTimelineSource;   // the contract's union; TIMELINE_SOURCES lists the same values

/** A refusal with a registered code (packages/api-contracts ERROR_REGISTRY); the controller maps it to the HTTP answer. */
export class InboxError extends Error {
  constructor(message: string, readonly code: string, readonly status: 400 | 403 | 404 | 409 | 503 = 400, readonly details?: Record<string, unknown>) {
    super(message); this.name = 'InboxError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const pick = <T extends string>(v: unknown, list: readonly T[], dflt: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : dflt);
const pickOrNull = <T extends string>(v: unknown, list: readonly T[]): T | null => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null);

/** E.164 the same way the customer records do (customer-activation normalizePhone): 10 digits → +1…, '+' kept, else null. */
export function normalizePhone(raw: unknown, defaultCountry = '1'): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  if (s.startsWith('+')) return `+${digits}`;
  return digits.length === 10 ? `+${defaultCountry}${digits}` : `+${digits}`;
}
/** The last ten digits — how stored customer phones of either historical shape are compared (phoneDigitsMatch). */
export const last10 = (raw: unknown): string => String(raw ?? '').replace(/\D/g, '').slice(-10);
/** "(•••) •••-1234" — what a list shows of a phone; the full number appears only in the opened conversation. */
export function maskPhone(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.length >= 4 ? `•••-•••-${d.slice(-4)}` : null;
}
export function maskEmail(raw: unknown): string | null {
  const e = String(raw ?? '').trim().toLowerCase();
  const at = e.indexOf('@');
  return at > 0 ? `${e[0]}•••${e.slice(at)}` : null;
}
export const preview = (body: unknown, n = 140): string => { const s = String(body ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
export const likeOf = (s: string): string => `%${s.replace(/[\\%_]/g, (c) => '\\' + c)}%`;

/** What a search box text can mean: an id, a phone (≥ 4 digits and nothing but digits / phone punctuation), an email, text. */
export interface SearchTerm { text: string; uuid: string | null; digits: string | null; email: string | null; ref: string | null }
export function parseSearch(raw: unknown): SearchTerm | null {
  const text = typeof raw === 'string' ? raw.trim().slice(0, 100) : '';
  if (!text) return null;
  const uuid = isUuid(text) ? text.toLowerCase() : null;
  const onlyPhoneChars = /^[\d\s()+.-]+$/.test(text);
  const d = text.replace(/\D/g, '');
  const digits = onlyPhoneChars && d.length >= 4 ? d.slice(-10) : null;
  const email = text.includes('@') ? text.toLowerCase() : null;
  // a ticket / appointment reference typed with its prefix ("T-1042", "#1042") — matched against the salon's own records
  const ref = /^[#a-z]{0,3}-?\d{2,12}$/i.test(text) && !onlyPhoneChars ? text.replace(/^[#a-z]{0,3}-?/i, '') : (onlyPhoneChars && d.length >= 2 && d.length < 7 ? d : null);
  return { text, uuid, digits, email, ref };
}

export interface InboxQuery {
  sort: InboxSort; channel: InboxChannel | null; status: InboxStatus | null; assignee: 'me' | 'unassigned' | string | null;
  unreadOnly: boolean; awaitingOnly: boolean; branch: string | null; search: SearchTerm | null;
  /** C2 gap (Nov 5 2026): the campaign a conversation came from — 'rsms:<id>' (win-back SMS) or 'cc:<id>' (Campaign Center) */
  campaign: { kind: 'rsms' | 'cc'; id: string } | null;
  basis: InboxDateBasis; preset: InboxPreset; from: string | null; to: string | null; page: number; pageSize: number;
}
/** Query string → a validated query. Unknown enum values fall back to the default (the @ListQuery interceptor already
 *  refused undeclared parameters); a bad custom date range is an explicit 400. */
export function parseInboxQuery(q: Record<string, unknown> | null | undefined): InboxQuery {
  const f = q ?? {};
  const sizeRaw = Number(f.pageSize);
  const pageSize = (INBOX_PAGE_SIZES as readonly number[]).includes(sizeRaw) ? sizeRaw : DEFAULT_PAGE_SIZE;
  const page = Math.max(1, Math.min(100_000, Math.floor(Number(f.page) || 1)));
  const a = typeof f.assignee === 'string' ? f.assignee.trim() : '';
  const assignee = a === 'me' || a === 'unassigned' ? a : isUuid(a) ? a : null;
  const branch = typeof f.branch === 'string' && f.branch.trim() && f.branch !== 'all' ? f.branch.trim() : null;
  const preset = pick(f.preset, INBOX_PRESETS, (f.from || f.to) ? 'custom' : 'all');
  const cm = typeof f.campaign === 'string' ? /^(rsms|cc):([0-9a-f-]{36})$/i.exec(f.campaign.trim()) : null;
  const campaign = cm && isUuid(cm[2]) ? { kind: cm[1].toLowerCase() as 'rsms' | 'cc', id: cm[2] } : null;
  return {
    campaign,
    sort: pick(f.sort, INBOX_SORTS, 'newest'), channel: pickOrNull(f.channel, INBOX_CHANNELS), status: pickOrNull(f.status, INBOX_STATUSES),
    assignee, unreadOnly: f.unreadOnly === true || f.unreadOnly === 'true', awaitingOnly: f.awaitingOnly === true || f.awaitingOnly === 'true',
    branch, search: parseSearch(f.q ?? f.search), basis: pick(f.basis, INBOX_DATE_BASES, 'last_activity'), preset,
    from: typeof f.from === 'string' ? f.from.trim() : null, to: typeof f.to === 'string' ? f.to.trim() : null, page, pageSize,
  };
}

export function isValidYmd(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
  if (y < 1900 || y > 2200) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const dayNo = (s: string) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86_400_000);

/** Presets resolved on the SERVER in the salon's zone (same contract as the Payments & Money pages' PeriodBar). */
export function resolveInboxPeriod(q: { preset: InboxPreset; from: string | null; to: string | null }, tz: string, now: Date = new Date()): InboxPeriod {
  const today = businessDate(tz, now);
  const y = today.slice(0, 4), m = today.slice(5, 7);
  switch (q.preset) {
    case 'all': return { preset: 'all', from: null, to: null, tz, today };
    case 'today': return { preset: 'today', from: today, to: today, tz, today };
    case 'week': { const dow = new Date(Date.UTC(+y, +m - 1, +today.slice(8, 10))).getUTCDay(); const from = addDays(today, -((dow + 6) % 7)); return { preset: 'week', from, to: addDays(from, 6), tz, today }; }
    case 'month': { const last = new Date(Date.UTC(+y, +m, 0)).getUTCDate(); return { preset: 'month', from: `${y}-${m}-01`, to: `${y}-${m}-${String(last).padStart(2, '0')}`, tz, today }; }
    case 'year': return { preset: 'year', from: `${y}-01-01`, to: `${y}-12-31`, tz, today };
    default: {
      if (!isValidYmd(q.from) || !isValidYmd(q.to)) throw new InboxError('Enter a valid date.', 'DATE_INVALID', 400, { field: !isValidYmd(q.from) ? 'from' : 'to' });
      if (q.to < q.from) throw new InboxError('The start date must be on or before the end date.', 'DATE_RANGE_INVALID', 400);
      if (dayNo(q.to) - dayNo(q.from) > MAX_RANGE_DAYS) throw new InboxError('That date range is too long. Choose a shorter range.', 'DATE_RANGE_TOO_LARGE', 400);
      return { preset: 'custom', from: q.from, to: q.to, tz, today };
    }
  }
}

// ── delivery state (outbound) — evidence only ─────────────────────────────────────────────────────────────────────
export type DeliveryState = 'received' | 'sending' | 'submitted' | 'sent' | 'delivered' | 'failed' | 'undelivered' | 'blocked' | 'simulated' | 'not_tracked';
export interface DeliveryFacts {
  direction: string; messageStatus: string; notificationId: string | null;
  ledgerStatus: string | null; providerStatus: string | null; failureReason: string | null; providerErrorCode: string | null;
}
export function deliveryState(f: DeliveryFacts): DeliveryState {
  if (f.direction === 'inbound') return 'received';
  if (f.messageStatus === 'pending') return 'sending';
  if (!f.notificationId) {
    if (f.messageStatus === 'blocked') return 'blocked';
    if (f.messageStatus === 'failed') return 'failed';
    return 'not_tracked';   // recorded before replies were sent through the provider — never shown as sent
  }
  const ls = String(f.ledgerStatus ?? ''), ps = String(f.providerStatus ?? '').toLowerCase();
  if (ls === 'simulated') return 'simulated';
  if (ls === 'blocked') return 'blocked';
  if (ls === 'delivered' || ps === 'delivered') return 'delivered';
  if (ls === 'failed') return ps === 'undelivered' || String(f.failureReason ?? '') === 'provider_undelivered' ? 'undelivered' : 'failed';
  if (ps === 'sent') return 'sent';
  return 'submitted';   // the provider accepted the hand-off; nothing more is known until its callback
}
/** A staff reply only answers the customer when it actually left for the provider (not refused / failed on hand-off). */
export const answersCustomer = (s: DeliveryState): boolean => s === 'submitted' || s === 'sent' || s === 'delivered' || s === 'simulated' || s === 'sending';

/** A reason code the ledger stored → a stable code the screen translates (never raw provider text). */
export function blockReasonCode(reason: string | null | undefined): string | null {
  const r = String(reason ?? '');
  if (!r) return null;
  if (r === 'opted_out') return 'OPTED_OUT';
  if (r === 'over_limit') return 'NO_CREDITS';
  if (r === 'not_configured') return 'SENDER_NOT_CONFIGURED';
  if (r.startsWith('provider_')) return 'PROVIDER_' + r.slice(9).toUpperCase();
  return 'SEND_FAILED';
}

// ── timeline ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Stable chronological order: time, then a fixed source rank, then id — the same events always land in the same order. */
const RANK: Record<TimelineSource, number> = { appointment: 0, call: 1, ai_follow_up: 2, message: 3, automated: 4, review_request: 5 };
export function compareEvents(a: InboxTimelineEvent, b: InboxTimelineEvent): number {
  const ta = Date.parse(a.at), tb = Date.parse(b.at);
  if (ta !== tb) return ta - tb;
  if (RANK[a.source] !== RANK[b.source]) return RANK[a.source] - RANK[b.source];
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
/** Merge already-fetched sources (each newest-first, at most `limit` before the cursor), drop exact duplicates by
 *  source+id, keep the newest `limit`, and return them oldest → newest with the cursor for the next older page. */
export function mergeTimeline(lists: InboxTimelineEvent[][], limit = TIMELINE_PAGE): { events: InboxTimelineEvent[]; olderCursor: string | null } {
  const seen = new Set<string>(); const all: InboxTimelineEvent[] = [];
  for (const l of lists) for (const e of l) { const k = e.source + ':' + e.id; if (!seen.has(k)) { seen.add(k); all.push(e); } }
  all.sort(compareEvents);
  const hasOlder = all.length > limit;
  const events = all.slice(Math.max(0, all.length - limit));
  return { events, olderCursor: hasOlder && events.length ? encodeCursor(events[0]) : null };
}
/** an opaque "older than this" cursor: base64url of `at|id|source` (no JSON, so decoding never throws) */
export function encodeCursor(e: { at: string; id: string; source: string }): string {
  return Buffer.from(`${e.at}|${e.id}|${e.source}`, 'utf8').toString('base64url');
}
export function decodeCursor(c: unknown): { at: string; id: string; s: string } | null {
  if (typeof c !== 'string' || !c || c.length > 300 || !/^[A-Za-z0-9_-]+$/.test(c)) return null;
  const [at, id, s, extra] = Buffer.from(c, 'base64url').toString('utf8').split('|');
  if (extra !== undefined || !at || !id || !s || Number.isNaN(Date.parse(at)) || !/^[0-9A-Za-z-]{1,64}$/.test(id)) return null;
  return { at, id, s };
}
/** The automated text kinds the SMS ledger records (notifications.purpose) → the timeline label. Account codes never
 *  show their body (they are one-time passcodes). */
export function automatedType(purpose: string | null | undefined): { type: string; showBody: boolean } {
  switch (purpose) {
    case 'reminder': return { type: 'appointment_reminder', showBody: true };
    case 'followup': return { type: 'follow_up', showBody: true };
    case 'receipt': return { type: 'receipt', showBody: false };
    case 'marketing': return { type: 'campaign', showBody: true };
    case 'account': return { type: 'verification_code', showBody: false };
    case 'conversation': return { type: 'staff_reply', showBody: true };
    default: return { type: 'automated_message', showBody: true };
  }
}

/** KPI definitions — what each tile counts, returned with the numbers so the screen never mixes scopes silently. */
export const KPI_DEFINITIONS = {
  openConversations: 'conversations whose status is Open or Waiting on customer (Replied, Missed and Closed are counted apart)',
  unread: 'conversations with at least one unread customer message',
  replied: 'conversations whose status is Replied',
  missed: 'conversations whose status is Missed (missed calls)',
  sms: 'conversations on the SMS channel',
  email: 'conversations on the email channel',
  totalConversations: 'all conversations (each counted once, whatever its channel)',
  awaitingReply: 'conversations whose latest customer message has no staff reply yet',
  freshness: 'the newest record behind each tile (conversations, messages, calls, delivery callbacks) — the source time, not the time this page was built; a tile whose source could not be read or never reported is Unknown, and one still waiting on provider confirmation is Partial',
  callbackHealth: 'staff texts handed to the provider more than 30 minutes ago (last 7 days) with no delivery callback yet; "stale" when no callback at all has arrived since the oldest of them — the webhook may be missing. These are awaiting confirmation, never counted as failed.',
} as const;

/** Missing-webhook warning (Extras · SMS Inbox 12): from TIMESTAMPS only — the outbound texts still waiting for a provider
 *  status callback and the newest callback the salon has received. Nothing here marks a text failed:
 *    ok       nothing has waited longer than the threshold
 *    delayed  some texts wait, but callbacks are still arriving (the newest is after the oldest waiting text)
 *    stale    texts wait and no callback has arrived since the oldest of them (or ever) — check the status-callback webhook */
export const CALLBACK_WAIT_MINUTES = 30;
export const CALLBACK_LOOKBACK_DAYS = 7;
export type CallbackHealthState = 'ok' | 'delayed' | 'stale';
export function callbackHealth(i: { awaiting: number; oldestAwaitingAt: string | null; lastCallbackAt: string | null }): { state: CallbackHealthState; awaiting: number; oldestAwaitingAt: string | null; lastCallbackAt: string | null; waitMinutes: number; lookbackDays: number } {
  const base = { awaiting: Math.max(0, i.awaiting | 0), oldestAwaitingAt: i.oldestAwaitingAt, lastCallbackAt: i.lastCallbackAt, waitMinutes: CALLBACK_WAIT_MINUTES, lookbackDays: CALLBACK_LOOKBACK_DAYS };
  if (base.awaiting === 0 || !i.oldestAwaitingAt) return { ...base, state: 'ok' };
  const last = i.lastCallbackAt ? Date.parse(i.lastCallbackAt) : NaN;
  return { ...base, state: Number.isFinite(last) && last > Date.parse(i.oldestAwaitingAt) ? 'delayed' : 'stale' };
}

/** Performance freshness (Extras · SMS Inbox 14): which tiles are UNKNOWN (their source could not be read or has never
 *  reported) or PARTIAL (some of what they count is still unconfirmed). Codes only — the screen words them. Never a guess:
 *    missed     unknown  the call ledger could not be read, or this scope has no call record at all (calls not connected)
 *    sentToday  partial  some of today's sends were simulated (no provider) — they are not real texts
 *    delivered  partial  texts are still waiting for a provider status callback — "delivered" can only grow */
export type MetricWarning = { metric: 'missed' | 'sentToday' | 'delivered'; kind: 'unknown' | 'partial'; reason: 'call_ledger_unreadable' | 'no_call_records' | 'simulated_sends' | 'awaiting_callbacks' | 'callbacks_stale'; count: number | null };
export function metricWarnings(i: { missedReadable: boolean; callsAt: string | null; simulatedToday: number; callbackState: CallbackHealthState; awaitingCallbacks: number }): MetricWarning[] {
  const w: MetricWarning[] = [];
  if (!i.missedReadable) w.push({ metric: 'missed', kind: 'unknown', reason: 'call_ledger_unreadable', count: null });
  else if (!i.callsAt) w.push({ metric: 'missed', kind: 'unknown', reason: 'no_call_records', count: null });
  if (i.simulatedToday > 0) w.push({ metric: 'sentToday', kind: 'partial', reason: 'simulated_sends', count: i.simulatedToday });
  if (i.callbackState !== 'ok') w.push({ metric: 'delivered', kind: 'partial', reason: i.callbackState === 'stale' ? 'callbacks_stale' : 'awaiting_callbacks', count: i.awaitingCallbacks });
  return w;
}
