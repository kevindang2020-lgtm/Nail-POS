// commsInboxCore.ts — Communications / SMS Inbox (guide Oct 30 2026): the screen's PURE rules, kept apart so they are unit-tested.
//   • URL state holds only NON-sensitive filters (sort, channel, status, assignee, period, basis, page, size, open thread id).
//     The search text is never put in the address (it is often a phone number) — guide §6 / Addendum "Booking prefill".
//   • A filter change resets to page 1; the open conversation and its unsent draft are untouched by any refresh.
//   • delivery wording comes only from the server's evidence-based state (submitted ≠ delivered).
import { estimateSmsSegments } from '@aipowersalon/api-contracts';

export const SORTS = ['newest', 'unread', 'oldest_unanswered', 'follow_up_due'] as const;
export const CHANNELS = ['sms', 'email', 'call'] as const;
export const STATUSES = ['open', 'pending', 'replied', 'missed', 'closed'] as const;
export const PRESETS = ['all', 'today', 'week', 'month', 'year', 'custom'] as const;
export const BASES = ['last_activity', 'created', 'received'] as const;
export const SIZES = [10, 20, 50] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export interface InboxUrlState {
  sort: typeof SORTS[number]; channel: string; status: string; assignee: string; preset: typeof PRESETS[number];
  from: string; to: string; basis: typeof BASES[number]; page: number; size: number; thread: string | null; awaiting: boolean;
  /** C2 audit (Nov 4 2026): a location filter ('' = every location the user may see) */
  branch: string;
}
export const DEFAULT_STATE: InboxUrlState = { sort: 'newest', channel: '', status: '', assignee: '', preset: 'all', from: '', to: '', basis: 'last_activity', page: 1, size: 20, thread: null, awaiting: false, branch: '' };
const oneOf = <T extends string>(v: string | null, list: readonly T[], d: T): T => (v && (list as readonly string[]).includes(v) ? (v as T) : d);

export function readUrlState(sp: URLSearchParams): InboxUrlState {
  const size = Number(sp.get('size'));
  const a = sp.get('assignee') ?? '';
  const preset = oneOf(sp.get('preset'), PRESETS, 'all');
  const from = sp.get('from') ?? '', to = sp.get('to') ?? '';
  const customOk = preset !== 'custom' || (YMD.test(from) && YMD.test(to) && from <= to);
  return {
    sort: oneOf(sp.get('sort'), SORTS, 'newest'), channel: (CHANNELS as readonly string[]).includes(sp.get('channel') ?? '') ? String(sp.get('channel')) : '',
    status: (STATUSES as readonly string[]).includes(sp.get('status') ?? '') ? String(sp.get('status')) : '',
    assignee: a === 'me' || a === 'unassigned' || UUID.test(a) ? a : '', preset: customOk ? preset : 'all', from: customOk && preset === 'custom' ? from : '', to: customOk && preset === 'custom' ? to : '',
    basis: oneOf(sp.get('basis'), BASES, 'last_activity'), page: Math.max(1, Math.min(10_000, Math.floor(Number(sp.get('page')) || 1))),
    size: (SIZES as readonly number[]).includes(size) ? size : 20, thread: UUID.test(sp.get('thread') ?? '') ? sp.get('thread') : null, awaiting: sp.get('awaiting') === '1',
    branch: UUID.test(sp.get('branch') ?? '') ? String(sp.get('branch')) : '',
  };
}
export function writeUrlState(s: InboxUrlState): URLSearchParams {
  const out = new URLSearchParams();
  if (s.sort !== 'newest') out.set('sort', s.sort);
  if (s.channel) out.set('channel', s.channel);
  if (s.status) out.set('status', s.status);
  if (s.assignee) out.set('assignee', s.assignee);
  if (s.awaiting) out.set('awaiting', '1');
  if (s.preset !== 'all') out.set('preset', s.preset);
  if (s.preset === 'custom') { out.set('from', s.from); out.set('to', s.to); }
  if (s.basis !== 'last_activity') out.set('basis', s.basis);
  if (s.page > 1) out.set('page', String(s.page));
  if (s.size !== 20) out.set('size', String(s.size));
  if (s.thread) out.set('thread', s.thread);
  if (s.branch) out.set('branch', s.branch);
  return out;
}
/** any filter change → page 1 (the open thread stays) */
export function withFilter(s: InboxUrlState, patch: Partial<InboxUrlState>): InboxUrlState {
  const filterKeys: (keyof InboxUrlState)[] = ['sort', 'channel', 'status', 'assignee', 'preset', 'from', 'to', 'basis', 'size', 'awaiting', 'branch'];
  const changed = filterKeys.some((k) => k in patch && patch[k] !== s[k]);
  return { ...s, ...patch, page: changed ? 1 : (patch.page ?? s.page) };
}
/** the list query the server receives (search text added by the caller, never from the URL) */
export function listQuery(s: InboxUrlState, q: string): Record<string, string> {
  const o: Record<string, string> = { sort: s.sort, page: String(s.page), pageSize: String(s.size), preset: s.preset, basis: s.basis };
  if (s.channel) o.channel = s.channel;
  if (s.status) o.status = s.status;
  if (s.assignee) o.assignee = s.assignee;
  if (s.awaiting) o.awaitingOnly = 'true';
  if (s.branch) o.branch = s.branch;
  if (s.preset === 'custom') { o.from = s.from; o.to = s.to; }
  const t = q.trim(); if (t) o.q = t.slice(0, 100);
  return o;
}

