#!/usr/bin/env node
// check-critical-step-up.mjs — Security Deep Scan C7 (Oct 23 2026): every CRITICAL mutation asks for a fresh step-up.
//
// Constitution 7 §8 / §59 / §133 name the actions that need recent strong authentication — merchant / funding / bank
// changes, refunds and voids, role and permission changes, security settings, credentials, platform accounts. The scan
// found them only partly protected (tenants/:id/status had step-up, tenants/:id/suspend did not; a refund's settlement
// had it, the refund itself did not) and nothing stopped a new critical route from shipping without it.
//
// This reads the OpenAPI route manifest (apps/api/openapi/manifest.txt — check:openapi keeps it equal to the code) and
// fails when a POST / PUT / PATCH / DELETE route matching a reviewed CRITICAL pattern lacks `step-up` (@RequireStepUp,
// enforced by the API's global StepUpGuard), unless the route is listed in EXEMPT with the reason it needs none.
// PENDING names known gaps in code another owner must change; it may only SHRINK (an entry that now has step-up, or no
// longer exists, fails until removed). Every pattern must still match at least one route (a rename cannot silently turn
// the gate off).
//
//   node scripts/check-critical-step-up.mjs          check (CI: npm run check:critical-step-up)
//   node scripts/check-critical-step-up.mjs --list   print every critical route and its state
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(API, 'openapi', 'manifest.txt');
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The reviewed list of critical patterns (path templates as the manifest writes them: {param}). */
export const CRITICAL = [
  // ── platform: merchant, funding and payment configuration ──
  { re: /^\/super-admin\/merchant-accounts\/\{[^}]+\}\/(rates|activation|deactivation|suspension|funding-update|mid-assignment|terminals)$/, why: 'merchant / funding / MID / terminal change' },
  { re: /^\/super-admin\/tenants\/\{id\}\/payment-gateway(\/branches\/\{branchId\}(\/status)?|\/(pause|resume|disable)|\/webhooks\/rotate-secret)?$/, why: 'payment gateway configuration / status / webhook secret' },
  // ── platform: tenant lifecycle and owner access ──
  { re: /^\/super-admin\/tenants\/\{id\}\/(suspend|reactivate|status|lifecycle|reset-owner-password|support-access)$/, why: 'tenant suspension / lifecycle / owner credential / support access' },
  { re: /^\/super-admin\/tenants\/bulk-status$/, why: 'bulk tenant suspension' },
  // ── platform: credentials ──
  { re: /^\/super-admin\/tenants\/\{tenantId\}\/messaging-credentials$/, why: 'messaging provider credential' },
  { re: /^\/super-admin\/integrations\/connections\/\{id\}\/credentials(\/rotate)?$/, why: 'integration credential set / rotate' },
  { re: /^\/super-admin\/communications\/providers\/\{id\}\/rotate-credential$/, why: 'provider credential rotation' },
  // ── platform: security controls ──
  { re: /^\/super-admin\/security\/(mfa-policy|password-policy|session-policy)$/, why: 'platform security policy' },
  { re: /^\/super-admin\/security\/lockdowns\/\{id\}\/(confirm|execute|lift|cancel)$/, why: 'emergency lockdown (and undoing it — Oct 28 2026 re-audit)' },
  { re: /^\/super-admin\/security\/privileged-access\/\{id\}\/approve$/, why: 'privileged access grant' },
  { re: /^\/super-admin\/security\/ip-blocks(\/allowlist|\/\{id\})?$/, why: 'platform network block / allowlist' },
  // ── platform: accounts, roles, access ──
  { re: /^\/super-admin\/platform\/users(\/invite|\/\{id\}\/(disable|enable|reset-password|resend-invite|revoke-sessions|role|mfa))?$/, why: 'platform / salon account creation, status, credential, role' },
  { re: /^\/super-admin\/platform\/invitations$/, why: 'account invitation (can mint a platform account)' },
  { re: /^\/super-admin\/platform\/access-requests\/\{id\}\/approve$/, why: 'access grant' },
  // Oct 28 2026 re-audit (§59 / §76): a branch access grant, a payout approval, a queue support request (customer data)
  { re: /^\/super-admin\/platform\/users\/branch-access(\/revoke)?$/, why: 'branch access grant / revoke' },
  { re: /^\/super-admin\/revenue-residuals\/partner-payouts\/\{id\}\/approve$/, why: 'partner payout approval (money out)' },
  { re: /^\/super-admin\/queue\/support-session$/, why: 'support request on a salon (customer data)' },
  // salon: the texting provider's credentials (the Super Admin equivalent is already critical)
  { re: /^\/tenant\/messaging\/credentials(\/branches\/\{branchId\})?$/, why: 'salon messaging provider credential' },
  { re: /^\/super-admin\/platform-staff\/\{userId\}\/(role|status|revoke-sessions|reset-mfa)$/, why: 'platform staff role / status / MFA' },
  // S-A13 (Security Deep Scan §29 / §136): approving another device for Super Admin sign-in
  { re: /^\/auth\/devices\/\{id\}\/approve-platform$/, why: 'trusted device for platform sign-in' },
  // ── salon: money out ──
  { re: /^\/(pos\/checkout|mobile-checkout)\/(payments\/\{paymentId\}\/(refund|void)|tickets\/\{ticketId\}\/refund)$/, why: 'refund / void' },
  { re: /^\/pos\/checkout\/tickets\/\{ticketId\}\/refunds\/\{refundId\}\/settle$/, why: 'manual refund settlement' },
  { re: /^\/pos\/deposit-reconciliation\/workspace\/bank-accounts(\/\{bankAccountId\})?$/, why: 'bank account (add / rename / default / deactivate)' },
  // ── salon: permissions, security and payment settings, credentials ──
  { re: /^\/pos\/technicians\/\{technicianId\}\/permissions$/, why: 'technician permissions' },
  // Security Deep Scan §59 (Oct 26 2026): role templates, staff invitations, override revocation, Technician App access
  { re: /^\/pos\/staff-roles(\/\{id\}\/archive)?$/, why: 'custom role template create / archive (carries permissions)' },
  { re: /^\/pos\/access\/invitations$/, why: 'staff invitation into a role' },
  { re: /^\/pos\/access\/overrides\/\{id\}\/revoke$/, why: 'permission override revocation' },
  { re: /^\/pos\/technicians\/\{technicianId\}\/app-access$/, why: 'Technician App access on / off' },
  { re: /^\/pos\/settings\/(security|roles-permissions-security|payments-checkout)$/, why: 'security / roles / payment settings' },
  { re: /^\/pos\/settings\/payments-checkout\/terminals\/(pair|\{id\}\/(register|unpair|disable|enable))$/, why: 'payment terminal pairing / state' },
  { re: /^\/pos\/api-keys(\/\{id\}\/rotate)?$/, why: 'API key issue / rotate' },
  { re: /^\/pos\/webhooks(\/\{id\}\/rotate-secret)?$/, why: 'webhook destination / signing secret' },
  { re: /^\/owner\/security\/access-code$/, why: 'owner access code' },
  // Secure Tap to Pay §13 (Oct 23 2026): every payment-device trust decision
  { re: /^\/mobile-checkout\/devices\/\{deviceId\}\/(approve|revoke|disable|compromised|reassign|branches)$/, why: 'payment device approve / revoke / suspend / reassign / branches' },
  { re: /^\/mobile-checkout\/devices\/pairings$/, why: 'payment device pairing code' },
  { re: /^\/auth\/mfa\/(enroll|confirm)$/, why: 'authenticator enrollment' },
];

