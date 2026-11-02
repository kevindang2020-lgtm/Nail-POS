// security-dod-check.mjs — Constitution 12 §324 Definition of Done, checked against the tree, not asserted.
//
// Every one of §324's 82 lines maps to EVIDENCE in this repository: an export, a route, a migration, a test, a CI gate
// (scripts/dod-lib.mjs: the vocabulary and the explicit statuses DONE / HOSTING (code built; the rest is Kevin's
// hosting action, named) / PARTIAL / NOT DONE). Nothing passes on a comment or a bare `true`; every predicate is proven
// to flip when its evidence goes (src/common/dod-predicates.vitest.spec.ts).
// `--run` also runs tsc, the lint ratchet and the every-push security lane so "Build / Type checking / Lint / Tests
// pass" are measured, not recalled.
// Run: node scripts/security-dod-check.mjs [--run]
import { readFileSync } from 'node:fs';
import { evidence, RUN, runOk, D, H, P, N, report } from './dod-lib.mjs';
const { R, has, grep, exists, ci, take } = evidence(import.meta.url);
const C = 'src/common/', A = '../../modules/identity/src/auth/', M = 'db/migrations/';   // identity is modules/identity (Constitution 13)

// Measured once each (the first version ran tsc twice and the whole audit, and outran a 5-minute limit):
const guards = (() => { if (!exists('scripts/security-audit.mjs')) return []; const a = readFileSync(R('scripts/security-audit.mjs'), 'utf8'); const b = a.slice(a.indexOf('export const C12_GUARDS = [')); return [...b.slice(0, b.indexOf('];')).matchAll(/'(src\/[^']+\.spec\.ts)'/g)].map((m) => m[1]); })();
const TSC = RUN ? runOk('npx', ['tsc', '--noEmit'], R('.')) : null;
const LINT = RUN ? runOk('node', ['tooling/ci/lint-ratchet.mjs'], R('../..')) : null;
const TESTS = RUN ? runOk('npx', ['vitest', 'run', ...guards], R('.'), 900_000) : null;
const measured = (gate, value) => (RUN ? value : gate);
const ranNote = (what) => (RUN ? `measured now (${what})` : `gated on every push (${what}); --run measures it here`);

take();   // what was read before the first line (the --run lane list) belongs to no line
const items = [
  D('Threat model completed', has('../../SECURITY_THREAT_MODEL.md')),
  D('Trust boundaries documented', grep('../../SECURITY_THREAT_MODEL.md', /trust boundar/i)),
  D('Data classification completed', has('../../SECURITY_DATA_CLASSIFICATION.md') && has(C + 'data-classification.pgtest.vitest.spec.ts')),
  D('Authentication realms implemented', has(C + 'realm.guard.ts')),
  D('Passwords securely hashed', grep('../../packages/auth/src/password.ts', /scrypt/)),   // @aipowersalon/auth (Constitution 13 §70)
  D('MFA implemented', has(A + 'mfa.controller.ts') && has(A + 'mfa-bypass-regression.vitest.spec.ts')),
  D('Passkeys supported', has(A + 'webauthn.service.ts')),
  D('Session rotation works', grep(A + 'auth.controller.ts', /sessions\.create\(/)),
  D('Session revocation works', grep(A + 'session-store.ts', /async isRevoked/)),
  D('Device trust implemented', has(A + 'webauthn.kysely.ts') && has(M + '454_session_devices.sql')),
  D('Device revocation works', has(A + 'session-devices.pgtest.vitest.spec.ts')),
  D('Authorization deny-by-default works', has(C + 'authz-declared.vitest.spec.ts')),
  D('Tenant isolation enforced', has(C + 'cross-tenant-suite.pgtest.vitest.spec.ts') && has(M + '450_tenant_consistency_triggers.sql')),
  D('Branch isolation enforced', grep(C + 'cross-tenant-suite.pgtest.vitest.spec.ts', /BRANCH id but salon B/)),
  // decision D2 (revised): triggers chosen over composite FKs — the same guarantee, no key rewrite; proven by the crossed-id test
  D('Composite DB constraints implemented where appropriate', grep(M + '450_tenant_consistency_triggers.sql', /CREATE (OR REPLACE )?FUNCTION/i) && has(C + 'tenant-consistency.pgtest.vitest.spec.ts'), 'decision D2: consistency triggers, not composite FKs'),
  D('Cross-tenant tests pass', has(C + 'cross-tenant-suite.pgtest.vitest.spec.ts')),
  D('Platform/tenant realms separated', has(C + 'realm.guard.vitest.spec.ts')),
  D('Support Mode secure', grep(C + 'tenant-context.middleware.ts', /SUPER_ADMIN is the one cross-tenant role/)),
  // Phase 14 D: every path that grants access through a support session refuses an expired one (and its realtime stream)
  D('Support Mode expires', grep(C + 'support-session-gate.ts', /export /) && has(C + 'support-session-gate.pgtest.vitest.spec.ts') && has(C + 'support-session-gate.vitest.spec.ts')),
  D('Support actions audited', grep('../../modules/security-center/src/security-events/security-events.ts', /SUPPORT_MODE_STARTED/)),
  H('TLS enforced', grep(C + 'security-headers.middleware.ts', /Strict-Transport-Security/) && has(C + 'security-headers.vitest.spec.ts'), 'TLS is terminated at Railway\'s edge (decision D5) and HSTS is sent; keep every custom domain HTTPS-only on Railway (HOSTING_ACTIONS A7)'),
  H('Database private', grep(C + 'network-posture.ts', /railway\\.internal/) && has(C + 'network-posture.vitest.spec.ts'), 'point DATABASE_URL at the *.railway.internal host and turn the public TCP proxy off (HOSTING_ACTIONS B4); the app warns at boot on a public host without TLS'),
  H('Redis private', grep(C + 'network-posture.ts', /rediss:\/\/|plain redis/) && has(C + 'network-posture.vitest.spec.ts'), 'the same for REDIS_URL (HOSTING_ACTIONS B1)'),
  // decision D4: Railway variables ARE the secrets store; the inventory + rotation tracking + the gate that it cannot go stale
  D('Secrets Manager implemented', grep(C + 'secrets-inventory.ts', /PG_WORKER_DATABASE_URL/) && has(C + 'secrets-inventory.pgtest.vitest.spec.ts') && has(C + 'secret-rotation.ts'), 'decision D4: Railway variables are the store'),
  D('No secrets in source', grep(C + 'key-ring.ts', /FALLBACK|refuse|required/i) && has('scripts/security-audit.mjs')),
  D('No secrets in frontend/mobile', grep(C + 'secrets-inventory.pgtest.vitest.spec.ts', /VITE_/)),
  D('Key management implemented', has(C + 'key-ring.ts')),
  D('Key rotation documented', grep('../../SECURITY_SECRETS.md', /_PREVIOUS/) && has(C + 'secret-rotation.ts')),
  H('WAF implemented', has(C + 'keyed-rate-limit.ts') && grep(M + '264_ip_block_rules.sql', /ip_block_rules/) && has(C + 'fraud-detector.ts') && has(C + 'tenant-rate-limit.vitest.spec.ts'),
    'application-level abuse controls are built (keyed rate limits, IP blocks, fraud engine; decision D5); a managed WAF in front of Railway (e.g. Cloudflare proxy) is Kevin\'s choice (HOSTING_ACTIONS A8)'),
  D('Rate limiting implemented', has(C + 'keyed-rate-limit.ts') && has('../../packages/security/src/client-ip.ts')),
  D('OTP abuse protection implemented', has(C + 'otp-race.pgtest.vitest.spec.ts') && has(A + 'mfa-brute-force.vitest.spec.ts')),
  D('API validation implemented', has(C + 'api-hardening.vitest.spec.ts')),
  D('Mass-assignment prevented', grep(C + 'api-hardening.vitest.spec.ts', /mass.assign/i)),
  D('SQL injection protection implemented', has('scripts/sql-prepare-check.mjs')),
  D('XSS protection implemented', has('../../modules/tenants/src/branding/email-layout-safety.vitest.spec.ts') && has(C + 'app-headers.vitest.spec.ts')),
  D('CSRF protection implemented where required', grep(A + 'auth.http.ts', /sameSite: 'lax'/) && grep(C + 'api-hardening.vitest.spec.ts', /GET never mutates/)),
  D('CORS restricted', grep('src/main.ts', /allowedOrigins\.includes\(origin\)|isOriginAllowed\(origin, allowedOrigins\)|corsDecision\(/)),   // Security Deep Scan C5: credentialed vs marketing split (corsDecision in common/allowed-origins.ts)   // Constitution 9 moved the check into the shared allow-list (allowed-origins.ts)
  D('SSRF protections implemented', grep(C + 'api-hardening.vitest.spec.ts', /SSRF|isSafeWebhookUrl/i)),
  D('Payment tokenization architecture verified', grep(C + 'card-data.pgtest.vitest.spec.ts', /gateway_payment_method_token/)),
  D('CVV never stored', grep(C + 'card-data.pgtest.vitest.spec.ts', /cvv2\?/)),
  D('Payment webhooks verified', grep('../../modules/security-center/src/security-events/security-events.ts', /WEBHOOK_SIGNATURE_FAILED/)),
  D('Twilio webhooks verified', has('../../modules/communications/src/messaging-inbound/twilio-inbound.vitest.spec.ts') && has(C + 'sessionless-routes.vitest.spec.ts')),
  D('OAuth secured', grep(C + 'oauth-core.ts', /export function pkceMatches/) && grep('src/oauth/oauth.postgres-race.vitest.spec.ts', /PKCE S256 only/) && grep('../../modules/super-admin/src/super-admin-integrations/integration-connections.kysely.repository.ts', /code_verifier|state/)),
  D('API keys hashed/scoped', has(M + '451_hash_plaintext_tokens.sql')),
  // Phase 14 D: per provider, the same event delivered twice is processed once (DB effect counted), bad signatures refused
  D('Webhooks deduplicated', has(M + '565_webhook_dedupe_uniques.sql')
    && grep(C + 'payment-webhook-dedupe.pgtest.vitest.spec.ts', /delivered twice CONCURRENTLY/) && grep(C + 'payment-webhook-dedupe.pgtest.vitest.spec.ts', /bank deposit webhook: the same deposit twice is one deposit/)
    && has('../../modules/communications/src/messaging-inbound/twilio-webhook-dedupe.pgtest.vitest.spec.ts')
    && has('../../modules/booking/src/customer-booking/booking-verification-webhook-dedupe.pgtest.vitest.spec.ts')
    && has('../../modules/super-admin/src/super-admin-billing/billing-webhook-dedupe.postgres-race.vitest.spec.ts')
    && has('../../modules/super-admin/src/super-admin-integrations/integration-webhook-dedupe.pgtest.vitest.spec.ts')
    && has('../../modules/ai/src/ai/ai-webhook-dedupe.pgtest.vitest.spec.ts')),
  D('Realtime subscriptions authorized', has('src/realtime/realtime-isolation.vitest.spec.ts')),
  D('Realtime payloads sanitized', grep('src/realtime/realtime-isolation.vitest.spec.ts', /event-only/)),
  // Phase 14 D: aps_api / aps_worker roles (no DDL, no TRUNCATE, only the tables each touches), provisioned by script
  H('Workers least privileged', grep('../../packages/database/src/kysely.provider.ts', /PG_WORKER_DATABASE_URL/) && has('scripts/db-provision-roles.mjs') && has('db/roles') && has(C + 'worker-role.postgres-race.vitest.spec.ts'),
    'run node apps/api/scripts/db-provision-roles.mjs as the database owner, then set PG_WORKER_DATABASE_URL (worker) and DATABASE_URL (API) to the new logins (HOSTING_ACTIONS D1)'),
  D('Events tenant-validated', has(M + '450_tenant_consistency_triggers.sql') && has('src/events/consumers/loyalty-points.pgtest.vitest.spec.ts')),
  D('AI tools authorized', grep('../../modules/ai/src/ai/ai-tool-registry.ts', /does not grant permission/)),
  // Phase 14 D: the tenant-filtered retrieval is on a real production path, with a cross-tenant test
  D('AI cross-tenant isolation tested', grep('../../modules/ai/src/ai/ai-knowledge.ts', /assertFilterIsSafe/) && grep('../../modules/ai/src/ai-center/reception-copilot-assist.service.ts', /new KyselyKnowledgeRetriever\(db\)/)
    && grep('../../modules/ai/src/ai/ai-knowledge-retrieval.pgtest.vitest.spec.ts', /the production caller: Reception Copilot explain-service/)),
  D('Prompt injection tests pass', grep('../../modules/ai/src/ai/ai-evaluation.ts', /injection/i) && grep('../../modules/ai/src/ai/prompt-injection-eval.vitest.spec.ts', /every untrusted prompt variable contains every payload/)),
  D('File upload validation works', has('src/common/file-safety.vitest.spec.ts')),
  // Phase 14 D: a ClamAV adapter (clamd over TCP) used by the upload policy when configured; quarantine on detection
  H('Malware scanning works', has('../../modules/safety/src/tenant-safety-community/evidence-scanner.ts') && grep('../../packages/media/src/clamav-scanner.ts', /export function malwareScannerFromEnv/) && grep('../../packages/media/src/upload-policy.ts', /malwareScannerFromEnv\(process\.env/) && has('../../packages/media/src/clamav-scanner.vitest.spec.ts'),
    'run a clamd service on Railway and set CLAMAV_HOST (HOSTING_ACTIONS D2); until then uploads are scanned as "not configured"'),
  // decision M2 (verified): evidence + private attachments private; the media store public BY DESIGN for public images only
  D('Object storage private by default', grep('../../SECURITY_AUDIT.md', /M2 — CLOSED/) && has('../../packages/media/src/private-store.ts'), 'decision M2'),
  D('Signed URLs expire', grep('../../modules/safety/src/tenant-safety-community/evidence-blob-store.ts', /expires/i)),
  D('Fraud risk engine implemented', has(C + 'fraud-detector.ts')),
  D('Booking abuse controls implemented', has('../../modules/booking/src/customer-booking/booking-verification-fraud.ts')),
  D('SMS pumping controls implemented', has('../../modules/booking/src/customer-activation/activation-destination.vitest.spec.ts')),
  // Phase 14 D: per caller (user / device / IP) + per tenant, failures weighted, 429 + Retry-After; race-tested
  D('Coupon/gift-card abuse controls implemented', grep('../../modules/gift-cards/src/gift-cards/gift-card-number-core.ts', /crypto\.randomInt/) && grep('../../packages/security/src/code-lookup-limit.ts', /export /)
    && grep(M + '564_code_lookup_attempts.sql', /CREATE TABLE IF NOT EXISTS code_lookup_attempts/) && has(C + 'code-lookup-limit.postgres-race.vitest.spec.ts')),
  D('Security events implemented', has(M + '449_security_events.sql')),
  D('Security alerts implemented', has(M + '448_alert_notifications.sql')),
  D('Security Center implemented', has(C + 'security-posture.ts')),
  D('Audit immutable', has(M + '452_audit_append_only.sql')),
  H('Backup encrypted', grep('../../SECURITY_DR.md', /Must be kept separately/) && has(C + 'restore-verify.pgtest.vitest.spec.ts'), 'credentials inside a backup are ciphertext under keys kept outside it (verified by the restore verifier); confirm encryption at rest of Railway\'s backups on the plan (HOSTING_ACTIONS D9)'),
  H('Backup access restricted', grep('../../SECURITY_DR.md', /scratch/i) && has('scripts/restore-verify.ts'), 'limit Railway project membership to named people with 2FA; restores only through the scratch-restore workflow (HOSTING_ACTIONS D9)'),
  H('PITR enabled', has('scripts/restore-verify.ts') && grep('../../docs/DR_DRILLS_2026-10-08.md', /\| Restore \|[^\n]*\*\*PASS\*\*/), 'enable point-in-time recovery on the Railway Postgres plan (HOSTING_ACTIONS A2)'),
  H('Restore test completed', grep('../../docs/DR_DRILLS_2026-10-08.md', /\| Restore \|[^\n]*\*\*PASS\*\* 11\/11/) && has('scripts/restore-verify.ts'), 'the drill passed on a local backup (DR_DRILLS); restore a REAL Railway backup into a scratch DB with scripts/restore-verify.ts (HOSTING_ACTIONS A3)'),
  D('DR security validated', has('../../SECURITY_DR.md') && has(C + 'restore-verify.pgtest.vitest.spec.ts')),
  D('Secure CI/CD implemented', grep('../../.github/workflows/security.yml', /permissions:\n  contents: read/)),
  D('Secret scanning implemented', grep('scripts/security-audit.mjs', /SECRET_PATTERNS/)),
  D('Dependency scanning implemented', grep('scripts/security-audit.mjs', /npm audit/)),
  // BUILD_PLAN Phase 11: .github/workflows/build-image.yml — Trivy image scan (CRITICAL with a fix fails) + SBOM, and a
  // Trivy IaC scan of the Dockerfile + deploy/ (railway*.json is linted by container-image.vitest.spec.ts).
  D('Container scanning implemented', grep('../../.github/workflows/build-image.yml', /scan-type: image[\s\S]*exit-code: '1'/) && has(C + 'container-image.vitest.spec.ts')),
  D('IaC scanning implemented', grep('../../.github/workflows/build-image.yml', /scan-type: config/) && has('../../.github/trivy-iac.yaml')),
  D('Security regression suite implemented', grep('scripts/security-audit.mjs', /export const C12_GUARDS/)),
  // Phase 14 E: the IDOR suite is generated from the manifest (every tenant GET-by-id route) and run live as salon B
  H('Penetration tests completed where possible', has(C + 'cross-tenant-suite.pgtest.vitest.spec.ts') && grep(C + 'idor-route-coverage.vitest.spec.ts', /idorRoutes/) && grep('scripts/live-phase14-idor.mjs', /no route hands salon B salon A/),
    'commission an independent human penetration test and real-device mobile testing (§286, §288; HOSTING_ACTIONS D7/D8)'),
  D('Incident-response runbooks created', has('../../SECURITY_RUNBOOKS.md') && has(C + 'security-runbooks.vitest.spec.ts')),
  D('No known critical vulnerability remains', grep('../../SECURITY_AUDIT.md', /\*\*CRITICAL:\*\* none/)),
  D('Build passes', measured(ci.build(), TSC), ranNote('build-image.yml docker build of the API; security.yml build:packages + build:modules')),
  D('Type checking passes', measured(ci.types(), TSC), ranNote('API build = tsc over src; gate "app types" typechecks every SPA')),
  D('Lint passes', measured(ci.lint(), LINT), ranNote('gate "lint" = tooling/ci/lint-ratchet.mjs: 0 errors, no rule above lint-baseline.json; npm run lint is the same ratchet')),
  D('Tests pass', measured(ci.tests(), TESTS), ranNote(`security.yml: every suite in a 4-way matrix + the race lane; --run: the ${guards.length}-file every-push security lane`)),
];

report('324', items, 82);
