// twilio-inbound-core.ts — pure, dependency-free helpers for handling inbound Twilio SMS. Kept separate from the
// service so the security-critical bits (signature verification, opt-out keyword parsing) are unit-testable in
// isolation. No network, no DB.
import { createHmac, timingSafeEqual } from 'crypto';

// Twilio signs each request: HMAC-SHA1 over the full request URL followed by each POST param appended as key+value in
// alphabetical key order, base64-encoded, compared to the X-Twilio-Signature header. See Twilio Security docs.
export function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const sorted = Object.keys(params).sort();
  let data = url;
  for (const k of sorted) data += k + params[k];
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
}

export function verifyTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string | undefined | null): boolean {
  if (!authToken || !signature) return false;
  const expected = computeTwilioSignature(authToken, url, params);
  const a = Buffer.from(expected, 'utf-8');
  const b = Buffer.from(signature, 'utf-8');
  if (a.length !== b.length) return false;          // timingSafeEqual requires equal lengths
  return timingSafeEqual(a, b);
}

// Standard carrier/Twilio opt-out & opt-in keywords (case-insensitive, whole message). HELP is informational, not an
// opt-out. Anything else is a normal inbound reply.
const STOP_WORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'stopall']);
const START_WORDS = new Set(['start', 'yes', 'unstop']);
const HELP_WORDS = new Set(['help', 'info']);
export type InboundKeyword = 'stop' | 'start' | 'help' | null;
export function classifyInboundKeyword(body: string | undefined | null): InboundKeyword {
  const w = (body || '').trim().toLowerCase();
  if (!w) return null;
  if (STOP_WORDS.has(w)) return 'stop';
  if (START_WORDS.has(w)) return 'start';
  if (HELP_WORDS.has(w)) return 'help';
  return null;
}
