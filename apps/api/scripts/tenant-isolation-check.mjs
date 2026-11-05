// tenant-isolation-check.mjs — every query on a tenant-scoped table must carry tenant_id.
//
// ══ THE WORST BUG A MULTI-TENANT SAAS CAN HAVE ════════════════════════════════════════════════════════════
//
//     select * from customers where id = $1
//
// That is valid SQL. The table exists. The column exists. `check:sql` passes it. It compiles, it runs, it returns
// a row — and the row **may belong to another salon.**
//
// One missing `tenant_id` is not a broken feature. It is **Salon A reading Salon B's customers**, their phone
// numbers, their revenue, their appointments. It is the single failure that ends a SaaS business, and it is
// invisible to every other check in this repo:
//
//   • `tsc` cannot see it — it is a string.
//   • `check:sql` cannot see it — the statement is perfectly valid.
//   • `check:impossible` cannot see it — every literal can occur.
//   • The unit tests cannot see it — they mock the repository, and the mock returns whatever the test seeded.
//
// A test suite proves a query returns what you asked for. It cannot tell you the query was allowed to ask.
//
// ══ WHAT COUNTS AS SCOPED ═════════════════════════════════════════════════════════════════════════════════
//
// A query is safe if it carries `tenant_id` in the WHERE, or joins through a table that does. It is also safe if
// it is on a PLATFORM table (one with no tenant_id column at all — a plan catalogue, a country list), or if it is
// an INSERT (which supplies tenant_id in its values).
//
// Everything else is a query that could cross a tenant boundary, and each one is listed for a human to look at.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const API = resolve(new URL('..', import.meta.url).pathname);
const MIG = join(API, 'db/migrations');
const SRC = join(API, 'src');

/** The reviewed baseline keys on paths relative to apps/api/src. A file that moved into modules/<name>/src keeps its
 *  key as <name>/<file> (Constitution 13: the directory name became the module name), so a reviewed query stays
 *  reviewed after the move and only NEW unscoped queries fail the build. */
function relKey(file) {
  if (file.startsWith(SRC + '/')) return file.replace(SRC + '/', '');
  // A FLAT module (one directory) keys <module>/<file> — the directory became the module name. A GROUPED module keeps
  // each API directory as a sub-folder (modules/<m>/src/<dir>/<file>), so its key is <dir>/<file>: exactly the
  // apps/api/src-relative key the reviewed baseline was written against.
  const m = /\/modules\/([^/]+)\/src\/(.+)$/.exec(file);
  if (m) return m[2].includes('/') ? m[2] : `${m[1]}/${m[2]}`;
  const p = /\/packages\/([^/]+)\/src\/(.+)$/.exec(file);
  return p ? `packages/${p[1]}/${p[2]}` : file;
}


// Constitution 13: domain modules live in modules/*/src and are part of the API's surface — a gate that walked only
// apps/api/src would lose sight of a controller or repository the moment it moved. Every root is walked.
const MODULE_SRC_ROOTS = (() => { const d = new URL('../../../modules', import.meta.url).pathname; try { return readdirSync(d).map((m) => `${d}/${m}/src`).filter((p) => existsSync(p)); } catch { return []; } })();
// ...and the workspace packages apps/api depends on (its package.json), minus the modules above: code the API runs is
// walked wherever it lives (Constitution 13). A package that reads tenant tables is scanned like any repository.
const PACKAGE_SRC_ROOTS = (() => { try { const deps = Object.keys(JSON.parse(readFileSync(new URL('../package.json', import.meta.url).pathname, 'utf8')).dependencies ?? {}); const p = new URL('../../../packages', import.meta.url).pathname; return deps.filter((x) => x.startsWith('@aipowersalon/')).map((x) => `${p}/${x.slice('@aipowersalon/'.length)}/src`).filter((x) => existsSync(x)); } catch { return []; } })();


// ── which tables ARE tenant-scoped? ─────────────────────────────────────────────────────────────────────
const tenantScoped = new Set();
const allTables = new Set();

