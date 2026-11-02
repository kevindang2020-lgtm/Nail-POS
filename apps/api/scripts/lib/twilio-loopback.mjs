// twilio-loopback.mjs — a PROOF-ONLY preload (node --import) that answers api.twilio.com in-process, so a live proof can
// show WHICH salon's Twilio account and From number carried each text without reaching Twilio (mandate §65, Oct 22 2026).
// It is inert unless TWILIO_LOOPBACK_LOG names a file; every Twilio request is appended there as one JSON line
// { method, accountSid, from, messagingServiceSid, to, sid } — the Basic-auth secret is never written. Any other host goes
// to the real fetch untouched. Never load it in production (only live-pilot-day.mjs passes it, through NODE_OPTIONS).
import { appendFileSync } from 'node:fs';

const LOG = process.env.TWILIO_LOOPBACK_LOG;
if (LOG) {
  const real = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname !== 'api.twilio.com') return real(input, init);
    const method = String(init.method || 'GET').toUpperCase();
    const accountSid = /\/Accounts\/([^/.]+)/.exec(url.pathname)?.[1] ?? null;
    const form = new URLSearchParams(typeof init.body === 'string' ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : '');
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (method === 'POST' && /\/Messages\.json$/.test(url.pathname)) {
      const sid = `SM${String(accountSid).slice(-6)}${String(++n).padStart(4, '0')}`;
      appendFileSync(LOG, JSON.stringify({ method, accountSid, from: form.get('From'), messagingServiceSid: form.get('MessagingServiceSid'), to: form.get('To'), sid }) + '\n');
      return json({ sid, status: 'queued', num_segments: '1', account_sid: accountSid, from: form.get('From'), to: form.get('To') }, 201);
    }
    appendFileSync(LOG, JSON.stringify({ method, accountSid, path: url.pathname }) + '\n');
    // account / number lookups a credential check may make: the account is active and owns the number it was given
    if (/\/IncomingPhoneNumbers\.json$/.test(url.pathname)) return json({ incoming_phone_numbers: [{ phone_number: url.searchParams.get('PhoneNumber'), sid: 'PN' + String(accountSid).slice(-30) }] });
    return json({ sid: accountSid, status: 'active', friendly_name: 'loopback', type: 'Full' });
  };
}
