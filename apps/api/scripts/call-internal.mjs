#!/usr/bin/env node
// call-internal.mjs — Constitution 3 Step 6: how a scheduler calls an internal route. It mints its OWN 5-minute service
// token (SERVICE_TOKEN_SECRET, the principal's least-privilege scopes) at call time and POSTs with it — so no long-lived
// shared secret sits in a cron definition. Run it where the secret lives, e.g. a Railway cron command in the API service:
//   node apps/api/scripts/call-internal.mjs reminders
// API_URL (default http://127.0.0.1:$PORT) points at the API. Exit 0 on a 2xx, 1 otherwise.
import { mintServiceToken } from '@aipowersalon/auth';
const JOBS = {
  reminders:            { principal: 'svc.scheduler', path: '/jobs/appointment-reminders' },
  'scheduled-reports':  { principal: 'svc.scheduler', path: '/internal/scheduled-reports/run-due' },
  'tenant-warnings':    { principal: 'svc.scheduler', path: '/internal/tenant-warnings/dispatch' },
  'hardware-payment':   { principal: 'svc.scheduler', path: '/internal/hardware-payment/run-monthly' },
  'membership-renewals':{ principal: 'svc.billing',   path: '/internal/membership-billing/run-renewals' },
};
const job = JOBS[process.argv[2]];
if (!job) { console.error(`usage: call-internal.mjs <${Object.keys(JOBS).join('|')}> [json-body]`); process.exit(2); }
const secret = process.env.SERVICE_TOKEN_SECRET || '';
if (secret.length < 32) { console.error('SERVICE_TOKEN_SECRET (32+ chars) is required'); process.exit(2); }
const base = process.env.API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
const res = await fetch(base + job.path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mintServiceToken(job.principal, { secret })}` }, body: process.argv[3] || '{}' });
const text = await res.text();
console.log(`${job.path} → ${res.status} ${text.slice(0, 300)}`);
process.exit(res.ok ? 0 : 1);