for (const f of readdirSync(MIG).filter((x) => x.endsWith('.sql')).sort()) {
  const sql = readFileSync(join(MIG, f), 'utf8');
  const re = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-z0-9_]+)\s*\(([\s\S]*?)\n\s*\);/gi;
  let m;
  while ((m = re.exec(sql))) {
    const t = m[1].toLowerCase();
    allTables.add(t);
    if (/^\s*tenant_id\s/im.test(m[2])) tenantScoped.add(t);
  }
  // a tenant_id added later
  const alt = /ALTER TABLE\s+([a-z0-9_]+)\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+tenant_id/gi;
  while ((m = alt.exec(sql))) tenantScoped.add(m[1].toLowerCase());
}

// ── scan every raw SQL statement ────────────────────────────────────────────────────────────────────────
const codeLines = (s) =>
  s.split('\n').filter((l) => {
    const t = l.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  }).join('\n');

function walk(d, acc = []) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(p)) acc.push(p);
  }
  return acc;
}

// ── classify PER FILE, not per directory. My second version got this badly wrong. ───────────────────────
//
// I marked a whole MODULE as super-admin if any controller in its directory used SuperAdminGuard.
//
// `customer-phone/` has exactly one such controller — the oversight endpoint. So **every query in the entire
// module got a free pass**, including the customer lookup. I deleted the tenant scope from
// `select ... from customers where id = $customerId` — a textbook cross-tenant read of another salon's customer —
// and the checker waved it through.
//
// **A module with one super-admin controller was exempting all of its tenant queries.** That is not a strict
// checker with a blind spot; it is a checker that would have missed the exact bug it exists for.
//
// So: a FILE is super-admin only if the file ITSELF is — its path says so, or it carries the guard. A repository
// does not inherit an exemption from a controller that happens to sit beside it.
const superAdminFiles = new Set();
for (const f of [SRC, ...MODULE_SRC_ROOTS, ...PACKAGE_SRC_ROOTS].flatMap((r) => walk(r))) {
  const t = readFileSync(f, 'utf8');
  if (/SuperAdminGuard/.test(t)) superAdminFiles.add(f);
}
const moduleIsSuperAdmin = (file) => superAdminFiles.has(file) || /super-admin|super_admin/i.test(file);

// ── the EXPLICIT exemption ──────────────────────────────────────────────────────────────────────────────
//
// Every heuristic I tried for "this query is allowed to be cross-tenant" was wrong, and each was wrong in the
// direction that HIDES a leak:
//
//   • by file path      → missed `ai-business-admin`, which is genuinely super-admin
//   • by directory      → **exempted every query in customer-phone/ because ONE controller there is super-admin.**
//                          I then deleted the tenant scope from a customer lookup and the checker waved it through.
//
// So stop inferring it. **Make the author write it down.**
//
// A file that legitimately queries across tenants — a platform sweep, a Super Admin aggregate, the central
// identity table that is cross-tenant BY DEFINITION — declares it:
//
//     // CROSS-TENANT BY DESIGN: <why>
//
// It costs one line, it is reviewable in a diff, and it cannot be granted by accident to a file that just happens
// to sit next to one.
const declaredCrossTenant = (src) => /CROSS-TENANT BY DESIGN/i.test(src);

const risky = [];
let checked = 0;

