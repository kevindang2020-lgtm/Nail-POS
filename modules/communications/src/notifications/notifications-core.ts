// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { NotificationChannel } from '@aipowersalon/api-contracts/tenant';
import type { NotificationChannel } from '@aipowersalon/api-contracts/tenant';
// notifications-core.ts — framework-free validation + channel→credit-metric mapping for the tenant-facing
// notification send path (appointment reminders, confirmations, manual messages to customers).


export interface SendNotificationInput {
  channel: NotificationChannel;
  to: string;
  subject?: string;
  body: string;
}

export interface ValidationResult { ok: boolean; error?: string }

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const E164_RE = /^\+[1-9]\d{6,15}$/;
const SMS_MAX = 1600;
const EMAIL_MAX = 10000;
const SUBJECT_MAX = 200;

export function creditMetricForChannel(channel: NotificationChannel): 'sms_credits' | 'email_credits' {
  return channel === 'sms' ? 'sms_credits' : 'email_credits';
}

export function validateSendRequest(req: Partial<SendNotificationInput> | null | undefined): ValidationResult {
  if (!req) return { ok: false, error: 'Request is required' };
  if (req.channel !== 'sms' && req.channel !== 'email') return { ok: false, error: "Channel must be 'sms' or 'email'" };
  const to = (req.to || '').trim();
  if (!to) return { ok: false, error: 'A recipient is required' };
  if (req.channel === 'sms' && !E164_RE.test(to)) return { ok: false, error: 'SMS recipient must be E.164 format (e.g. +15551234567)' };
  if (req.channel === 'email' && !EMAIL_RE.test(to)) return { ok: false, error: 'Email recipient is not a valid email address' };
  const body = (req.body || '').trim();
  if (!body) return { ok: false, error: 'Message body is required' };
  const max = req.channel === 'sms' ? SMS_MAX : EMAIL_MAX;
  if (body.length > max) return { ok: false, error: `Message body exceeds the ${max}-character limit` };
  if (req.subject && req.subject.length > SUBJECT_MAX) return { ok: false, error: `Subject exceeds the ${SUBJECT_MAX}-character limit` };
  return { ok: true };
}

// Default subject for email when the caller doesn't supply one.
export function resolveSubject(req: SendNotificationInput, salonName?: string): string {
  if (req.subject && req.subject.trim()) return req.subject.trim();
  return salonName ? `A message from ${salonName}` : 'A message from your salon';
}

export function normalizeAddress(channel: NotificationChannel, address: string): string {
  const a = (address || '').trim();
  if (channel === 'email') return a.toLowerCase();
  if (channel === 'sms') {
    if (!a) return '';
    if (a.startsWith('+')) {
      return '+' + a.slice(1).replace(/\D+/g, '');
    }
    const digits = a.replace(/\D+/g, '');
    if (!digits) return '';
    const defaultCountry = process.env.DEFAULT_PHONE_COUNTRY || '1';
    if (digits.length === 10) {
      return `+${defaultCountry}${digits}`;
    }
    return `+${digits}`;
  }
  return a;
}

// Inbound keyword classification (for a future Twilio inbound-SMS webhook). Carrier-standard keywords.
export type InboundKeyword = 'stop' | 'start' | 'help' | null;
const STOP_WORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']);
const START_WORDS = new Set(['start', 'unstop', 'yes', 'subscribe']);
const HELP_WORDS = new Set(['help', 'info']);
export function parseInboundKeyword(body: string | null | undefined): InboundKeyword {
  const w = (body || '').trim().toLowerCase().split(/\s+/)[0] || '';
  if (STOP_WORDS.has(w)) return 'stop';
  if (START_WORDS.has(w)) return 'start';
  if (HELP_WORDS.has(w)) return 'help';
  return null;
}
