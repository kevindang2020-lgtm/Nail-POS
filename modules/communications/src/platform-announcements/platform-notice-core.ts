// platform-notice-core.ts — the PURE rules of Platform Announcements on the POS top bar (Super Admin POS Top-Bar
// Announcement & Platform Broadcast mandate, Oct 22 2026). No database, no clock: the service passes the server's time.
//
//   lifecycle (stored)  draft → published ⇄ paused → archived      (§14–§20)
//   status (derived)    published + starts later = SCHEDULED, inside the window = ACTIVE, window over = EXPIRED
//   message             plain text only — line endings normalized, control characters removed, markup REJECTED (§49, §89)
//   order               CRITICAL > HIGH > NORMAL > LOW, then the most recently published, then id (§43: deterministic)
//   Vietnamese (WP-F)   optional title_vi / message_vi, cleaned by the same rules; a CRITICAL notice needs a REVIEWED
//                       Vietnamese version or an explicit English-only decision before it can go live (§56–§57)
import { defineStateMachine } from '@aipowersalon/database';

/** platform_notices.lifecycle_status — archive is terminal (history is never deleted, §20 / §131). */
export const PLATFORM_NOTICE = defineStateMachine({
  name: 'platform_notice', table: 'platform_notices', column: 'lifecycle_status',
  states: ['draft', 'published', 'paused', 'archived'],
  transitions: { draft: ['published', 'archived'], published: ['paused', 'archived'], paused: ['published', 'archived'] },
  initial: ['draft'],
});

export const NOTICE_TYPES = ['info', 'update', 'maintenance', 'warning', 'urgent'] as const;
export const NOTICE_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export const NOTICE_AUDIENCES = ['all_tenants', 'selected_tenants', 'selected_branches'] as const;
export type NoticeType = typeof NOTICE_TYPES[number];
export type NoticePriority = typeof NOTICE_PRIORITIES[number];
export type NoticeAudience = typeof NOTICE_AUDIENCES[number];
export type NoticeStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'expired' | 'archived';
export const MESSAGE_MAX = 2000;
export const TITLE_MAX = 120;

// ── sanitization (§49, §89, §94) ────────────────────────────────────────────────────────────────────────────────────
/** Markup is refused, not stripped: an operator who typed a tag should see that it will not work, rather than have the
 *  message silently change. The POS renders escaped text regardless (React text nodes — never innerHTML, §90). */
const MARKUP = /<\s*\/?\s*[a-z!?][^>]*>|<\s*(script|iframe|style|img|svg|object|embed|link|meta)\b|javascript\s*:|data\s*:\s*text\/html/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;

export type Clean<T> = { ok: true; value: T } | { ok: false; reason: string };
export function cleanMessage(raw: unknown): Clean<string> {
  if (typeof raw !== 'string') return { ok: false, reason: 'Write the announcement message.' };
  let s = raw.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(CONTROL, '');
  s = s.split('\n').map((l) => l.replace(/\s+$/u, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!s) return { ok: false, reason: 'Write the announcement message.' };
  if (s.length > MESSAGE_MAX) return { ok: false, reason: `Keep the message to ${MESSAGE_MAX.toLocaleString('en-US')} characters.` };
  if (MARKUP.test(s)) return { ok: false, reason: 'Use plain text — HTML, scripts and links are not allowed.' };
  return { ok: true, value: s };
}
export function cleanTitle(raw: unknown): Clean<string | null> {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, reason: 'The title must be text.' };
  const s = raw.replace(/[\r\n\t]+/g, ' ').replace(CONTROL, '').replace(/\s{2,}/g, ' ').trim();
  if (!s) return { ok: true, value: null };
  if (s.length > TITLE_MAX) return { ok: false, reason: `Keep the title to ${TITLE_MAX} characters.` };
  if (MARKUP.test(s)) return { ok: false, reason: 'Use plain text — HTML is not allowed.' };
  return { ok: true, value: s };
}