for (const file of [SRC, ...MODULE_SRC_ROOTS, ...PACKAGE_SRC_ROOTS].flatMap((r) => walk(r))) {
  const rawSrc = readFileSync(file, 'utf8');
  const src = codeLines(rawSrc);

  // ── capture the WHOLE template, including NESTED ones ───────────────────────────────────────────────
  //
  // A non-greedy /sql`([\s\S]*?)`/ stops at the FIRST backtick — and these queries contain nested templates:
  //
  //     sql`... set updated_at = ${sql`now()`} where id = ${id} and tenant_id = ${ctx.tenantId}`
  //                                    ↑ the capture ended HERE
  //
  // So it saw only the first fragment, never reached `tenant_id`, and reported PROPERLY SCOPED queries as tenant
  // leaks. The inventory product lookup — `WHERE id = $1 AND tenant_id = $2` — was flagged as a cross-tenant read.
  //
  // A checker that cries wolf about a data leak is the worst kind: it is the one report nobody can afford to
  // ignore, and the fastest way to teach them to.
  const starts = [...src.matchAll(/\bsql(?:<[^>]*>)?`/g)];
  const templates = [];
  for (const st of starts) {
    let i = st.index + st[0].length;
    let depth = 0;
    let out = '';
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '\\') { i++; continue; }
      // Keep a `$` marker so `where id = ${id}` still LOOKS like a parameterised lookup — blanking it entirely
      // broke the primary-key classifier and dropped 11 low-risk queries into the alarm bucket.
      //
      // And keep the interpolated TEXT, because `${ctx.tenantId}` is exactly where the tenant scope often lives.
      if (c === '$' && src[i + 1] === '{') { depth++; i++; out += '$'; continue; }
      if (depth > 0) {
        if (c === '{') depth++;
        else if (c === '}') { depth--; continue; }
        out += c;
        continue;
      }
      if (c === '`') break;
      out += c;
    }
    templates.push(out);
  }

  for (const t of templates) {
    const q = t.replace(/--[^\n]*/g, ' ');
    const flat = q.replace(/\s+/g, ' ').trim();
    if (!flat) continue;

    // INSERTs carry tenant_id in their VALUES, not a WHERE. And a query with no table is not a query.
    if (/^insert\b/i.test(flat)) continue;

    // Which tenant-scoped tables does it touch?
    const touched = new Set();
    for (const t of flat.matchAll(/\b(?:from|join|update)\s+([a-z_][a-z0-9_]*)/gi)) {
      const tbl = t[1].toLowerCase();
      if (tenantScoped.has(tbl)) touched.add(tbl);
    }
    if (!touched.size) continue;      // platform tables only — nothing to leak

    checked++;

    // Is it scoped? tenant_id anywhere in the statement is the signal — in a WHERE, a JOIN condition, or a CTE.
    const scoped = /\btenant_id\b/i.test(flat);
    if (scoped) continue;

    // ── is this module SUPER-ADMIN? ─────────────────────────────────────────────────────────────────────
    //
    // Cross-tenant is legitimately the job for a super-admin surface — `ai-business-admin` literally counts
    // `DISTINCT tenant_id`, which is the point of it.
    //
    // My first version decided this from the FILE PATH, and got it wrong: `ai-business/` is not called
    // "super-admin", so its admin repository was flagged as a tenant leak. The thing that actually decides is the
    // GUARD on the controller — so that is what is read.
    const superAdmin = moduleIsSuperAdmin(file) || declaredCrossTenant(rawSrc);

    // ── I GOT THIS WRONG THE FIRST TIME, AND THE MISTAKE MATTERED ────────────────────────────────────────
    //
    // I originally treated `where id = $1` as SAFE — "the id was fetched under tenant scope, so it is fine."
    //
    // **That is false, and it is false for the single most common leak shape there is:**
    //
    //     GET /customers/:customerId   →   select * from customers where id = $customerId
    //
    // The id comes from the URL. **An attacker chooses it.** Without `tenant_id` that query returns ANOTHER
    // SALON'S CUSTOMER — their phone number, their history, their spend.
    //
    // I proved the flaw by deleting the tenant scope from a real customer lookup. My checker waved it through.
    //
    // So a primary-key lookup is NOT a safe class. It is only safe for a WRITE whose id was demonstrably read under
    // scope moments earlier — and even then it is worth a human eye. A SELECT by id with no tenant is a leak until
    // proven otherwise.
    const isRead = /^\s*(select|with)\b/i.test(flat);
    const byPrimaryKey = !isRead && /\bwhere\s+(?:[a-z_]+\.)?id\s*=\s*\$/i.test(flat);

    risky.push({
      file: relKey(file),
      tables: [...touched].join(', '),
      sql: flat.slice(0, 100),
      superAdmin,
      byPrimaryKey,
    });
  }
}

