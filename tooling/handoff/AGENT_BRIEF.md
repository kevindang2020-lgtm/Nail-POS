<!-- Saved from the Nov 2026 coordinator session. Paths assume the main checkout at /home/claude/repo and worktrees at /home/claude/wt1..5; adjust to the new environment. Sections 10-15 hold Kevin's decisions and the gate lessons. -->
# Brief for parallel extras-backlog agents (AIPowerSalon monorepo)

You are one of 5 agents building rows of Kevin's optional-extras backlog in parallel. You work in your OWN git worktree
/home/claude/wtN (branch extras-agentN) — cd there first and stay there. The main checkout is /home/claude/repo — never edit it, never push, never touch the `github` remote.

## 0. Worktree setup (do first)
Your worktree has no node_modules / build output. From your worktree root run:
```
WT=/home/claude/wtN   # your N; M=/home/claude/repo
M=/home/claude/repo
cd $M && for d in node_modules apps/*/node_modules modules/*/node_modules packages/*/node_modules; do [ -e "$d" ] && ln -sfn "$M/$d" "$WT/$d"; done
for d in packages/*/dist modules/*/dist; do [ -d "$M/$d" ] && rm -rf "$WT/$d" && cp -r "$M/$d" "$WT/$d"; done
cd $WT
```
(dist is COPIED, not linked: if you change packages/api-contracts, rebuild it in YOUR worktree: `cd packages/api-contracts && npx tsc -p .`)