/** Reviewed: a critical-pattern route that needs NO step-up, and why. */
export const EXEMPT = {
  'POST /super-admin/platform/users': 'retired (Security Deep Scan C3): answers 410 ENDPOINT_RETIRED and changes nothing',
  'POST /owner/security/access-code': 'the request itself re-proves the owner\'s CURRENT password (owner.service setOwnerAccessCode verifies currentPassword) — a stronger, inline step-up the Owner App already sends',
  'POST /auth/mfa/enroll': 'how an account gets its FIRST factor — a platform step-up needs a factor (StepUpGuard would deadlock it); a forced enrollment runs inside sign-in',
  'POST /auth/mfa/confirm': 'completes the enrollment above with a fresh TOTP code from the new factor',
};

/** Known gaps in code another owner changes (here: modules/communications). Only shrinks. */
export const PENDING = {
};

export function parseManifest(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Z]+) (\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    out.push({ method: m[1], path: m[2], key: `${m[1]} ${m[2]}`, stepUp: /(^|\s)step-up(\s|$)/.test(m[3]) });
  }
  return out;
}

export function evaluate(routes, { critical = CRITICAL, exempt = EXEMPT, pending = PENDING } = {}) {
  const problems = []; const rows = [];
  const byKey = new Map(routes.map((r) => [r.key, r]));
  const hits = new Map(critical.map((c) => [c.re.source, 0]));
  for (const r of routes) {
    if (!MUTATING.has(r.method)) continue;
    const c = critical.find((x) => x.re.test(r.path));
    if (!c) continue;
    hits.set(c.re.source, hits.get(c.re.source) + 1);
    const state = r.stepUp ? 'step-up' : exempt[r.key] ? 'exempt' : pending[r.key] ? 'pending' : 'MISSING';
    rows.push({ key: r.key, why: c.why, state });
    if (state === 'MISSING') problems.push(`${r.key} — critical (${c.why}) and has no @RequireStepUp. Add it, or list it in EXEMPT with the reason it needs none.`);
  }
  for (const [k, reason] of Object.entries(exempt)) {
    const r = byKey.get(k);
    if (!r) problems.push(`EXEMPT entry ${k} no longer exists — remove it.`);
    else if (!critical.some((c) => c.re.test(r.path))) problems.push(`EXEMPT entry ${k} matches no critical pattern — remove it.`);
    else if (!String(reason || '').trim()) problems.push(`EXEMPT entry ${k} has no reason.`);
  }
  for (const k of Object.keys(pending)) {
    const r = byKey.get(k);
    if (!r) problems.push(`PENDING entry ${k} no longer exists — remove it (the list only shrinks).`);
    else if (r.stepUp) problems.push(`PENDING entry ${k} now has step-up — remove it from PENDING (the list only shrinks).`);
  }
  for (const c of critical) if (!hits.get(c.re.source)) problems.push(`critical pattern ${c.re} matches no route — a rename would silently turn this gate off; update the pattern.`);
  return { problems, rows };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { problems, rows } = evaluate(parseManifest(readFileSync(MANIFEST, 'utf8')));
  if (process.argv.includes('--list')) for (const r of rows) console.log(`${r.state.padEnd(8)} ${r.key}  (${r.why})`);
  if (problems.length) {
    console.log('critical-step-up: FAIL');
    for (const p of problems) console.log('  ' + p);
    process.exit(1);
  }
  const n = (s) => rows.filter((r) => r.state === s).length;
  console.log(`critical-step-up: ${rows.length} critical routes — ${n('step-up')} with step-up, ${n('exempt')} reviewed exempt, ${n('pending')} pending (owned elsewhere)`);
}