/** "3 h 20 m", "2 d 4 h", "12 m" — how long a customer has waited (whole minutes; never negative) */
export function waitedFor(iso: string | null | undefined, now: number = Date.now()): { d: number; h: number; m: number; minutes: number } | null {
  if (!iso) return null;
  const t = Date.parse(iso); if (Number.isNaN(t)) return null;
  const minutes = Math.max(0, Math.floor((now - t) / 60000));
  return { d: Math.floor(minutes / 1440), h: Math.floor((minutes % 1440) / 60), m: minutes % 60, minutes };
}
/** urgency of a waiting conversation: ≥ 24 h urgent, ≥ 1 h attention, else fresh — from real timestamps only */
export const waitTone = (minutes: number | null): 'urgent' | 'attention' | 'fresh' | null => (minutes == null ? null : minutes >= 1440 ? 'urgent' : minutes >= 60 ? 'attention' : 'fresh');

export const deliveryTone = (d: string): 'ok' | 'warn' | 'bad' | 'muted' => (d === 'delivered' ? 'ok' : d === 'failed' || d === 'undelivered' || d === 'blocked' ? 'bad' : d === 'sending' || d === 'submitted' || d === 'sent' ? 'warn' : 'muted');

export function segmentsOf(text: string): { segments: number; encoding: string; chars: number } {
  if (!text) return { segments: 0, encoding: 'GSM-7', chars: 0 };
  const e = estimateSmsSegments(text);
  return { segments: e.segments, encoding: e.encoding, chars: text.length };
}

/** drafts per conversation, kept in memory for the session: switching threads, filtering, refreshing or a live event never
 *  clears an unsent reply; only a successful Send (or the user) does. */
export class DraftBook {
  private m = new Map<string, string>();
  get(id: string | null): string { return id ? this.m.get(id) ?? '' : ''; }
  set(id: string | null, v: string): void { if (!id) return; if (v) this.m.set(id, v); else this.m.delete(id); }
  has(id: string | null): boolean { return !!id && !!this.m.get(id); }
}
/** is the reader at (or within 48 px of) the newest message? — auto-scroll only then */
export const atBottom = (el: { scrollTop: number; scrollHeight: number; clientHeight: number } | null): boolean => !el || el.scrollHeight - el.scrollTop - el.clientHeight < 48;