## 1. Your rows
Your sections are listed in /tmp/agentN-sections.txt (N = your number). Each section in
docs/handoff/EXTRAS_BACKLOG.md has rows `| NN | text | TODO |`. Show a section's TODO rows:
`python3 tooling/handoff/bl.py show "<Section title exactly>"` (it reads the main checkout's backlog READ-ONLY; never use its `mark` command).
Work through as many rows as you can, best value first. For each row decide:
- BUILT — you implemented it (server and/or POS web) WITH tests that ran green in this session.
- EXISTS — it is already in the product; you OPENED the code and can name the file/function and a test.
- NOISE — the row is instruction/acceptance text, not a feature.
- leave TODO — needs external systems/credentials, or too large; skip it.
Never mark anything without evidence. Never invent counts or data; show "—" when unknown.

DO NOT edit docs/handoff/EXTRAS_BACKLOG.md. Instead write your marks to /tmp/agentN-marks.json:
`{ "<Section title>": { "<row NN>": "BUILT — files… (tests: …)" | "EXISTS — where… (test …)" | "NOISE — why" } }`
Update that file as you go (it is how your work is recorded if you are stopped).

## 2. Stack + rules (Kevin's standing rules — mandatory)
- NestJS + Kysely + Postgres 16 server in modules/*; React POS web in apps/pos-web/src; shared contracts in packages/api-contracts.
- Extend, never duplicate. One backend. Never remove/rename modules, routes or nav.
- Money = integer cents. Payments = Fiserv + Clover only. No live card transactions, no flat 3% surcharge.
- No PAN/CVV/passwords/keys in code, logs, tests.
- Salon day = branch time zone (businessDate / `at time zone tz` / addDays from @aipowersalon/date-time).
  NEVER `toISOString().slice(0,10)`, `current_date`, `now()::date` (architecture test fails).
- No swallowed catches in server code (check:silent-catch). In POS use components/useSessionState writeSession/readSession.
- A new GET handler must not be named like a mutation (create/update/refund/apply/... prefix).
- A new route needs: an @aipowersalon/api-contracts type in the handler's return signature; GET handlers that take
  @Query need a ListQuery spec (ranged from/to → dateRange.maxDays); a GET that builds no file but is called "export…"
  goes in apps/api/scripts/async-exports.exempt.json.
- POS UI text: every string through t()/tx() with keys in apps/pos-web/src/i18n/ns/<ns>.en.ts AND .vi.ts.
  Add keys with: `cd apps/pos-web/src && python3 tooling/handoff/addkeys.py <ns> '<en json>' '<vi json>'` (it adds the
  `// DRAFT — Kevin reviews` marker to VI). Codes shown to users go through codeLabel/statusLabel, never raw.
- Read-only previews/explainers must never move money, change history or send anything.

## 3. Tests you may run (ONLY these — no full suites, no gates; the coordinator runs those after merging)
- POS: `cd apps/pos-web && TZ=UTC npx vitest run src/screens/<file>.test.tsx` (specific files) and `npx tsc --noEmit -p .`
- Server: `cd modules/<m> && TZ=UTC npx vitest run src/<path>.pgtest.vitest.spec.ts` (pglite, no real PG needed) and
  `npx tsc --noEmit -p .`
Add tests next to the code you change (existing test files preferred). Tests must assert real behaviour, not be vacuous.

## 4. Finish
Commit your work in your worktree branch (git -c user.name="Kevin Dang" -c user.email="kevindang2020@gmail.com" commit),
message ending with the two lines:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012xzQjHCED7y8SUXBMbQqXV
Then reply with: your branch name + worktree path, commit hash, rows marked (counts by status), the exact test files you
ran and their pass counts, and anything you started but did not finish. Be honest: never claim a test passed unless it ran.

## 5. Round-2 lessons (from round 1 — follow them)
- Setup: use guarded paths, e.g. `rm -rf "${WT:?}/${d:?}"` (plain `rm -rf "$WT/$d"` is blocked). Your worktree already exists
  and is reset to the latest main; redo the symlink/copy step anyway (dist changed).
- node_modules/@aipowersalon/* links resolve to the MAIN checkout, so your edits to packages/* are NOT seen by your tests or
  tsc. Avoid changing shared packages; if you must add an api-contracts type, ALSO keep your code compiling without it
  (e.g. a local type with a DIFFERENT name than any API type) and say so in your report.
- Gates that failed after round-1 merges — avoid them:
  * no new `as any` (type the value; `as unknown as X` only if unavoidable);
  * no `sql.raw(...)` with an expression — use conditional `sql\`...\`` fragments;
  * no POS type/interface whose NAME equals an API/server type name (architecture "type mirroring");
  * never add keys to apps/pos-web/src/i18n/catalog.{en,vi}.ts (frozen) — only ns/<ns>.{en,vi}.ts;
  * no new swallowed `catch {}` in server code;
  * run `npx eslint <your changed .ts/.tsx files>` from the repo root of your worktree: 0 warnings (react-hooks/exhaustive-deps!);
  * keep an existing `// eslint-disable-line` comment on its own line when inserting code after it.
- Rows already judged "needs external systems / too large" in round 1 are fine to skip fast; prefer rows you can finish.

## 6. Round-3 lessons (from merging round 2)
- Vietnamese: run `node tooling/ci/check-vi-glossary.mjs` before committing. "thẻ quà" must always be "thẻ quà tặng"; never "Kỹ thuật viên"/"KTV" (use "Thợ"), "hàng đợi" (use "hàng chờ"), "biên nhận" (use "hóa đơn").
- SQL: never reuse a table alias already used for a different table in the same statement (check:sql:select flagged `m` used for both ticket_service_lines and service_add_ons). Use distinct aliases.
- Any new `@Query('x')` on a list route must be declared in that module's `*.list-queries.ts` spec (filters/params).
- No new `rows as any[]` — give `sql<{...}>` a row type instead (check:as-any ratchet).
- Never write a payment provider name (fiserv, cardpointe, cardconnect, openai, twilio, …) as a literal in a server directory that does not already have one — the architecture test treats it as a new provider-endpoint directory. Compare against the stored value instead. Tests count too.
- Run `node tooling/ci/run-gates.mjs`? NO (too heavy with 5 agents). But DO run: `npm run -s architecture:test` (from repo root of your worktree), `node tooling/ci/check-vi-glossary.mjs`, and `node apps/api/scripts/check-as-any.mjs` if you touched server code.
- Product edits: only send a field the user changed when the server may have masked it for this viewer.
- Already judged as needing Kevin or an outside system — skip, do not re-investigate: END-OF-DAY 11 (in-app vs SMS opt-out), Customer Profile Assistant 12 (churn ownership), End-of-Day Cash 17 (reopen closed cash), TECH APPOINTMENTS 08 (verification state lives in booking), Receipt 04 (duplicate table never written), AI Business Alerts 05 (needs per-user read-state table), Customer Notifications 03 is allowed now: apps/api tests ARE allowed (run `npx vitest run <path>` inside apps/api for the files you touch).

## 7. Round-4 lessons (from merging round 3)
- Each line in your sections file is "<exact section heading> (<TODO count>)". Use the exact heading (which already ends in its own "(N)") as the key in your marks JSON; add "@2" only when the same heading appears twice in EXTRAS_BACKLOG.md.
- Related sections (same feature family) are now given to ONE agent. Before building, grep the main code for an existing implementation of the same idea (e.g. a dryRun/preview on the same route) and extend it — never build a second one.
- Avoid `select x.*` / `select *` in NEW queries (check:response-exposure ratchet) — name the columns the response reads.
- A row already marked EXISTS that you complete may be re-marked BUILT — say so in your report.
- Also skip (judged in round 3): LIVE TECHNICIAN SCHEDULE 14, AI Receptionist Settings 06, Serving 07 (confirm step breaks one-tap design), Customer Notes 05 (no stored source), Deals 12, Split Payments 02/15, Money Protection 15 / Tablets 11 (no export), Retention Win-Back 15 (needs admin setting), Checkout Upsell 05 (loyalty mutation adapter not wired), END-OF-DAY 07.

## 8. Round-5 lessons (from merging round 4)
- NEVER re-derive a server/engine rule in the POS (pricing, stacking, eligibility, payroll, permissions). If the screen needs
  the rule's answer, have the server return it (add an optional field to an existing GET response) and render that. Round 4
  had the pricing engine's stacking rules twice (server + POS); the POS copy was removed at merge.
- When you remove or rename a `data-testid`, say so in your report (the POS module registry tracks them).
- POS tsc runs out of memory with 5 agents: always run it with NODE_OPTIONS=--max-old-space-size=6144.
- Also skip (judged in round 4): Membership Overview 10 (no plan editor), Safety Community 08, AI Plans 05, Reviews 07,
  AI MONEY PROTECTION 5 · 11 (alert rate limits — needs design), Deals 08, Deals 12, Phone & Messaging 12 (STOP vs booking
  codes — Kevin decides), Device Integration Logs 09.

## 9. Round-6 lessons (from merging round 5)
- Three agents added checks to apps/api/src/system-checks/system-checks.registry.ts and its pgtest. That pgtest shares ONE
  pglite DB across all tests (no reset): give any new test its own id range (use id(6NN) where N = your agent number,
  e.g. agent 3 uses id(630)..id(699)) so ids never collide with other tests.
- `sql.ref(...)` / `sql.table(...)` / `sql.id(...)` must take a constant string, never one built from a variable
  (check:raw-sql-inputs). If a helper needs an alias, restrict it to a literal union and map to constant refs.
- Many rows remaining are judged "needs outside system / Kevin / too large". Do NOT re-investigate rows that a prior
  round listed as left TODO for those reasons (see sections 6–8); pick the buildable ones and mark honest EXISTS/NOISE.

## 10. KEVIN'S DECISIONS (Nov 12 2026, 15:04 New York) — these rows are now UNBLOCKED; build them
1. In-app follow-ups vs opt-out → "SMS": a customer on the SMS opt-out list (texted STOP) must NOT receive End-of-Day /
   follow-up messages either (they go out in-app today). Enforce it server-side in the follow-up send path (refuse with the
   existing state/consent error and audit it), show it in the contact check, update the followup-queue pgtest that
   currently asserts STOP is "shown but not enforced". Email opt-out is not part of this decision. Rows: END-OF-DAY
   FOLLOW-UPS 07 and 11 (agent 1).
2. Churn ownership → Customer Retention. The Customer Profile Assistant must NOT compute its own churn class: it shows
   Customer Retention's classification (read from the retention module / its existing endpoint data) and links to it.
   Remove any second churn rule if one exists. Row: Customer Profile Assistant 12 (agent 2).
3. Closed cash records → reopenable: YES. End-of-Day Cash 17: reopen a closed cash record with a dedicated permission
   (manager/owner), a required reason, an audit row with before/after, the record shows "reopened by/at/why", re-close
   recomputes from source; never edits history silently; money stays integer cents. A migration is allowed if needed
   (PG16, no pgcrypto). Row: End-of-Day Cash 17 (agent 3).
4. STOP vs booking verification codes → YES, codes still go out. Booking codes are transactional and are NOT blocked by
   STOP. Phone & Messaging 12 (Consent Boundary Checker): build the read-only checker that states each message type's rule
   (booking codes: sent despite STOP — transactional; marketing/follow-ups: blocked by STOP) and tests that pin current
   behavior. Row: Phone & Messaging / Text Messaging Setup 12 (agent 3).

## 11. Round-7 assignments and lessons (from merging round 6)
- AGENT 5 ONLY — Kevin's decision 2 follow-through: the Churn Watch page (modules/ai/src/ai-customer-profile/churn-watch-center.ts
  + its POS screen) must use Customer Retention's classification as THE verdict (segment + days away, read through
  RetentionRepository exactly like customer-intelligence-center.ts now does after round 6 — reuse that, do not write a third
  rule). Its own evaluateChurnRisk signals may stay ONLY as supporting "why" reasons, labeled as such, never as a separate
  risk level/verdict or filter. Never remove the module, route or nav entry. Pin with a pgtest that each listed customer's
  verdict equals Retention's. Mark it in your report as "Kevin decision 2 — Churn Watch".
- A real bug pattern found 3× in round 6: a field the UI shows but the repository never maps (Quick View next appointment,
  isPhoneVerified) or a filter on a value the CHECK never allows. When you touch a screen, check that each shown value is
  actually read from the database; fix and pin it if not.
- New migrations: take the next free number after the highest in apps/api/db/migrations (846 is used). If a migration adds
  columns, add them to packages/database/src/kysely.types.ts (check:types-drift), and regenerate
  apps/api/db/state-vocabularies.generated.json with `node apps/api/scripts/audit-state-transitions.mjs --write-vocab`.
- A coded error is required for any new refusal: `throw withCode(new XError('…'), 'EXISTING_CODE')` (check:error-text). Never
  echo a raw DB error message to the client.
- A new permission key means: regenerate docs/PERMISSIONS.md (`node tooling/permissions/generate-permission-docs.mjs`).

## 12. Round-8 lessons (from merging round 7)
- Migrations this round: agent N uses 85N then 86N (849 and lower are taken). Never reuse a number.
- A NEW TABLE with a foreign key to another tenant-owned table needs the B-12 trigger in the same migration:
  `CREATE TRIGGER trg_tc_<table>__<col> BEFORE INSERT OR UPDATE OF tenant_id, <col> ON <table> FOR EACH ROW EXECUTE FUNCTION
  enforce_tenant_consistency('<referenced_table>', '<col>');` (apps/api src/common/tenant-consistency.pgtest checks every FK).
- A NEW TABLE also needs: `node apps/api/scripts/db-ownership.mjs --write` (ownership registry), kysely.types entries.
- A NEW ROUTE with a path id ({id}, {xId}) needs an entry in apps/api/scripts/idor-routes.mjs (a fixture table, or an
  exemption with its reason); if the fixture table has a branch_id, classify it in BRANCH_TABLES ('branch' or SW(why)).
  Run `cd apps/api && npx vitest run src/common/idor-route-coverage.vitest.spec.ts` to prove it.
- POS text in .ts helpers (reports, CSV builders) is checked too: every English fragment goes behind t() (check-pos-i18n).
- Remaining rows are mostly external/large. Prefer honest EXISTS/NOISE marks with evidence over half-builds; never invent data.

## 13. ROUND 9 — THE FINAL ROWS (skip lists in sections 6–9 and 11–12 are LIFTED for your sections)
These ~33 rows were left by earlier rounds as "needs a new table / too large / needs design". Kevin wants ALL finished.
Build them now. You MAY add migrations (agent N: 87N, then 88N), new tables (with B-12 triggers, db-ownership --write,
kysely.types, state vocab regen), new routes (api-contracts types, list-query specs, idor-routes entries, role-matrix is
reviewed by the coordinator), and new permission keys (registry + rbac + regenerate docs/PERMISSIONS.md).
Design calls you make yourself (Kevin delegates architecture), choosing the SAFEST reading:
- per-user read state → a small append/upsert table keyed (tenant_id, user_id, item_id) with read_at;
- "rate limits / alert fatigue" → dedupe by key + cooldown window stored server-side, never auto-disable a rule;
- "previews / dry runs" → compute with the SAME server function the real action uses, write nothing;
- "exports" → @AsyncExport + an audit row, redaction, a provenance header (see round 8 Money Protection export);
- "role preview" → evaluate the real permission check for a chosen role, read-only;
- "snapshots" → immutable rows + append-only notes (see migration 848).
Never move money, send messages, or change history in a preview. No live card transactions. Money = integer cents.
A row stays TODO ONLY if it truly needs something outside the code (a provider account/API key, physical hardware, a
legal/business decision not covered by section 10). Then your mark is "TODO — needs <exact thing>" and you say so in
your report. If the backlog row text is cut off, build the clearly-implied part and mark BUILT (part) naming what's missing.

## 14. ROUND 10 — FINISH THE PARTIAL ROWS (Kevin, Nov 13 2026: "finish all of this")
Your worktree was reset to 5580f5a9 (all rounds merged; dist refreshed). Do section 0's node_modules links if missing.
Your rows are in /tmp/agentN-r10.txt — every one is marked BUILT (part) or EXISTS (part) and its mark says what is
missing. For EACH row:
1. Read the missing part. Open the code it names.
2. If the missing part is code (a filter, a column, a panel, a per-branch split, a check, a preview, a monitor, an
   export, a history view, a missing state, a test at the edges…) → BUILD it with the section-13 design rules and tests
   that run green in this session. New mark = "BUILT — <the full previous evidence, kept> + <what you added: files,
   functions, tests with counts>". Keep the old evidence text; append, don't replace.
3. If the missing part truly needs something outside code (a provider account/API key/usage-billing API, physical
   hardware, Fiserv certification, a legal/business decision NOT in section 10 — e.g. bulk invite SMS/email volume,
   membership carryForward default, Expenses export tab) → leave it: mark = "<same status> (part) — <old text> ·
   STILL NEEDS: <exact outside thing>". Build every code part around it first.
4. If on inspection the "missing" part is already there → mark it BUILT/EXISTS with the evidence (file + test).
Write marks to /tmp/agentN-marks.json keyed by section title and row NN (as before). Keys must be the exact section
title from the r10 file's "## " lines.
Migrations: agent N uses 9N0–9N9 (agent 1: 910…, agent 5: 950…). Same gate rules as before (B-12 triggers,
db-ownership --write, kysely.types, idor-routes fixtures + BRANCH_TABLES, no GET named like a mutation, no role-name
checks, pos-i18n EN + VI `// DRAFT — Kevin reviews`, no printing controls, no `select *`, coded errors via withCode).
Commit in your worktree as Kevin Dang <kevindang2020@gmail.com> with the two trailers; one commit per few rows is fine.
Before finishing: typecheck every package you touched (POS tsc needs NODE_OPTIONS=--max-old-space-size=6144) and run
the tests you added/changed plus their neighbours. Do NOT run the full POS/API suites or the gates — the coordinator does.
Report: rows finished, rows left with STILL NEEDS (what exactly), anything surprising, commits.

## 15. ROUND 11 (Kevin, Nov 13 2026 10:44 "continue") — three agents
Worktrees reset to 6d65e47f (dist refreshed). Migrations: agent 1 → 960–964, agent 2 → 965–969, agent 3 → 970–979.
Kevin's open business decisions are built as MECHANISMS ONLY, OFF / blank by default: with the default, behaviour is
exactly today's. Never choose a value for him (no prices, no caps beyond a hard safety ceiling, nothing switched on).
Mark such rows "BUILT (part) — <old evidence> + ROUND 11: <mechanism, files, tests> · STILL NEEDS: Kevin turns it on /
sets <value>" (keep the "(part)" so the backlog stays honest). Marks go to /tmp/agentN-r11-marks.json (same keying).

### Agent 1 — staff notification preferences are saved but never enforced (bug)
user_notification_prefs (migration 139; read/write in apps/api/src/profile/profile.service.ts) has sms_notifications,
email_notifications, push_notifications, missed_call_alerts, booking_alerts, low_stock_alerts, payroll_approvals,
weekly_report_summaries (+ quiet hours, already enforced for pushes in modules/communications/src/push). No send path
reads the switches. Make every STAFF-directed send respect them, through ONE shared rule (a pure function in
packages/api-contracts tenant/me-prefs.ts next to inQuietHours, e.g. staffNotificationAllowed(prefs, channel, category))
and ONE server reader. Find every staff send: push dispatcher, owner/manager alert SMS/email, missed-call alerts,
booking alerts to staff, low-stock alerts, payroll approval notices, weekly report e-mails. Rules: security / sign-in /
MFA / password messages always go; customer-directed messages are out of scope (they have their own consent);
unreadable prefs → send (same as quiet hours) but log; a held send is recorded with reason 'staff_pref_off' where the
send path already records outcomes. Tests per path + the pure rule. Show in the POS My Account notifications panel
which switches now take effect (if it claims something untrue today, fix the text).

### Agent 2 — decisions as settings (Technician bulk invites; add-on inventory)
- 200-Technician Large Salon 4 (20) row 08: bulk INVITE — a tenant setting `staff.bulk_invites_enabled` default false
  plus a platform kill switch; when off, the existing per-person invite is unchanged and the bulk action shows why it is
  off. When on: preview (who gets what by which channel, who is skipped and why — no contact, already active, invited in
  the last 24 h), a hard ceiling of 200 per run, idempotent run key, per-person outcome, audited, uses the existing
  invite sender. Kevin decides volume/consent — no messages unless he turns it on.
- ADD-ONS MANAGEMENT (16) row 06: add-ons consume inventory — optional recipe per add-on (products + integer quantity,
  same model as service recipes), a tenant setting `inventory.addon_recipes_enabled` default false; when on, deduct at
  Service Done exactly like service recipes (reuse that code path; idempotent per ticket line; reversal on line void).
Plus leftover: Deals live-use count must exclude fully reversed and count partially reversed uses correctly (find the
earlier note "Deals live-use count still does not include partially reversed uses").

### Agent 3 — decisions as settings (devices, AI prices, review-text price) + leftovers
- Device Health (2) row 06: optional device → employee assignment (nullable assigned_user_id on the device labels from
  migration 924 or a small assignment table with history), search by employee name; assigning is audited, permission
  gated like labels. No auto-assignment.
- AI Usage Limits (10) row 07: Super Admin AI price table — versioned rows (feature, unit, price cents, effective_from),
  optional per-salon override, a per-version flag "existing salons keep their previous price" with NO default chosen
  (required field when publishing); table starts EMPTY; usage screens show "no price set" until a version exists.
- Reviews Reputation (8) row 07: a platform setting for the per-message price of review-request texts, blank by default;
  blank → the cost stays "not available" exactly as today; when set, the recipient preview shows the estimate (integer
  cents × recipients).
- Remove the unused i18n keys mpx.searchPh / mpx.searchPhNoCustomer (EN+VI) after confirming no reader.
Same rules as sections 12–14 (gates, tests green in this session, typecheck touched packages, commit as Kevin with
trailers, no full suites/gates). Report as in section 14.