// ── status, schedule and order ───────────────────────────────────────────────────────────────────────────────────────
const ms = (v: string | Date | null | undefined) => (v == null ? null : new Date(v).getTime());
export function derivedStatus(n: { lifecycle: string; startsAt: string | Date | null; endsAt: string | Date | null }, nowMs: number): NoticeStatus {
  if (n.lifecycle === 'draft' || n.lifecycle === 'paused' || n.lifecycle === 'archived') return n.lifecycle;
  const s = ms(n.startsAt), e = ms(n.endsAt);
  if (e != null && e <= nowMs) return 'expired';
  if (s != null && s > nowMs) return 'scheduled';
  return 'active';
}
/** §56–§59, §93: an end after the start; a publish must still have time to show; maintenance must say when it ends. */
export function windowProblem(x: { startsAt: number | null; endsAt: number | null; type: string }, nowMs: number, publishing: boolean): string | null {
  if (x.startsAt != null && x.endsAt != null && x.endsAt <= x.startsAt) return 'The end must be after the start.';
  if (publishing && x.endsAt != null && x.endsAt <= nowMs) return 'The end time has already passed.';
  if (publishing && x.type === 'maintenance' && x.endsAt == null) return 'A maintenance notice needs an end time, so it never stays up after the work is done.';
  return null;
}
export const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
/** The POS shows the highest first; ties: the most recently published, then the id (stable on every client). */
export function compareForDisplay(a: { priority: string; publishedAt: string | Date | null; id: string }, b: { priority: string; publishedAt: string | Date | null; id: string }): number {
  const p = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
  if (p) return p;
  const t = (ms(b.publishedAt) ?? 0) - (ms(a.publishedAt) ?? 0);
  if (t) return t;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
/** §120–§121: every salon at once, or a high / critical notice, needs an explicit confirmation. */
export function needsConfirmation(x: { audience: string; priority: string }): boolean {
  return x.audience === 'all_tenants' || x.priority === 'high' || x.priority === 'critical';
}
/** §133: a material change (what the salon reads) bumps the content version — a dismissed notice comes back. The
 *  Vietnamese text is what a Vietnamese POS reads, so changing it is material too (WP-F; absent = unchanged). */
type Material = { title: string | null; message: string; type: string; priority: string; titleVi?: string | null; messageVi?: string | null };
export function isMaterialChange(a: Material, b: Material): boolean {
  return a.title !== b.title || a.message !== b.message || a.type !== b.type || a.priority !== b.priority
    || (a.titleVi ?? null) !== (b.titleVi ?? null) || (a.messageVi ?? null) !== (b.messageVi ?? null);
}

// ── Vietnamese version (English + Vietnamese POS mandate WP-F, §56–§57) ─────────────────────────────────────────────────
/** The optional Vietnamese title / message: the same plain-text rules as the English (no markup, same limits). An empty
 *  value means "no Vietnamese version". A Vietnamese title alone is refused — the POS would show a Vietnamese heading over
 *  an English message. */
export function cleanVietnamese(rawTitle: unknown, rawMessage: unknown): Clean<{ titleVi: string | null; messageVi: string | null }> {
  const t = cleanTitle(rawTitle);
  if (!t.ok) return { ok: false, reason: 'Vietnamese title: ' + t.reason };
  let messageVi: string | null = null;
  if (rawMessage != null && !(typeof rawMessage === 'string' && !rawMessage.trim())) {
    const m = cleanMessage(rawMessage);
    if (!m.ok) return { ok: false, reason: 'Vietnamese message: ' + m.reason };
    messageVi = m.value;
  }
  if (t.value && !messageVi) return { ok: false, reason: 'Add the Vietnamese message too, or remove the Vietnamese title.' };
  return { ok: true, value: { titleVi: t.value, messageVi } };
}
/** Critical = a notice whose meaning must not be lost in translation: maintenance, warning, urgent, or critical priority. */
export function isCriticalNotice(x: { type: string; priority: string }): boolean {
  return x.type === 'maintenance' || x.type === 'warning' || x.type === 'urgent' || x.priority === 'critical';
}
/** Why a notice cannot go live yet in its Vietnamese state, or null. No machine translation exists: a critical notice
 *  either carries a Vietnamese version a person has REVIEWED, or is explicitly English only. Never both. */
export function viProblem(x: { type: string; priority: string; messageVi: string | null; viReviewed: boolean; englishOnly: boolean }): string | null {
  if (x.englishOnly && x.messageVi) return 'English only cannot carry a Vietnamese version — remove the Vietnamese text or untick English only.';
  if (!isCriticalNotice(x) || x.englishOnly) return null;
  if (!x.messageVi) return 'A maintenance, warning, urgent or critical announcement needs a reviewed Vietnamese version — or mark it English only.';
  if (!x.viReviewed) return 'Review the Vietnamese version (tick "Vietnamese reviewed") before this critical announcement goes live — or mark it English only.';
  return null;
}