const crossTenantByDesign = risky.filter((r) => r.superAdmin);
const byPk = risky.filter((r) => !r.superAdmin && r.byPrimaryKey);
// Pre-tenant-context by nature: at LOGIN you look somebody up by email, phone, or session token — you do not yet
// know their tenant, because deciding it is the whole point of logging in. Scoping these by tenant would be
// circular.
const preAuth = risky.filter((r) => !r.superAdmin && !r.byPrimaryKey && /^auth\//.test(r.file));
const tenantLeaks = risky.filter((r) => !r.superAdmin && !r.byPrimaryKey && !/^auth\//.test(r.file));

console.log(`tenant-scoped tables: ${tenantScoped.size} of ${allTables.size}`);
console.log(`queries touching them: ${checked}`);
console.log(`  scoped by tenant_id:  ${checked - risky.length}`);
console.log(`  NOT scoped:           ${risky.length}`);
console.log(`     super-admin (cross-tenant IS the job):  ${crossTenantByDesign.length}`);
console.log(`     by PRIMARY KEY (id fetched under scope): ${byPk.length}`);
console.log(`     pre-auth (no tenant known yet):          ${preAuth.length}`);
console.log(`     ── genuinely unscoped:                    ${tenantLeaks.length}`);

// ── the reviewed baseline ───────────────────────────────────────────────────────────────────────────────
//
// These files were read, line by line, and each scopes TRANSITIVELY rather than explicitly:
//
//   memberships              WHERE plan_id = $x            — plan_id is a tenant-owned FK, fetched under scope
//   promotions               WHERE promotion_id = $x       — same
//   notifications            WHERE provider_id = $x        — a Twilio message SID, globally unique to the provider
//   messaging-inbound        WHERE account_sid = $x        — the PUBLIC webhook. Resolving the tenant FROM the SID
//                                                            is not a bug, it is the ONLY correct pattern: the
//                                                            caller is Twilio, there is no session, and a tenant id
//                                                            taken from the request would be one an ATTACKER
//                                                            CHOOSES.
//   customer-activation      WHERE id = $x                 — a uuid fetched under scope
//   customer-identity        WHERE fingerprint = $x        — customer_identity_conflicts is the PLATFORM-LEVEL
//                                                            dedupe queue (tenant_id nullable: SYNC_MISSED etc.).
//                                                            The fingerprint EMBEDS the tenant+customer for
//                                                            tenant-scoped kinds, and the only callers are the
//                                                            reconciliation engine (server-side, no client input)
//                                                            and the Super Admin surface — cross-tenant IS the job.
//   ai-subscription-billing, ai-money-protection, customer-security, voice-booking — the same shapes
//   deals (marketplace)      WHERE deal_id / user_id       — the Deals Marketplace is a CROSS-TENANT storefront by
//                                                            design: customers browse, save and redeem deals from
//                                                            ANY salon. Each flagged query is one of five safe shapes:
//                                                            (a) a deal_services read reached ONLY after the deal is
//                                                            loaded under `WHERE tenant_id=ctx AND id` (getDeal /
//                                                            listDeals / transitionStatus) — transitively scoped;
//                                                            (b) a reserveHold capacity op inside a per-deal
//                                                            advisory-lock txn whose INSERT takes tenant_id FROM the
//                                                            deal row, never the client; (c) a recordRedemption
//                                                            idempotency probe on (appointment_id, deal_id) whose
//                                                            write is ctx-scoped; (d) user-scoped deal_saves keyed by
//                                                            the GLOBAL user_id (a caller only ever touches their OWN
//                                                            row); or (e) the marketplaceOverview / listAllDeals
//                                                            aggregates, reachable ONLY via DealsSuperAdminController
//                                                            (SuperAdminGuard) — cross-tenant IS the job there.
//
// **No confirmed cross-tenant leak.** But "reviewed once" is not protection: transitive scoping is only safe while
// the id is obtained under scope, and the next person to add a query here will not know that.
//
// So the baseline is frozen. Anything NEW that is unscoped fails the build, and has to be looked at.
const BASELINE = new Set([
  'technicians/revoke-technician-access.ts',   // Technician Profile merge (WF, reviewed Oct 12 2026): the ONE revocation chain. With a tenantId every write is `and tenant_id = ${tenantId}` (a conditional sql fragment this scan cannot read); tenantId NULL is ONLY the Super Admin platform path (GlobalTechAdminService suspend/lock/revoke-sessions/restore — SuperAdminGuard + elevation), which cuts / restores EVERY salon login of one global_tech_profile_id by design. No id from a request body.
  'account/language.controller.ts',   // BUILD_PLAN Phase 13 E (C6 §97–99; reviewed Oct 9 2026): users.preferred_language is read / written ONLY by the session's own user id (`where id = ${ctx.userId}` — the login row IS the scope; a customer's row has no tenant), and the branch time-zone read IS tenant-scoped (`b.tenant_id = ${ctx.tenantId}`). No id comes from the request.
  'common/async-export/operations-expiry.repository.ts',   // BUILD_PLAN Phase 12 (Constitution 5 §33; reviewed Oct 8 2026): the api.operations.expire tick deletes EVERY salon's expired export files and marks those rows expired — cross-salon by design, counts only, no HTTP path. Every other api_operations query (operations.repository.ts) names the salon.
  'packages/database/job-queue.ts',   // BUILD_PLAN Phase 2 (reviewed Oct 7 2026): the ONE job queue is a platform table — the WORKER claims due jobs across all salons (FOR UPDATE SKIP LOCKED, with a per-tenant cap so one salon cannot take every worker), reaps expired leases and counts per class; tenant_id on each job names the salon it works FOR and is handed to the handler, which loads through tenant-scoped repositories. The only HTTP path is JobsController (SuperAdminGuard + super_admin.system_operations.view / system.manage) — cross-tenant IS the job there, and it never returns payload values.
  'oauth/oauth.service.ts',   // Constitution 3 Step 10d (reviewed Oct 4 2026): the token endpoint finds the grant BY its credential — sha256(one-time code) or sha256(refresh token), both unique — because the partner app has no salon session; the grant row then supplies the tenant. Owner-facing reads/revokes (listGrants / revokeGrant) are WHERE tenant_id = ctx.
  'legal-hold/legal-hold.kysely.repository.ts',   // Constitution 13 (reviewed Sep 23 2026): getHold(id) / listHolds(scope) are reached ONLY from super-admin-customer-data (SuperAdminGuard; cross-tenant IS the job — the list takes an optional tenant filter). Exempt by PATH until the move out of super-admin-customer-data/; the tenant path (customer reconciliation's assertDeletable) uses activeHoldsForCustomer, which IS tenant-scoped and is not flagged.
  'sms-packages/sms-billing.service.ts',   // SA-only §47/§22-§24 rollups: aggregates across ALL tenants by design behind sms_billing.view (reviewed Jul 29 2026)
  'sms-packages/sms-reconciliation.service.ts',   // SA-only nightly job: scans ALL tenants' cycles by design; findings reviewed by SuperAdmin behind sms_usage.view (reviewed Jul 29 2026)
  'events/event-replay.service.ts',   // Constitution 8 §45-47: the processed_events lookup is keyed on (consumer_name, event_id) — its PRIMARY KEY, which has no tenant column by design (§23). The event ids it counts come from a query already filtered to ONE tenant (§46), so the count cannot span tenants. Everything else in this service filters by tenant_id. (reviewed Sep 19 2026)
  'observability/sync-reconciliation.ts',   // Smooth Refresh spec §34-§39: platform reconciliation job — releases EXPIRED booking holds (through the booking module's own sweep, WHERE released_at IS NULL AND expires_at <= now), counts pending outbox rows and ACTIVE (tenant, branch) scopes across all tenants by design; returns counts only, never rows; no HTTP path. (reviewed Sep 30 2026)
  'observability/queue-metrics.ts',   // BUILD_PLAN Phase 14 B (C11 metrics; reviewed Oct 9 2026): the /metrics queue gauges count outbox_events by publish_status and open/retrying event_dead_letters across ALL tenants by design — COUNTS ONLY (no rows, no tenant ids, no payloads), refreshed by the process metrics tick; the only HTTP reader is /metrics (metrics token) and the Super Admin dashboards behind super_admin.system_operations.view.
  'common/code-lookup-limit.store.ts',   // BUILD_PLAN Phase 14 D (C12 per-caller code-lookup limit; reviewed Oct 9 2026): the gift-card / coupon guessing limiter counts weighted failures PER CALLER (user / device) and PER IP across salons on purpose — a guesser rotating salons must still be stopped — plus per tenant; it returns only a retry-after duration, never rows. No id from the request reaches another salon's data.
  'events/event-retention.ts',   // Constitution 8 §97-99: platform retention job deletes PUBLISHED outbox rows / aged processed_events / closed dead letters across ALL tenants by design; no HTTP path. (reviewed Sep 18 2026)
  'events/event-ops.service.ts',   // Constitution 8 §150-155: SUPER ADMIN event operations — outbox health, dead letters and correlation search across ALL tenants is the job, behind SuperAdminGuard + super_admin.events.* permissions; tenantId is an optional narrowing filter. (reviewed Sep 18 2026)
  'common/step-up.ts',   // Constitution 7 §8: step-up re-reads the SIGNED-IN user's own row (users / mfa_factors / sessions by user_id + that session's id) — a person's own credentials, not salon data; platform accounts have no tenant. (reviewed Sep 27 2026)
  'common/platform-lockdown.ts',   // Constitution 12 M13: the PLATFORM emergency lockdown revokes every non-SUPER_ADMIN session across ALL tenants -- by design, the one intended platform-wide write; reachable only through LockdownService.execute after propose -> confirm (step-up) by a Super Admin. The read is a single flag.
  'common/security-posture.ts',   // Constitution 12 section 270: SUPER ADMIN Security Center panel -- counts of security_events by severity/type across the platform, COUNTS ONLY (no rows, no tenant data), reachable only via SecurityService behind SuperAdminGuard. Cross-tenant IS the job.
  'events/outbox-publisher.ts',   // Constitution 8 §20-21: the outbox PUBLISHER is a platform worker that must claim EVERY tenant's pending events (FOR UPDATE SKIP LOCKED) and reap stale claims; tenant scoping lives in the CONSUMER runner (§13-14: tenant_id is mandatory on the envelope and handlers load through tenant-aware repos). No HTTP path reaches these queries. (reviewed Sep 18 2026)
  'sms-packages/sms-packages.service.ts',   // SA-only package list: tenant_count aggregates ACROSS tenants by design (SuperAdminGuard + granular perm; reviewed Jul 29 2026)
  'customer-identity/customer-identity.repository.ts',
  'ai-business/ai-business-admin.kysely.repository.ts',
  'ai-money-protection/ai-money-protection.kysely.repository.ts',
  'ai-voice-transcription/ai-voice-transcription.kysely.repository.ts',
  'ai/ai-subscription-billing.repository.ts',
  'communications/communications-overview.kysely.repository.ts',
  'communications/communications-providers.kysely.repository.ts',
  'customer-activation/customer-activation.repository.ts',
  'customer-security/customer-security.controller.ts',
  'deals/deals.kysely.repository.ts',
  'hardware-payment/hardware-payment.kysely.repository.ts',
  'help/support-attachments.service.ts',
  'help/support-tickets.service.ts',
  'memberships/memberships.kysely.repository.ts',
  'messaging-inbound/twilio-inbound.service.ts',
  'nail-showcase/nail-showcase-social.kysely.repository.ts',
  'notifications/notifications.kysely.repository.ts',
  'promotions/promotions.kysely.repository.ts',
  'tenant-safety-community/community.repository.ts',
  'voice-booking/voice-key.kysely.repository.ts',
]);

const newLeaks = tenantLeaks.filter((r) => !BASELINE.has(r.file));

if (newLeaks.length) {
  console.log(`\n${'='.repeat(100)}`);
  console.log(`NEW UNSCOPED TENANT QUERIES: ${newLeaks.length}`);
  console.log('='.repeat(100));
  console.log('\nThese are NOT in the reviewed baseline. Each could return ANOTHER SALON\'s rows.\n');
  for (const r of newLeaks) {
    console.log(`  ${r.file}`);
    console.log(`     tables: ${r.tables}`);
    console.log(`     ${r.sql}\n`);
  }
  console.log('Add tenant_id to the WHERE, or — if it is genuinely scoped some other way — review it and baseline it.');
  process.exit(1);
}

console.log(`\nOK — no NEW unscoped tenant queries.`);
console.log(`   ${tenantLeaks.length} in the reviewed baseline (transitively scoped — see the note in this file)`);
console.log(`   ${crossTenantByDesign.length} in super-admin code, where cross-tenant IS the job`);
process.exit(0);

if (tenantLeaks.length) {
  console.log(`\n${'='.repeat(100)}`);
  console.log(`UNSCOPED TENANT QUERIES OUTSIDE SUPER-ADMIN: ${tenantLeaks.length}`);
  console.log('='.repeat(100));
  console.log('\nEach of these could return another salon\'s rows. Verify each one carries its tenant some other way');
  console.log('(a repository-level scope, a joined table, a caller-supplied filter) — or fix it.\n');
  for (const r of tenantLeaks) {
    console.log(`  ${r.file}`);
    console.log(`     tables: ${r.tables}`);
    console.log(`     ${r.sql}`);
    console.log('');
  }
  process.exit(1);
}

console.log('\nOK — every tenant-scoped query outside super-admin carries tenant_id.');
if (crossTenantByDesign.length) {
  console.log(`(${crossTenantByDesign.length} unscoped queries live in super-admin/platform code, where cross-tenant IS the job.)`);
}
process.exit(0);
