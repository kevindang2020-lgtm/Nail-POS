#!/usr/bin/env node
/* Preflight check — verifies production env is set and reports which integrations are LIVE vs MOCK/SANDBOX.
 * Exit code 1 if a REQUIRED production variable is missing, so it can gate a deploy (run before `node dist/main.js`).
 * Usage:  node apps/api/scripts/preflight.mjs        (reads process.env) */
const E = process.env;
const prod = E.NODE_ENV === 'production';
const has = (k) => typeof E[k] === 'string' && E[k].trim() !== '';
const out = [];
let fail = false;

// --- hard requirements in production ---
const required = ['DATABASE_URL', 'AUTH_SESSION_SECRET', 'MFA_ENC_KEY'];
for (const k of required) {
  const ok = has(k);
  if (prod && !ok) fail = true;
  out.push(`  ${ok ? 'OK ' : (prod ? 'MISSING' : 'unset')}  ${k}`);
}
if (prod && E.REPO_DRIVER !== 'postgres') { fail = true; out.push('  MISSING  REPO_DRIVER must be "postgres" in production'); }
else out.push(`  OK   REPO_DRIVER=${E.REPO_DRIVER || '(unset)'}`);

// --- integration readiness (informational) ---
const integ = [];
const sandbox = has('PAYMENTS_SANDBOX');
integ.push(['Payments', sandbox ? 'SANDBOX (no live charges)' : (has('FISERV_MERCHANT_ID') && has('FISERV_SECRET')) ? 'LIVE (Fiserv/CardPointe)' : 'NOT CONFIGURED — falls back to sandbox/declines']);
integ.push(['SMS (Twilio)', (has('TWILIO_ACCOUNT_SID') && has('TWILIO_AUTH_TOKEN') && has('TWILIO_FROM')) ? 'LIVE' : 'MOCK (simulated)']);
integ.push(['Email (SendGrid)', has('SENDGRID_API_KEY') ? 'LIVE' : 'MOCK (simulated)']);
integ.push(['Push (FCM)', has('FCM_SERVER_KEY') ? 'LIVE' : 'MOCK (simulated)']);
integ.push(['CORS allowlist', has('WEB_CORS_ORIGINS') ? E.WEB_CORS_ORIGINS : '(none set — cross-origin front-ends will be blocked)']);

// --- redis required when multi-node ---
const needRedis = E.REALTIME_BUS === 'redis' || E.LOGIN_THROTTLE_STORE === 'redis';
if (needRedis && !has('REDIS_URL')) { fail = fail || prod; out.push('  ' + (prod ? 'MISSING' : 'WARN') + '  REDIS_URL required when REALTIME_BUS/LOGIN_THROTTLE_STORE=redis'); }

console.log(`\nAIPowerSalon preflight (NODE_ENV=${E.NODE_ENV || 'unset'})\n\nRequired:`);
console.log(out.join('\n'));
console.log('\nIntegrations:');
for (const [k, v] of integ) console.log('  ' + k.padEnd(18) + v);
if (fail) { console.error('\n✗ PREFLIGHT FAILED — required production variables are missing (see MISSING above).\n'); process.exit(1); }
console.log('\n✓ Preflight OK.\n');
