// booking-session-token.ts — Constitution 3 §71–73 (Step 10c, Oct 3 2026): the booking session is issued AND SIGNED by us.
// Before this, the verification routes took `bookingSessionId` straight from the request body (or made a fresh one) —
// although the hold code's own contract says it is "never a client-supplied id": a caller could name another booking
// attempt's id and bind their verified phone to it. Now the value the API hands out as `bookingSessionId` is a token:
//   bs.<base64url {sid, t: tenant, c: customer|null, exp}>.<HMAC-SHA256>
// signed with AUTH_SESSION_SECRET under its own purpose label (so it can never be mistaken for a session token), valid
// 2 hours, and bound to the salon and the signed-in customer. Clients just echo it back — no app change needed. A raw or
// forged id is ignored when sending (a new session starts) and treated as expired when checking.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { seal as aesSeal, openWith as aesOpen } from '@aipowersalon/security';

export const BOOKING_SESSION_TTL_SECONDS = 2 * 60 * 60;
let ephemeral: string | null = null;   // no configured secret (tests/dev without one): a per-process key
function key(env: NodeJS.ProcessEnv): string {
  const s = String(env.AUTH_SESSION_SECRET ?? '');
  if (s) return s;
  return (ephemeral ??= randomBytes(32).toString('hex'));
}
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sign = (body: string, env: NodeJS.ProcessEnv) => b64(createHmac('sha256', key(env)).update('booking-session:' + body).digest());
export interface BookingSessionBinding { tenantId: string; customerId: string | null }

export function sealBookingSession(sid: string, bind: BookingSessionBinding, opts: { now?: number; env?: NodeJS.ProcessEnv } = {}): string {
  const env = opts.env ?? process.env;
  const exp = Math.floor((opts.now ?? Date.now()) / 1000) + BOOKING_SESSION_TTL_SECONDS;
  const body = b64(JSON.stringify({ sid, t: bind.tenantId, c: bind.customerId ?? null, exp }));
  // '~' separators (Phase 4, found by the live proof): with '.', `bs.eyJ….<sig>` matched the error envelope's JWT-leak
  // filter, which DROPPED the token from every 428 — the customer app was never handed the session it had to verify.
  return `bs~${body}~${sign(body, env)}`;
}
/** The session id inside a token — only if it is ours, unexpired, and bound to THIS salon and THIS customer. */
export function openBookingSession(token: unknown, bind: BookingSessionBinding, opts: { now?: number; env?: NodeJS.ProcessEnv } = {}): string | null {
  const m = /^bs[~.]([A-Za-z0-9_-]+)[~.]([A-Za-z0-9_-]+)$/.exec(String(token ?? ''));   // '.' = tokens issued before the change (2 h TTL)
  if (!m) return null;
  const want = Buffer.from(sign(m[1], opts.env ?? process.env)), got = Buffer.from(m[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let p: any; try { p = JSON.parse(Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch { return null; }
  if (typeof p?.sid !== 'string' || !p.sid || typeof p.exp !== 'number' || p.exp <= Math.floor((opts.now ?? Date.now()) / 1000)) return null;
  if (p.t !== bind.tenantId || (p.c ?? null) !== (bind.customerId ?? null)) return null;
  return p.sid;
}

// ── the voice callback (BUILD_PLAN Phase 4) ─────────────────────────────────────────────────────────────────────
// The keypad digits are POSTed by the telephony provider (Twilio's <Gather> action), which cannot present the voice
// integration key — so the old route, behind the key guard, could never be reached by the one caller it was for. The
// callback URL now carries its own credential: the salon, branch, booking session AND the number the code went to,
// AES-256-GCM sealed (authenticated, so it cannot be edited; encrypted, so the number is not in a URL or a log line),
// valid for 20 minutes. The number must come from here: the request's `To` is the SALON's line, not the caller's.
export const VOICE_CALLBACK_TTL_SECONDS = 20 * 60;
export interface VoiceCallback { tenantId: string; branchId: string; sid: string; phone: string }
const vkey = (env: NodeJS.ProcessEnv) => createHash('sha256').update('voice-callback:' + key(env)).digest();
export function sealVoiceCallback(v: VoiceCallback, opts: { now?: number; env?: NodeJS.ProcessEnv } = {}): string {
  const exp = Math.floor((opts.now ?? Date.now()) / 1000) + VOICE_CALLBACK_TTL_SECONDS;
  return 'vc.' + aesSeal(vkey(opts.env ?? process.env), JSON.stringify({ t: v.tenantId, b: v.branchId, s: v.sid, p: v.phone, exp }), { layout: 'dotted' });
}
export function openVoiceCallback(token: unknown, opts: { now?: number; env?: NodeJS.ProcessEnv } = {}): VoiceCallback | null {
  const s = String(token ?? '');
  if (!s.startsWith('vc.')) return null;
  try {
    const p = JSON.parse(aesOpen(vkey(opts.env ?? process.env), s.slice(3), { layout: 'dotted' }));
    if (typeof p?.exp !== 'number' || p.exp <= Math.floor((opts.now ?? Date.now()) / 1000)) return null;
    if (![p.t, p.b, p.s, p.p].every((x) => typeof x === 'string' && x)) return null;
    return { tenantId: p.t, branchId: p.b, sid: p.s, phone: p.p };
  } catch { return null; }
}
