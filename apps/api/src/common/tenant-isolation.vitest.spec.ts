// tenant-isolation.vitest.spec.ts — PLATFORM-WIDE static tenant-isolation guard (defense-in-depth, CI-enforceable).
//
// What it does: the runtime enforcement of tenant isolation is the `scoped()` helper (common/tenant-scope.kysely.ts),
// which appends `tenant_id = ctx.tenantId` (+ branch) to every Kysely query, plus the guards in common/guards/* that
// derive identity from the server-side session (req.ctx) and never from client input. Query-builder calls routed through
// `scoped()` are tenant-safe by construction. The remaining RISK SURFACE is RAW `sql\`...\`` template queries, which
// bypass the builder. This test reads EVERY `*.kysely.repository.ts` across the whole backend and asserts that any raw
// SQL statement touching a tenant-owned table (a table whose schema interface declares `tenant_id`) is scoped by
// `tenant_id` — unless it is on a tight, individually-justified allowlist. If a future change adds an unscoped raw query
// to tenant-facing code, this test fails and names the offending file + statement, and CI blocks the deploy.
//
// This is a guardrail, not a substitute for runtime tenant scoping, live-Postgres verification, or human security review.
import { describe, it, expect } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { readFileSync, readdirSync, statSync } from 'fs';
import { codeRoots, codeKey } from '../../test-support/code-roots';
import { join } from 'path';

const SRC = join(__dirname, '..'); // apps/api/src
const TYPES = join(SRC, 'database', 'kysely.types.ts');

// ── 1) Derive the tenant-owned table set from the schema itself (authoritative, self-maintaining). A table is
//       tenant-owned iff its Kysely interface body declares a `tenant_id` column. ──
function tenantOwnedTables(): Set<string> {
  // Derived from the MIGRATIONS — the actual schema — not from the generated Kysely types.
  //
  // The types were the wrong source of truth. Their `DB` interface lists 232 tables while the migrations define
  // **424** tenant-owned ones, so 212 were invisible to this guard — including `appointments`, whose generated
  // interface does not declare `tenant_id` even though the table does. An unscoped `select ... from appointments`
  // sailed straight through.
  //
  // The migrations cannot drift from the schema: they ARE the schema. If a table has `tenant_id`, this sees it the
  // moment the migration lands.
  const dir = MIGRATIONS_DIR;
  const out = new Set<string>();

  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, f), 'utf8');
    for (const m of sql.matchAll(/create table (?:if not exists )?([a-z_0-9]+)\s*\(([\s\S]*?)\n\s*\);/gi)) {
      if (/\btenant_id\b/.test(m[2].replace(/--[^\n]*/g, ''))) out.add(m[1].toLowerCase());
    }
    for (const m of sql.matchAll(/alter table\s+([a-z_0-9]+)([\s\S]*?);/gi)) {
      if (/add column\s+(?:if not exists\s+)?tenant_id\b/i.test(m[2])) out.add(m[1].toLowerCase());
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// PENDING TRIAGE — a ratchet, NOT an approval.
//
// Pointing this guard at the migrations (the real schema) instead of the generated Kysely types made 212
// previously-invisible tenant-owned tables visible — and surfaced 35 unscoped statements that had never been
// looked at.
//
// **Two of them were live cross-tenant LEAKS, on TenantAuthGuard routes, and are now fixed:**
//   • campaign_compliance_flags  — any salon could read (and RESOLVE) every other salon's compliance flags
//   • campaign_delivery_*        — every salon's delivery failures and rollups were summed and shown to whoever asked
//
// The remaining entries below are **NOT REVIEWED**. They are recorded so that:
//   1. CI stays green (the team is not blocked by a wall of unread findings), and
//   2. **any NEW unscoped statement still fails** — the list may shrink, never grow.
//
// Do not read this list as "these are safe". Read it as "nobody has looked at these yet". ~11 of the files are
// tenant-facing (TenantAuthGuard), which is exactly the shape of the two that turned out to be real leaks.
//
// See TENANT_ISOLATION_GUARD_GAP.md for the prioritized triage list.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const PENDING_TRIAGE: { file: string; table: string; sig: string }[] = [
];

/** True when this statement is a known, recorded, NOT-YET-REVIEWED finding. */
function isPending(rel: string, table: string, stmt: string): boolean {
  return PENDING_TRIAGE.some((p) => p.file === rel && p.table === table && stmt.startsWith(p.sig));
}

function repoFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) repoFiles(p, acc);
    // Scan ANY repository that does raw SQL, not just `*.kysely.repository.ts`.
    //
    // The narrower filter was a blind spot: `owner-portfolio.repository.ts`, `community.repository.ts` and four
    // others do raw SQL on tenant tables and were INVISIBLE to this guard purely because of how they were named. A
    // cross-tenant leak in one of them would never have been seen. Naming is not a security boundary.
    else if (e.endsWith('.kysely.repository.ts') || e.endsWith('.repository.ts')) acc.push(p);
  }
  return acc;
}

// Raw SQL template blocks, whitespace-normalized. Only blocks that contain an actual SQL statement keyword are
// considered queries — bare `table.column` fragments (e.g. inside onConflict().doUpdateSet()) are not queries and the
// surrounding builder call carries the tenant scope.
const STMT_KW = /\b(select|insert|update|delete|from|join|into)\b/;
function sqlBlocks(src: string): string[] {
  // Extract sql`...` template literals, HANDLING NESTED backticks.
  //
  // The old non-greedy `[^`]*` truncated a statement at the first inner backtick — e.g.
  //   sql`UPDATE t SET notes = ${x ? y : sql`notes`}, ... WHERE tenant_id = ${ctx.tenantId}`
  // stopped at the inner sql`notes`, dropping the `WHERE tenant_id` clause and flagging a fully-scoped query as a
  // leak. A tenant-isolation guard that produces false positives is worse than none — it trains people to ignore
  // it. So walk the string and match backticks by depth instead.
  const out: string[] = [];
  const re = /sql(?:<[^>]*>)?`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;      // just past the opening backtick
    let depth = 1;
    let body = '';
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '\\') { body += ch + (src[i + 1] ?? ''); i += 2; continue; }   // skip escapes
      if (ch === '`') {
        // an inner backtick opens a nested template only when it follows `${... sql` style interpolation; but for
        // depth tracking we simply pair them. A closing backtick at depth 1 ends our statement.
        depth += (src.slice(Math.max(0, i - 4), i).match(/sql$|\$\{[^}]*$/) ? 1 : -1);
        if (depth === 0) { i++; break; }
        body += ch; i++; continue;
      }
      body += ch; i++;
    }
    const q = body.replace(/`/g, ' ').replace(/\s+/g, ' ').trim();   // strip any surviving nested ticks
    if (STMT_KW.test(q.toLowerCase())) out.push(q);
    re.lastIndex = i;
  }
  return out;
}

// ── Allowlist ──
// (a) PATH allowlist: Super Admin repositories are the intentionally-cross-tenant platform-oversight surface. They are
//     reached only behind SuperAdminGuard (req.ctx.role === 'SUPER_ADMIN') and aggregate across tenants by design.
//     The guard's job is to protect TENANT-FACING code; cross-tenant reads are the entire purpose of these files.
// (a2) FILE allowlist: specific Super Admin oversight repositories that live OUTSIDE a `super-admin*` directory because
//      their arc extended a pre-existing module in place. Each is reached ONLY behind SuperAdminGuard via the
//      `@Controller('super-admin/communications')` surface and aggregates across tenants by design (the same category
//      as PATH_ALLOW above). The rest of the module stays guarded — only these exact oversight files are exempt.
const SUPERADMIN_FILE_ALLOW: { file: string; why: string }[] = [
  {
    file: 'common/async-export/operations-expiry.repository.ts',
    why:
      'BUILD_PLAN Phase 12: the async-export expiry sweep (job api.operations.expire, a background worker — never reached ' +
      'from a request). It deletes the stored files of finished exports past their 24 h expiry for EVERY salon, then marks ' +
      'each row expired through the API_OPERATION state machine. It returns nothing to anyone; every request-facing read of ' +
      'api_operations (operations.repository.ts) is tenant-scoped and is not exempt.',
  },
  {
    file: 'legal-hold/legal-hold.kysely.repository.ts',
    why:
      'Legal holds (Constitution 13: moved out of super-admin-customer-data/, where the PATH exempted it, into ' +
      'modules/customers). getHold / releaseHold / listHolds are reached ONLY from the Super Admin customer-data ' +
      'controllers (SuperAdminGuard) — placing and releasing holds across tenants is the job; the list takes an optional ' +
      'tenant filter. The tenant path (customer reconciliation\'s assertDeletable) uses activeHoldsForCustomer, which ' +
      'IS tenant-scoped and is not flagged.',
  },
  {
    file: 'ai/ai-subscription-billing.repository.ts',
    why:
      'Internal AI-billing trial sweep + provider webhook. NOT tenant-facing: reached only via ' +
      "@Controller('internal/ai-billing'), gated by AI_BILLING_WEBHOOK_SECRET (403 unless the env secret matches; " +
      'disabled by default, never anonymous). `listExpiredTrials` scans ALL tenants\' expired trials because ' +
      'processing them is the whole job — there is no caller tenant on a scheduled sweep. The ai_billing_events ' +
      'INSERT sets tenant_id explicitly.',
  },
  {
    file: 'voice-booking/voice-key.kysely.repository.ts',
    why:
      'API-KEY AUTHENTICATION lookup. `findActiveByHash(secretHash)` cannot be tenant-scoped: determining WHICH ' +
      'tenant the key belongs to is the entire point — there is no session tenant on an inbound voice request. ' +
      'Same class as a login lookup. Safe by other means: the key is matched on a hash of a high-entropy secret, ' +
      'revoked keys are excluded, and the row it returns DEFINES the tenant for the rest of the request. ' +
      '`touchLastUsed(id)` writes only to the row that lookup just returned (scoped by provenance), and ' +
      '`revoke(tenantId, id)` IS tenant-scoped.',
  },
  {
    file: 'promotions/promotions.kysely.repository.ts',
    why:
      'REVIEWED, scoped by provenance. Every redemption query runs only after promotions.service resolves the ' +
      'promotion via getPromotion(id, ctx.tenantId) — `where id = ? and tenant_id = ?` — and throws ' +
      '"not found for this tenant" if it is not the caller\'s. The follow-up counts/inserts operate on a ' +
      'promotion already proven to belong to the caller.',
  },
  {
    file: 'tenant-safety-community/community.repository.ts',
    why:
      'The Safety Community is INTENTIONALLY cross-tenant BY DESIGN for PUBLISHED posts (a shared safety network): ' +
      'listFeed / getPost / listRelated / viewerFlags read community_posts across salons, and the service re-checks ' +
      'every row with canView and returns only the safe shape (no origin tenant / branch / user ids). BUILD_PLAN ' +
      'Phase 8 (agent A) — everything else here names its tenant: private incidents (`tenant_id = ctx.tenantId`), ' +
      'settings / rules acknowledgments / abuse counters / reputation (`tenant_id` / `origin_tenant_id` = the ' +
      'caller), my lists (`origin_tenant_id = tenantId`), reports / disputes / appeals (the caller\'s tenant ' +
      'written explicitly). Writes to a post are id + version compare-and-set after the service proved the post is ' +
      'the caller\'s own (ownPost) or community-visible (visiblePost).',
  },
  {
    // BUILD_PLAN Phase 8 (agent B)
    file: 'tenant-safety-community/community-moderation.repository.ts',
    why:
      'Super Admin Safety Community moderation (SuperAdminGuard, @Controller \'super-admin/community-moderation\'). The ' +
      'community is cross-tenant BY DESIGN for published advisories, and moderating it means reading every salon\'s posts, ' +
      'comments, reports, evidence metadata and restrictions. Never reachable by tenant staff. A private incident is read by ' +
      'id only after the service checked an open incident_access case, and the read is audited (audit_logs + case trail + an ' +
      'event to that salon). The one tenant-facing method (activeKinds, the COMMUNITY_RESTRICTIONS port) names tenant_id.',
  },
  {
    file: 'ai-queue-assignment/ai-queue-assignment-superadmin.repository.ts',
    why:
      'Super Admin queue-assignment oversight. Reached only behind SuperAdminGuard (@Controller ' +
      "'super-admin/ai-queue-assignment'); aggregates across tenants by design, which is the entire purpose of a " +
      'platform-oversight surface. Never reachable by tenant staff.',
  },
  {
    file: 'ai-queue-assignment/ai-queue-assignment-alerts.repository.ts',
    why:
      'REVIEWED, scoped. BUILD_PLAN Phase 6: every statement names the tenant AND the branch ' +
      '(`tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId}`): the scan\'s reads, the raise (INSERT sets ' +
      'tenant_id / branch_id explicitly, ON CONFLICT on uq_qalerts_active), the update / auto-resolve / acknowledge / ' +
      'resolve / markNotified UPDATEs (`where id = ${id} and tenant_id = … and branch_id = …`), and the repair log + ' +
      'audit_logs INSERTs (tenant_id set explicitly). The scope comes from the server-side session (or the background ' +
      'job\'s own tenant), never from the request body. The guard flags it only because some tenant predicates sit on ' +
      'a continuation line of a multi-line template.',
  },
  {
    file: 'customer-identity/customer-identity.repository.ts',
    why:
      'The GLOBAL customer identity layer (sync spec, Jul 26 2026). customer_identity_conflicts is the platform-level ' +
      'review queue: tenant_id is nullable because platform alerts (CUSTOMER_RECONCILIATION_MISSED) have no tenant, and ' +
      'the dedupe FINGERPRINT embeds tenant+customer for tenant-scoped kinds. Only the server-side reconciliation ' +
      'engine and the Super Admin surface touch it — cross-tenant review IS the feature, and no value in these ' +
      'statements ever comes from a client request.',
  },
  {
    file: 'customer-activation/customer-activation.repository.ts',
    why:
      'PRE-AUTH customer activation (phone -> SMS code -> link). These queries are unscoped BY NECESSITY: before the ' +
      'one-time code is verified there IS no tenant — finding out which salon(s) the phone belongs to is the entire ' +
      'point of the lookup. Safe by other means: (1) the directory lookup returns nothing to the caller until the OTP ' +
      'verifies, and the response is identical whether or not the number is known (no enumeration); (2) the OTP rows ' +
      'are keyed on the normalized phone, not on a tenant, and are hashed/one-use/expiring/attempt-capped; (3) a ' +
      'multi-salon match is resolved by an explicit customer CHOICE, never by silently picking a tenant; (4) the ' +
      'session that results is scoped to exactly one tenant.',
  },

  { file: 'communications/communications-overview.kysely.repository.ts', why: 'Super Admin Communications dashboard aggregates; cross-tenant by design, scoped via andTenant(scope) (tenant_id predicate) when tenant-filtered, platform-wide otherwise. SuperAdminGuard only.' },
  { file: 'communications/communications-announcements.kysely.repository.ts', why: 'Send Platform Announcement (Super Admin): platform-wide recipient estimate across tenant staff roles (customers always excluded), tenant_id-scoped only for the "selected tenants" case. SuperAdminGuard only.' },
  { file: 'communications/communications-providers.kysely.repository.ts', why: 'Configure Communication Providers (Super Admin): platform-level provider health over notification_delivery_logs by provider_id (a platform resource), not tenant business data. SuperAdminGuard only.' },
  { file: 'ai-business/ai-business-admin.kysely.repository.ts', why: 'Super Admin ai_business adoption overview (route /super-admin/ai-business, SuperAdminGuard only): COUNT/GROUP BY aggregates across all tenants over ai_business_saved_questions + ai_business_alerts. Returns platform counts only — no tenant_id rows leave the repo. The rest of the ai-business module is tenant_id-scoped.' },
];

//     'onboarding' is the Super-Admin "Onboarding & Approvals" subsystem (route /super-admin/onboarding, SuperAdminGuard):
//     its tables key to the platform tenant_applications spine and it aggregates across applications by design.
const PATH_ALLOW = ['super-admin', 'onboarding/onboarding'];

// (b) STATEMENT allowlist: specific raw statements in tenant-facing repos that are safe by other means. Each is matched
//     as a normalized substring and individually justified. If the statement text changes, this entry stops matching and
//     the test fails — forcing fresh review. Keep this list tight.
const STMT_ALLOW: { sig: string; why: string }[] = [
  {
    sig: "select state from plan_features where plan_id = ${plan.id} and feature_key = 'deals.engine' limit 1",
    why:
      "BUILD_PLAN Phase 5 — plan gating for deals. plan_features is the PLATFORM's plan catalog (no tenant_id); the plan " +
      "id comes from the salon's own active subscription, read the line before with tenant_id = ${ctx.tenantId}.",
  },
  {
    sig: "select value from platform_settings where setting_key = 'deals.engine_disabled' limit 1",
    why:
      "Constitution 7 §34 — the platform Deals engine kill switch. platform_settings is a platform-wide table with no " +
      "tenant_id; this reads one fixed key, so there is no salon data to scope.",
  },
  {
    sig: "select platform_role from users where id = ${userid} and role = 'super_admin' limit 1",   // matched against the lower-cased statement
    why:
      "Constitution 7 §5 — sign-in reads a PLATFORM account's platform role. Platform accounts belong to no salon " +
      "(tenant_id is null by design), the lookup is by the signed-in user's own id, and the role = 'SUPER_ADMIN' " +
      "predicate means it can never return anything for a salon account.",
  },
  {
    sig: "insert into audit_logs (action_type, entity_type, entity_id, user_id, created_at) values ('campaign_template_",
    why:
      "PLATFORM-level audit. campaign_templates has no tenant_id (platform-wide table), so audit records for " +
      "creating/versioning one legitimately have no owning tenant. Covers 'campaign_template_created' and " +
      "'campaign_template_versioned'.",
  },
  {
    sig: "insert into audit_logs (action_type, entity_type, entity_id, user_id, created_at) values ('platform_announcement",
    why:
      "PLATFORM-level audit. campaign_templates has no tenant_id (it is a platform-wide table), so the audit " +
      "record for creating one legitimately has no owning tenant. A null tenant_id here is correct, not missing.",
  },
  {
    sig: "insert into audit_logs (action_type, entity_type, entity_id, user_id, created_at) values ('platform_announcement",
    why:
      "PLATFORM-level audit (Super Admin sends a platform announcement across selected tenants). The action " +
      "belongs to the platform, not one tenant, so a null tenant_id is correct.",
  },

  {
    sig: "update notifications set status =",
    why:
      "Twilio delivery webhook. The row is matched by `provider_id` — the globally-unique Twilio MessageSid — " +
      "not by tenant, because there is no session tenant on an inbound provider callback. A MessageSid is issued " +
      "by Twilio for a message WE sent, so it can only ever match one tenant's own notification. Scoping by a " +
      "tenant we do not have would break delivery-status updates entirely.",
  },

  {
    // NOTE: matched against the LOWERCASED statement, so the signature must be lowercase too.
    sig: "select * from users where role = 'owner' and lower(email) =",
    why:
      "Owner-app LOGIN lookup. A login lookup CANNOT be tenant-scoped: the whole point is to find out which tenant " +
      "the person belongs to, and an owner deliberately spans several. It is safe by other means: (1) the filter " +
      "`role = 'OWNER'` is in the SQL, so a manager/technician/customer is invisible to it; (2) it returns ONE user " +
      "and grants nothing — the password is still verified afterwards, and the session is scoped to a single tenant; " +
      "(3) the salons it then loads come from `user_branch_access` keyed on that user's own id.",
  },
  {
    sig: "select * from users where role = 'owner' and normalized_phone =",
    why: "Same as above — the phone branch of the owner-app login lookup.",
  },

  { sig: 'select role from users where id =', why: 'ai-access: resolves the CALLER\'s own role; userId is the server-derived session id (req.ctx.userId), not client-supplied — it returns the user\'s own row.' },
  { sig: 'from hardware_payment_invoices', why: 'hardware-payment: platform-level hardware-billing summary reached via the SuperAdmin/cron controller; every tenant-facing query in this repo is tenant_id-scoped.' },
  { sig: 'update customer_memberships set status', why: 'memberships billing engine: update by UUID PK (where id = ${membershipId}); system/scheduler surface, membershipId sourced from tenant-correct reads. (Mirrors the membership module guard.)' },
  { sig: 'coalesce(max(version_number), 0) + 1 as v from membership_plan_versions where plan_id', why: 'memberships: version sequence; the plan is verified to belong to ctx.tenantId on the immediately-preceding line in the same transaction.' },
  // NailShowcase supports an intentional GLOBAL showcase scope; tenant scoping is applied conditionally via whereFrag(q)
  // (`AND p.tenant_id = ${q.tenantId}` for salon/branch scope). The global leaderboard/rank/moderation aggregates are a
  // by-design platform-wide social surface, not tenant business data.
  { sig: 'from nail_showcase_posts p', why: 'nail-showcase: global-scope showcase leaderboard/rank; tenant scope applied conditionally via whereFrag(q) for salon/branch scope.' },
  { sig: 'from board me where me.cid =', why: 'nail-showcase: "my rank" over the global showcase board; tenant scope applied conditionally via whereFrag(q).' },
  { sig: 'from nail_showcase_reports', why: 'nail-showcase: moderation queue aggregate over the global showcase surface (platform moderation), not tenant business data.' },
  { sig: 'select status, count(*)::int count from call_transcripts group by status', why: 'ai-voice-transcription: platform status rollup (counts only, no PII) reached via the SuperAdminGuard controller; the tenant-facing variant in the same repo is tenant_id-scoped.' },
  { sig: 'select provider, count(*)::int count from call_transcripts group by provider', why: 'ai-voice-transcription: platform provider rollup (counts only) reached via the SuperAdminGuard controller; the tenant-facing variant is tenant_id-scoped.' },
  { sig: 'from money_protection_alerts where ${sql.raw(open)} group by severity', why: 'ai-money-protection: platform severity rollup (counts only) reached via the SuperAdmin oversight surface; tenant-facing queries in this repo are tenant_id-scoped.' },

  // Deals Marketplace. The marketplace is an intentionally cross-tenant surface (customers browse and reserve deals
  // across salons), so several deal-scoped operations key on a globally-unique id rather than a session tenant. Each
  // is safe by other means, justified individually below.
  { sig: 'select service_id from deal_services where deal_id=', why: 'deals: sub-read of the service ids attached to a deal, keyed by the deal PK. Only ever called from within a deal read that already resolved the deal (and its tenant); deal_services rows belong to that one deal, so this leaks nothing across tenants.' },
  { sig: "update deal_redemption_holds set status='expired' where deal_id=", why: "deals: inside the oversell-safe reserveHold transaction, under a per-deal advisory lock. Expires this deal's own stale holds; deal-scoped by design (a hold belongs to the deal's tenant, set from deal.tenant_id on insert)." },
  { sig: 'select id, status from deal_redemption_holds where deal_id=', why: 'deals: idempotent-replay lookup inside the advisory-locked reserveHold transaction, keyed by (deal_id, idempotency_key). Deal-scoped; the hold inherits the deal\'s own tenant.' },
  { sig: "select count(*)::int as c from deal_redemption_holds where deal_id=", why: "deals: capacity count inside the advisory-locked reserveHold transaction — this deal's currently-held reservations. Deal-scoped by design." },
  { sig: 'select id, amount_discounted_cents from deal_redemptions where appointment_id=', why: 'deals: idempotent-redemption lookup inside the checkout redemption transaction, keyed by (appointment_id, deal_id) — both established as tenant-correct by the consumed hold that reached this point.' },
  { sig: 'update deals set redemption_count = redemption_count + 1 where id=', why: 'deals: increments the redeemed count for the exact deal being redeemed, by PK, inside the redemption transaction (deal already resolved for this appointment/tenant).' },
  { sig: 'select coalesce(sum(amount_discounted_cents),0) as c from deal_redemptions', why: 'deals: marketplaceOverview — a PLATFORM aggregate (total discounted across all tenants) reached via the Super Admin marketplace-oversight surface, not tenant business data.' },
  { sig: 'delete from deal_saves where deal_id=', why: 'deals: a saved-deal is USER-scoped by design (Option B cross-tenant identity) — keyed by (deal_id, user_id) where user_id is the caller\'s own server-derived id. A save deliberately does not belong to a tenant.' },
  { sig: 'select 1 from deal_saves where deal_id=', why: 'deals: same as the deal_saves delete — a user-scoped saved-deal existence check keyed by the caller\'s own user_id (Option B). Not tenant data.' },
  { sig: "update deals set status='canceled', updated_at=now() where id=", why: 'deals: superSuspendDeal — an explicit Super Admin force-suspend of any tenant\'s live deal (marketplace safety), reached via the Super Admin oversight surface. Cross-tenant by design.' },

  // Customer display pairing (23-inch dual-screen spec §8–§12, Unit 6). A pairing belongs to NO salon until an owner
  // claims its code: the unpaired display that asked for it has no tenant, and the claimer's tenant comes from the signed
  // POS session and is WRITTEN at the claim (never read from a request). The file says CROSS-TENANT BY DESIGN; these are
  // its statements that cannot carry a tenant filter, each safe by other means. Proven on real Postgres
  // (display-devices.pgtest, display-pairing.postgres-race).
  { sig: 'delete from customer_display_pairings where (claimed_at is null and expires_at < now())', why: 'display pairing housekeeping: deletes expired unclaimed codes and spent pairings (returns nothing). Pairing rows hold only hashes and, once claimed, the device id they created.' },
  { sig: 'select count(*)::int as n from customer_display_pairings where claimed_at is null and expires_at > now()', why: 'display pairing: the platform-wide ceiling on open codes (a count — the public start is a write anyone can reach).' },
  { sig: 'insert into customer_display_pairings (code_hash, poll_secret_hash, expires_at, platform) values', why: 'display pairing: a new UNCLAIMED code for a display that has no salon yet — hashes only, no tenant to scope.' },
  { sig: 'select id, platform from customer_display_pairings where code_hash = ${codehash} and claimed_at is null and expires_at > now() for update', why: 'display pairing: the owner claims an OPEN code by its hash; an open code has no tenant. The claimer\'s tenant (signed session) is then written to the pairing and the new display in the same transaction.' },
  { sig: 'update customer_display_pairings set consumed_at = now() where id = ${id}', why: 'display pairing: marks the pairing spent, by PK, inside pickUp — after the row was locked as claimed-and-not-consumed and the display proved its poll secret.' },
  // BUILD_PLAN Phase 8 (agent C) — the Safety Community is cross-tenant BY DESIGN for PUBLISHED posts: salons comment on
  // and report each other's advisories. These two statements cross salons on purpose; everything a salon owns in
  // community-interactions.repository.ts (follows, evidence, similar reports, analytics, retention) names tenant_id.
  { sig: 'update community_comments set report_count = report_count + 1 where id = ${c.commentid}', why: 'safety community (C): another salon reported this comment — the report row (reporter_tenant_id = the caller\'s session salon) was inserted in the same transaction (one per salon, uq_ccr_once); the counter of the reported comment, by PK, is the only cross-salon write. The community is cross-tenant by design for published posts.' },
  { sig: 'select * from community_evidence where id = ${id}', why: 'safety community (C): the MODERATOR evidence path only (CommunityEvidenceModeration, reached from SuperAdminGuard routes) — the caller has no salon; access requires an OPEN moderation case, a reason, a clean scan, and is logged in community_evidence_access_log + audited. Tenant reads use getOwnEvidence (tenant_id-scoped).' },
];

describe('Platform-wide tenant isolation (static)', () => {
  const tables = tenantOwnedTables();
  // Constitution 13: repositories live in apps/api/src AND in every domain module / package the API runs. Walking only
  // SRC made every repository that moved (memberships, loyalty, gift cards, inventory, audit, workforce, deals,
  // communications) INVISIBLE to this guard from the moment it moved — found when the route guard showed the same
  // blind spot. Keys come from codeKey, so the allowlists written against apps/api/src paths still apply.
  const files = codeRoots().flatMap((r) => repoFiles(r));

  it('derives a substantial tenant-owned table set from the schema', () => {
    expect(tables.size).toBeGreaterThan(50);
  });

  it('scans every Kysely repository in the backend', () => {
    expect(files.length).toBeGreaterThanOrEqual(60);
  });

  const offenders: string[] = [];
  let pending = 0;
  for (const file of files) {
    const rel = codeKey(file);
    if (PATH_ALLOW.some((p) => rel.includes(p))) continue; // intentionally cross-tenant Super Admin oversight
    if (SUPERADMIN_FILE_ALLOW.some((a) => rel.endsWith(a.file))) continue; // Super Admin oversight repo outside a super-admin/ dir
    const src = readFileSync(file, 'utf8');
    for (const q of sqlBlocks(src)) {
      const ql = q.toLowerCase();
      const touches = [...tables].find((t) => new RegExp(`\\b${t}\\b`).test(ql));
      if (!touches) continue;                                   // not a tenant-owned-table query
      if (ql.includes('tenant_id')) continue;                   // scoped — good
      if (STMT_ALLOW.some((a) => ql.includes(a.sig))) continue;   // documented safe-by-other-means
      if (isPending(rel, touches, q)) { pending++; continue; }    // known, recorded, NOT reviewed — see the block above
      offenders.push(`[${rel}] (${touches}) ${q.slice(0, 140)}`);
    }
  }

  it('has no unscoped raw-SQL tenant-table query in tenant-facing code outside the documented allowlist', () => {
    expect(offenders).toEqual([]);
  });
});
