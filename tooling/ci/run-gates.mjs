#!/usr/bin/env node
// run-gates.mjs — Constitution 13 Phase 11: every repository gate runs in CI, not only on a developer's machine.
//
// The security lane (npm run security:fast) runs 16 of the API's gates (15 checks + the boot probe). Eight more existed and were run only by hand:
// the realtime contract and infra-duplicate gates, the AI-platform and AI infra-duplicate gates, the silent-SQL and
// SQL-identifier gates, and the native-dialog and money-parsing gates. This runs ALL of them — the eight plus the
// fifteen (cheap, and a gate belongs to one list) — and the two module audits (every name imported from a module is
// exported by it; every test/script import and literal source path resolves). Exit 1 names every failure.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = join(ROOT, 'apps', 'api');
export const GATES = [
  // the security lane's fifteen checks (repeated here so this list is the complete one; its boot probe stays there)
  'tenant', 'tenant-builder', 'perms', 'public', 'sql', 'sql:select', 'impossible', 'crosswire', 'di', 'types-drift',
  'unreached', 'dead-client', 'nav', 'html', 'no-print',
  // the eight that CI never ran
  'realtime-contract', 'realtime-infra-duplicates', 'ai-platform', 'ai-infra-duplicates', 'silent-sql', 'sql-identifiers',
  'dialogs', 'money',
  // BUILD_PLAN Phase 15 (Constitution 8 §7/§18): every domain-registry event has an outbox producer (or a reviewed
  // reservation), every consumer subscribes to a registry event, no retired name is referenced, the catalog is current
  'event-producers',
  // BUILD_PLAN Phase 15 (Constitution 9 §247): every realtime event is classified in the catalog generator (audience,
  // permission, room, payload class) and the committed REALTIME_EVENT_CATALOG.md is current — an UNCLASSIFIED event fails
  'realtime-catalog',
  // Constitution 7 §303: lint is a gate — zero errors, and no rule's warnings above its baseline
  'lint',
  // Constitution 7 §303: no raw secret column reaches a screen — reviewed in-process reads only, ratcheted
  'secrets',
  // Constitution 5 §30: no new invented error codes — registry or the frozen legacy baseline (only shrinks)
  'error-codes',
  // Vietnamese POS §58 V-5 (Oct 27 2026): no NEW free-text refusal — a sentence a person reads is thrown withCode(…, CODE)
  // so the POS / Owner / Tech apps word it in the user's language; the reviewed English-only list only shrinks
  'error-text',
  // Constitution 5 §45 / G5: the OpenAPI manifest — no route, permission, public flag, step-up or idempotency change
  // lands without its manifest diff in the same commit; the generated spec must also be structurally valid
  'openapi',
  // Security Deep Scan C7 (Oct 23 2026): every critical mutation (refunds / voids, merchant / funding / bank, credentials,
  // security settings, roles / permissions, platform accounts) carries @RequireStepUp — reviewed patterns over the manifest,
  // reviewed exemptions with reasons, and a PENDING list that only shrinks
  'critical-step-up',
  // Constitution 5 G4: no client object reaches an INSERT/UPDATE whole — field-by-field rows pass, spreads/aliases of
  // input fail, parameter-passed objects need a reviewed entry (mass-assignment.reviewed.json)
  'mass-assignment',
  // Constitution 5 Phase 3/19: every effective permission reachable by a role allowed into its realm; no unclassified
  // /super-admin path; staff routes without a key only from the frozen baseline (only shrinks)
  'api-contract',
  // BUILD_PLAN Phase 12 (Constitution 5 #57): every app, the kiosk and the shared packages call /api/v1/<path> — no legacy
  // API path handed to fetch / a stream, no base glued to a path by hand, every dev proxy forwards /api/v1, and the
  // client's unversioned list equals the server's NEVER_DEPRECATED (allowlist only shrinks)
  'v1-clients',
  // BUILD_PLAN Phase 13 (Constitution 6 §11–16): the four Capacitor apps reach the API only through the ONE mobile transport
  // (no raw fetch / EventSource; each client is createTransport; each stream passes the native ticket streamUrl)
  'mobile-transport',
  // BUILD_PLAN Phase 12 (Constitution 5 #17): every mutating handler that reads a body validates it with
  // @Body(ValidatedBody(schema)) — the shrinking allowlist (validated-bodies.allowlist.json) names the owning module
  'validated-bodies',
  // Security Deep Scan §40 (S-A14, Oct 27 2026): the type-aware half of the strict-bodies gate — every first-party caller of
  // a STRICT body route sends only declared fields (TypeScript checker over the SPAs, packages, kiosk / display apps and the
  // pilot scripts), or the route is reviewed; security/strict-bodies.typeproof.json is current
  'strict-bodies-types',
  // BUILD_PLAN Phase 9 (Constitution 2 §148/§153): no new role-NAME authorization in backend code (permissions decide;
  // the allowlist holds the plane / mapping checks with reasons), and docs/PERMISSIONS.md + the registry's legacy-alias
  // list are regenerated whenever the catalog or a pos.* key changes
  'role-checks', 'permission-docs',
  // BUILD_PLAN Phase 10 (Constitution 1 §32–§33): no new raw INSERT into audit_events / audit_logs outside modules/audit —
  // AuditService fills the request / correlation / session ids and the before / after state (allowlist only shrinks)
  'audit-writers',
  // BUILD_PLAN Phase 10 (Constitution 1 §3 / §7): every table has an ownership class + domain, tenant/branch columns match
  // the class, and the committed registry (apps/api/db/ownership/registry.generated.json) matches the migrated schema
  'db-ownership',
  // BUILD_PLAN Phase 10 (Constitution 1 §34/§55): every tenant table that tracks updated_at has updated_by (append-only
  // exempt), every deleted_at has deleted_by, and the actor-stamp plugin's generated column map matches the schema
  'actor-stamp',
  // BUILD_PLAN Phase 12 (Constitution 5 §47–§52): every list handler declares its allow-listed filters / sorts / range cap
  // (a ListQuerySpec run by the ListQueryInterceptor) or is allowlisted as not-a-list / fixed-size (only shrinks)
  'list-queries',
  // BUILD_PLAN Phase 12 (Constitution 5 §32–33): every export GET that builds a file is on the ONE async operation contract
  // (@AsyncExport → 202 + status URL, the api.export worker) or exempt with the reason it builds none (async-exports.exempt.json)
  'async-exports',
  // BUILD_PLAN Phase 12 (Constitution 5 §37/§138, #19): no whole-row or sensitive-column read reaches a response unreviewed
  // (reviewed list + per-file ratchets in response-exposure.allowlist.json; no response wire type carries a secret's name)
  'response-exposure',
  // BUILD_PLAN Phase 12 (Constitution 5 §158–166, #34): every upload route runs the ONE upload policy (@aipowersalon/media
  // upload-policy.ts — sniffed type, extensions, metadata strip, scan hook, tenant key, quota); interceptor caps are a policy's
  'uploads',
  // BUILD_PLAN Phase 12 (Constitution 5 §74–78, #27): a status write goes through its lifecycle's state machine (shrinking
  // baseline for the writers not yet moved), every machine state is in its CHECK, and no literal outside a CHECK is written
  'state-transitions',
  // BUILD_PLAN Phase 15 C (Constitution 1 §35): no unique index on a tenant table without tenant_id unless reviewed as global
  // by design in docs/UNIQUE_INDEX_TENANT_REVIEW.md (a value two salons could share is keyed (tenant_id, …))
  'unique-tenant-review',
  // ONE-PAY (Kevin, Oct 13 2026): ONE payroll calculation — no commission / earnings / tip-share arithmetic outside
  // modules/workforce/src/compensation + payroll (reviewed exceptions in apps/api/scripts/one-payroll-calculation.allowlist.json)
  'one-payroll-calculation',
  // Oct 14 build plan §33 (Oct 21 2026): ONE sales-tax helper (packages/money taxCents) — no tax arithmetic elsewhere
  'one-tax-calculation',
  // Oct 19 audit item (Oct 21 2026): a guard read fails CLOSED — no swallowed catch in guard code; a ratchet everywhere else
  'silent-catch',
  // Oct 14 build plan §234 (Oct 21 2026): `as any` per file may only shrink
  'as-any',
  // Oct 13 2026: the developer's Oct 6 tree hid an obfuscated payload in eslint.config.mjs and ran `node api.js` from the
  // root build/dev scripts — no hidden off-screen code, obfuscator identifiers, root-script runners, install hooks,
  // stray root scripts or editor auto-run tasks may land (apps/api/scripts/check-supply-chain-injection.mjs)
  'supply-chain-injection',
  // Security Deep Scan D5 (Oct 23 2026): every non-literal sql.raw/lit/ref/table/id / CompiledQuery.raw call site is reviewed
  'raw-sql-inputs',
  // Platform Architecture Audit §192 (Nov 5 2026): the egress gate — every raw network call in server code is reviewed
  // (outbound-requests.allowlist.json, with the reason it cannot reach an internal address); a URL a person typed goes
  // through safeOutboundRequest() (https only, DNS-checked against private ranges, no redirects)
  'outbound-requests',
  // Security Deep Scan §3 (Oct 23 2026): docs/security/SECURITY_ATTACK_SURFACE.md is generated from the route manifest and
  // must match it (regenerate with node apps/api/scripts/attack-surface.mjs after adding or changing a route)
  'attack-surface',
  // B-15 (Oct 20 2026): expand → backfill → contract is enforced, not only written in DEPLOYMENT.md — every destructive
  // migration statement (DROP TABLE / COLUMN, RENAME, SET NOT NULL, TYPE, copy-and-drop in one file, TRUNCATE / bare DELETE)
  // is reviewed per file in apps/api/db/migration-safety.allowlist.json; a DROP TABLE proves the table empty or archived
  'migration-safety',
];
// the type proof builds one TypeScript program per client project (nine) when a client file or a body schema changed
const GATE_TIMEOUT_MS = { 'strict-bodies-types': 1_800_000 };
const AUDITS = [
  // Constitution 13: the architecture tests (cycles, back-edges, mirrored API types, deep imports) — found six mirrored
  // types and a relative migrations path on Oct 3 2026 because this runner did not include them
  ['architecture tests', 'npm', ['run', '-s', 'architecture:test']],
  ['module entries', 'python3', ['tooling/modules/audit-entries.py']],
  ['spec imports', 'python3', ['tooling/modules/check-spec-imports.py']],
  // Sep 2026: a developer handoff hid malware in eslint.config.mjs behind thousands of tabs — no hidden code, no
  // over-long lines in files tools run automatically, no npm install scripts
  ['hidden code', 'python3', ['tooling/security/check-hidden-code.py']],
  // Constitution 3 / 12: no console output in sign-in/session code — three debug lines leaked identity data on Oct 3 2026
  ['auth logging', 'python3', ['tooling/security/check-auth-logging.py']],
  // Oct 6 2026: 35 files carried an outside database server's login, most as the silent default when DATABASE_URL was
  // unset — no real server address or database login is committed (scripts read DATABASE_URL and stop without it)
  ['db credentials', 'python3', ['tooling/security/check-db-credentials.py']],
  // Security Deep Scan A10/B15 (Oct 23 2026): the committed Android wrapper jar is an official Gradle build and every
  // wrapper pins its distribution checksum
  ['gradle wrapper', 'node', ['tooling/security/check-gradle-wrapper.mjs']],
  // Security Deep Scan §13: lockfile hygiene — registry-only sources + integrity, reviewed install scripts, typosquat-shaped
  // names, very new versions (publish age from the registry; SKIPPED offline, never a silent pass)
  ['lockfile hygiene', 'node', ['tooling/security/check-lockfile.mjs']],
  // Security Deep Scan §12: every literal outbound host in product code is in the reviewed allowlist
  ['outbound hosts', 'node', ['tooling/security/check-outbound-hosts.mjs']],
  // Oct 6 2026 (Phase 1): seven services wired the audit trail through `audit as any` and called record() with one object —
  // every one of their audits was silently dropped; audit handles are typed (AuditSink) and never cast away
  ['audit wiring', 'node', ['tooling/ci/check-audit-wiring.mjs']],
  // Oct 6 2026: six web apps no longer built for production while tsc and vitest stayed green — build every app
  ['frontend builds', 'node', ['tooling/ci/check-frontend-builds.mjs']],
  // Oct 6 2026: Vite builds strip types without checking them — admin-web's tsc had been failing unseen
  ['app types', 'node', ['tooling/ci/check-app-types.mjs']],
  // BUILD_PLAN Phase 13 B (Constitution 6 §55): each store app's Android versionName and iOS MARKETING_VERSION equal its package.json
  // version — the one version the app sends, the UPDATE_REQUIRED gate compares and Super Admin sees
  ['mobile versions', 'node', ['tooling/mobile/sync-versions.mjs', '--check']],
  // BUILD_PLAN Phase 13 D (Constitution 6 §137–138, §303; bugs 8 + 10): capacitor appId == Xcode == Gradle bundle id; release
  // Info.plist / AndroidManifest / network-security config allow no cleartext or arbitrary loads (debug-only escapes); backup off;
  // push / app-links / secure-storage / biometric plugins declared; no NEW signing key or provider config in an app tree
  ['mobile native config', 'node', ['tooling/mobile/check-native-config.mjs']],
  // BUILD_PLAN Phase 13 (C6 bug 12): a vi.mock of a module that no longer exists is silently virtual — the test stays green
  ['stale mocks', 'node', ['tooling/ci/check-stale-mocks.mjs']],
  // SCAN (Oct 12 2026): no control that looks live but does nothing (button with no handler, no-op handler, href="#",
  // pointer div with no click, controlled field that ignores input) — baseline only shrinks
  ['inert controls', 'node', ['tooling/ci/check-inert-controls.mjs']],
  // §220 (Oct 21 2026): a person-facing app never locks pinch-zoom (WCAG 1.4.4)
  ['zoom', 'node', ['tooling/ci/check-zoom.mjs']],
  // EN/VI dictionaries (incl. the POS ns/ namespace files): same keys, no empty Vietnamese, same {placeholders}
  ['i18n', 'node', ['tooling/ci/check-i18n.mjs']],
  // Vietnamese POS mandate WP-K (§24 / §99 / §123): POS English behind t() — tiers 1–3 must be 0; tier 4 (label maps, tuples,
  // rendered helper args, setX text, enum `.replace(/_/g,' ')`, raw status codes, import-time t()) ratcheted per file
  // (tooling/i18n/pos-i18n-baseline.json, only goes down); unused / duplicate namespace keys reported
  ['pos-i18n', 'node', ['tooling/ci/check-pos-i18n.mjs']],
  // Vietnamese POS mandate WP-D1 (§37): the glossary doc = ns/glossary; no forbidden Vietnamese variant in a POS catalogue
  ['vi-glossary', 'node', ['tooling/ci/check-vi-glossary.mjs']],
  // Vietnamese POS mandate §103 (WP-K): Super Admin stays English — no i18n runtime, no language switch, lang="en", no
  // Vietnamese text outside the reviewed announcement-authoring screen
  ['admin-english-only', 'node', ['tooling/ci/check-admin-english-only.mjs']],
  ['english-only-apps', 'node', ['tooling/ci/check-english-only-apps.mjs']],   // POSLanguage.pdf (Oct 28 2026): only the Front Desk POS is bilingual
];

const failed = [];
for (const g of GATES) {
  const r = spawnSync('npm', ['run', '-s', `check:${g}`], { cwd: API, encoding: 'utf8', timeout: GATE_TIMEOUT_MS[g] ?? 300_000 });
  const ok = r.status === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  check:${g}`);
  if (!ok) { failed.push(`check:${g}`); console.log(((r.stdout || '') + (r.stderr || '')).split('\n').filter(Boolean).slice(-6).map((l) => '      ' + l).join('\n')); }
}
for (const [name, cmd, args] of AUDITS) {
  // `app types` typechecks all seven SPAs (≈ 5.5 min on a loaded 2-core sandbox — it hit the 5-min cap in Phase 12); the rest keep 5 min
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: name === 'app types' ? 900_000 : 300_000 });
  const ok = r.status === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { failed.push(name); console.log((r.stdout || '').split('\n').filter(Boolean).slice(-6).map((l) => '      ' + l).join('\n')); }
}
console.log(failed.length ? `\n${failed.length} FAILED: ${failed.join(', ')}` : `\nall ${GATES.length} gates + ${AUDITS.length} audits passed`);
process.exit(failed.length ? 1 : 0);
