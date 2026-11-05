// sessionless-routes.vitest.spec — Constitution 12 §62/§133, a permanent regression test (§300).
//
// THE BUG: these routes authenticate THEMSELVES (a signature, a shared secret) or hold no data, and are called
// WITHOUT a session. None was excluded from TenantContextMiddleware — which runs on forRoutes('*') and throws
// "No session" — so every real caller got a 401 before the handler ran. Among them: Railway's deploy healthcheck
// (every deploy would have failed), Twilio inbound SMS including STOP opt-outs, the backup reporter, the cron jobs.
// Controller-level tests could not see it: they call the handler directly, skipping the middleware.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TenantContextMiddleware } from './tenant-context.middleware';

const app = readFileSync(join(process.cwd(), 'src/app.module.ts'), 'utf8');
const block = app.slice(app.indexOf('.apply(TenantContextMiddleware)'), app.indexOf(".forRoutes('*')", app.indexOf('.apply(TenantContextMiddleware)')));
const exclusions = [...block.matchAll(/\{ path: '([^']+)', method: RequestMethod\.([A-Z]+) \}/g)].map((m) => ({ re: new RegExp('^/' + m[1].replace(/\(\.\*\)/g, '.*').replace(/:[A-Za-z]+/g, '[^/]+') + '$'), method: m[2] }));
const excluded = (method: string, path: string) => exclusions.some((e) => (e.method === 'ALL' || e.method === method) && e.re.test(path));

const SELF_AUTHENTICATING: Array<[string, string, string]> = [
  ['GET', '/health/ready', "Railway's deploy healthcheck"], ['GET', '/health/live', 'liveness'],
  ['POST', '/client-telemetry/errors', 'crash intake'], ['POST', '/client-telemetry/events', 'analytics / perf intake (C6 §116–119)'], ['POST', '/internal/backups/report', 'backup reporter'],
  ['POST', '/webhooks/twilio/sms/inbound', 'Twilio inbound (STOP opt-outs)'], ['POST', '/webhooks/twilio/sms/status', 'Twilio status'],
  ['POST', '/webhooks/twilio/booking-verification/status', 'verification status'], ['POST', '/integrations/inbound/abc123', 'integration inbound'],
  ['POST', '/internal/ai-billing/webhook', 'AI billing'], ['POST', '/internal/ai-billing/sweep-trials', 'AI billing cron'],
  ['POST', '/internal/membership-billing/run-renewals', 'membership cron'], ['POST', '/internal/tenant-warnings/dispatch', 'warnings cron'],
  ['POST', '/webhooks/payments/cardpointe', 'payment webhook'], ['POST', '/webhooks/bank/tok123', 'bank webhook'],
  // Found in the same sweep: device routes whose siblings WERE excluded, and a public booking surface.
  ['POST', '/customer-display/checkout/s1/rating', 'display rating'], ['POST', '/customer-display/device/rating', 'paired-device rating'],
  ['POST', '/api/ai-booking/v1/public/appointments', 'AI booking (signed token)'], ['POST', '/api/ai-booking/v1/public/availability/search', 'AI availability (signed token)'],
  // 23-inch dual-screen spec Unit 6 (Oct 6 2026): a display pairs ITSELF (no session exists yet), then speaks with its
  // device credential — its heartbeat and the customer's receipt choice must reach their handlers, never a 401.
  ['POST', '/customer-display/pairing', 'an unpaired display asks for a code'], ['POST', '/customer-display/pairing/p1/poll', 'the display collects its credential'],
  ['POST', '/customer-display/device/heartbeat', 'paired-device heartbeat'], ['POST', '/customer-display/device/receipt', "the customer's receipt choice (paired device)"],
  ['POST', '/customer-display/checkout/s1/receipt', "the customer's receipt choice (session display)"],
  // Unit 7 (Oct 6 2026): the display starts each guest's check-in session with its device credential (§8, §12, §18).
  ['POST', '/customer-display/device/check-in/session', "a guest's check-in session on the display (paired device)"],
  // BUILD_PLAN Phase 4: the AI receptionist (voice integration key) and its keypad callback (sealed token) — every voice
  // platform call was a 401 "No session"; and the public link's captcha config.
  ['GET', '/api/ai-receptionist/v1/services', 'voice gateway (x-voice-key)'], ['POST', '/api/ai-receptionist/v1/appointments', 'voice booking (x-voice-key)'],
  ['POST', '/api/ai-receptionist/v1/verification/dtmf', 'keypad digits (sealed callback token)'], ['GET', '/api/ai-receptionist/v1/verification/twiml', 'TwiML (sealed callback token)'],
  ['POST', '/api/ai-booking/v1/public/verification/send', 'guest code send (signed link)'], ['GET', '/api/ai-booking/v1/public/verification/captcha', 'captcha config'],
  // BUILD_PLAN Phase 5, bug 20: guests browse deals (every guest got 401 "No session")
  ['GET', '/customer/deals/nearby', 'deals near me (guest)'], ['GET', '/customer/deals/public/8e1d1f6c-0000-4000-8000-000000000001', 'a deal’s page (guest)'],
  ['POST', '/customer/deals/public/8e1d1f6c-0000-4000-8000-000000000001/estimate', 'what would I pay (guest)'],
  // BUILD_PLAN Phase 5 (its live proof): the voice agent's tool webhook and call-outcome callback (x-voice-key) — 401 before
  ['POST', '/voice/tool', 'voice agent tool call (x-voice-key)'], ['POST', '/voice/calls/call_1/outcome', 'call outcome (x-voice-key)'],
];

describe('sessionless-by-design routes reach their handlers', () => {
  it.each(SELF_AUTHENTICATING)('%s %s (%s) is excluded from the session middleware', (method, path) => expect(excluded(method, path)).toBe(true));
  it('the railway.json healthcheck path is one of them', () => {
    const rail = JSON.parse(readFileSync(join(process.cwd(), '../../railway.json'), 'utf8'));
    expect(excluded('GET', rail.deploy.healthcheckPath)).toBe(true);
  });
});

describe('…and exclusion is NOT a blanket opening', () => {
  it('a staff route still requires a session', () => expect(excluded('POST', '/pos/cash-drawer/open')).toBe(false));
  it('claiming a display\'s code, and managing displays, are staff work — the session decides the salon and branch', () => {
    for (const [m, p] of [['POST', '/pos/customer-displays/pair'], ['GET', '/pos/customer-displays'], ['POST', '/pos/customer-displays/d1/revoke'], ['PATCH', '/pos/customer-displays/d1']]) expect(excluded(m, p)).toBe(false);
  });
  it('an exclusion is method-specific: GET /internal/backups/report is not excluded', () => expect(excluded('GET', '/internal/backups/report')).toBe(false));
  it('a guest can browse deals but not save one, see a saved list or a wallet', () => {
    for (const [m, p] of [['GET', '/customer/deals/saved'], ['POST', '/customer/deals/d1/save'], ['GET', '/customer/deals/wallet'], ['GET', '/customer/deals/d1']]) expect(excluded(m, p)).toBe(false);
  });
  it('the middleware really does refuse a sessionless request — the reason the list matters', async () => {
    const mw = new TenantContextMiddleware(undefined);
    await expect(mw.use({ headers: {}, cookies: {} }, {}, () => undefined)).rejects.toThrow(/No session/);
  });
});
