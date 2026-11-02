# AI_PLATFORM_AUDIT.md
### Constitution 10 — Phases 1–2: Discovery and AI Inventory (Sep 19, 2026)

Same base-tree caveat as Constitutions 8 and 9: the July snapshot, not `Power-Salon-main`.

---

## Phase 0 — the boundary gate
`npm run check:ai-platform` (added this pass) enforces §2/§303 continuously: provider HTTP or an SDK import
outside `ai/ai-providers.ts`, a provider key **value** used outside it, or an AI module on the raw gateway with
neither entitlement nor usage. It distinguishes a key *presence* check (`!!env.OPENAI_API_KEY`, used by the
readiness dashboard and a provider-name display) from a use of the secret — the first version flagged three
such files and was wrong. Current state: no violations, four advisory notes (the four raw callers).

## Phase 1 — Discovery (every line grep-verified)

| The constitution asks about | What exists |
| --- | --- |
| Provider SDKs in modules (§2, §303) | **None.** No module imports `openai`, `@anthropic-ai/*` or any provider SDK. |
| Direct provider HTTP | **One file only:** `src/ai/ai-providers.ts` — `api.openai.com/v1/chat/completions` and `api.anthropic.com/v1/messages` via a shared `postJson`. This is already an adapter boundary in the §17 sense. |
| A central AI entry point | **Two of them** — see the finding below. |
| Prompts | `src/ai/ai-prompts.ts` plus prompt strings inside individual modules; no versioning, no rollout/rollback (§21–§25 ✗). |
| Model names | Chosen by env in `resolveAiProvider()`; no registry, no per-task allow-list, no status (§14–§15 ✗). |
| Credentials | Env-resolved inside the adapter; not in module source (§19 ✓). |
| Workers | Per-module; no shared AI job table, states or attempts (§65–§70 ✗). |
| Usage | `ai_usage_logs` (migration 091) + `ai_usage_cost` (093) exist. Constitution 8's `ai.usage_ledger` consumer writes them and enforces `FORBIDDEN_AI_PAYLOAD_KEYS`, so raw prompts already never reach the log (§115 ✓ for that path). |
| Cost | `ai-pricing.ts`, `ai-plans.ts`; no pricing *versions* (§96, §218 ✗). |
| Safety | `ai-access-gate.ts` handles entitlement. No risk levels, no PII classification, no approval policy, no automation levels (§36–§41, §59–§62, §109–§113 ✗). |
| AI modules | 18 tenant modules (`ai`, `ai-analytics-forecasting`, `ai-booking`, `ai-business`, `ai-center`, `ai-checkout-upsell`, `ai-customer-profile`, `ai-governance`, `ai-inventory`, `ai-marketing`, `ai-money-protection`, `ai-ocr-receipt`, `ai-queue-assignment`, `ai-readiness`, `ai-revenue`, `ai-review-reputation`, `ai-scheduling-optimizer`, `ai-voice-transcription`) + 8 `super-admin-ai-*` modules. |

### The central finding
`src/ai/` is already a proto-platform, and **§2's hardest rule largely holds**: no module talks to a provider
directly. But there are **two entry points**, and the safe one is barely used:

| Entry point | What it enforces | Used by |
| --- | --- | --- |
| `GatedAiCompletion` | entitlement check → provider → usage row | `ai-marketing` only |
| `AiGatewayService.complete()` | **nothing** — straight to the provider | `ai`, `ai-money-protection`, `ai-queue-assignment`, `ai-voice-transcription` |

**Correction made during this pass:** a first sweep matched `.complete(` and reported six raw callers,
including `ai-business` and `ai-checkout-upsell`. Both were false positives — `repo.complete(...)` and a
generic retry wrapper. Matching `AiGatewayService` itself gives the true four, and the gate below uses that.

Each of the four gates itself differently, which is the §3 argument for centralization stated as code:

| Module | Entitlement | Usage row |
| --- | --- | --- |
| `ai` | ❌ | ✅ |
| `ai-money-protection` | ✅ | ❌ |
| `ai-queue-assignment` | ✅ | ✅ |
| `ai-voice-transcription` | ✅ | ✅ |

`ai` logs usage without checking entitlement; `ai-money-protection` checks entitlement without logging usage —
a HIGH-risk money explanation that costs the platform money and attributes it to nobody. Two of four are
half-right in opposite directions, and no two implementations agree.

This is the same shape as the realtime arc's findings: not a missing subsystem, but a correct one that most
callers bypass.

---

## Phase 2 — AI Inventory matrix

| Module | Reaches a provider | Entitlement | Usage row | Task keys today | Risk if wrong (§36) |
| --- | --- | --- | --- | --- | --- |
| ai (assistant, receipt) | gated + raw + adapter | ❌ | ✅ | none declared | MEDIUM |
| ai-marketing | **gated** | ✅ | ✅ | none declared | LOW (content draft) |
| ai-money-protection | raw | ✅ | ❌ | none declared | **HIGH** (money explanation, unattributed cost) |
| ai-queue-assignment | raw | ✅ | ✅ | none declared | MEDIUM (§45: deterministic engine must decide) |
| ai-voice-transcription | raw | ✅ | ✅ | none declared | MEDIUM (§154 redaction) |
| ai-business, ai-checkout-upsell | **no provider call** (first sweep false-positived on `.complete(`) | — | — | — | — |
| ai-ocr-receipt | no provider call found | — | — | — | MEDIUM (§47 confidence) |
| ai-review-reputation | no provider call found | — | — | — | MEDIUM (§50, §193) |
| ai-analytics-forecasting | no provider call found | — | — | — | §44/§206: numbers must not come from an LLM |
| ai-scheduling-optimizer | no provider call found | — | — | — | §43: constraints are deterministic |
| ai-customer-profile, ai-inventory, ai-booking, ai-center, ai-revenue, ai-governance, ai-readiness | no provider call found | — | — | — | — |

"No provider call found" means the module is deterministic today or calls through a service this pass has not
yet traced — Phase 23 (module migration) checks each one individually rather than assuming.

### Gaps against the constitution
§9–§11 task registry · §12–§15 model registry and router · §21–§26 prompt registry with immutable versions,
rollout and rollback · §29–§32 tool registry and authorization · §36–§41 risk levels and human approval ·
§55–§58 context builder and budget · §59–§62 PII classification and redaction · §65–§70 AI job architecture ·
§72–§76 structured output, validation and confidence · §79–§86 failover, circuit breakers, retry policy ·
§92–§101 usage, cost, budgets · §102–§108 rate limits and worker pools · §109–§113 safety policy engine and
automation levels · §119–§128 evaluations · §143–§150 RAG · §171–§181 Super Admin control plane · §286
"provider 200 is not completion until the result validates".

### What must NOT be duplicated
`ai_usage_logs`, `ai_usage_cost`, `ai_providers` tables; the `postJson` provider adapter; Constitution 8's
`ai.usage_ledger` consumer and its forbidden-key enforcement; `ai-access-gate` entitlement logic. The plan is
to route everything through them, not to build a second of any.


---

## Phases 3–4 — Platform boundary and Task Registry (done)

`src/ai/ai-task-registry.ts` — 14 declared tasks, each carrying capability, provider allow-list, output schema,
risk level, mode, token and timeout ceilings, cache TTL, approval policy, temperature, allowed tools, and a
written rationale for its risk level (§117: the judgement is recorded so a later reader need not re-derive it).

**What is deliberately absent matters as much as what is present.** There is no `ai.run_arbitrary_prompt` (§9,
§27): an open prompt endpoint is how injection becomes a system instruction and how cost becomes unbounded.
There is no `forecast.appointment_demand` or `forecast.revenue` — §44 and §303 forbid an LLM as the numerical
forecaster, so the task is `forecast.explain`, which narrates numbers the deterministic model produced. Likewise
`schedule.explain_suggestion` not `schedule.optimize`, `queue.recommend_assignment` not `queue.assign`,
`reconciliation.explain_exception` not `reconciliation.resolve`. **No task is CRITICAL** — payment capture,
refunds, permission changes and suspensions (§40) are not AI tasks at all, and a test asserts the registry can
never acquire one by name.

The tests are invariants over the whole registry rather than examples, so they hold rows added later: minimum
approval per risk level, MEDIUM-and-above never `NO_APPROVAL`, deterministic capabilities and all HIGH-risk
tasks at temperature 0 (§278), a 4,000-token ceiling (§183), timeouts inside §84's band, and `allowedTools`
empty everywhere until §32/§135 tool authorization exists. All four were mutation-tested.

**One design question the invariants forced.** `voice.transcribe` was first written MEDIUM with `NO_APPROVAL`,
and the registry's own rule rejected it: a MEDIUM task is by definition a human-visible recommendation, and one
nobody has to see is an action. Either the level or the policy had to move. The honest answer is that a
transcript is a *record*, not a recommendation — nothing acts on it — so it is LOW, with consent enforced before
dispatch (§153) and redaction on the output (§154). The reasoning is in the rationale field, not just here.


---

## Phases 5–7 — Provider adapters, Model Registry, Model Router (done)

`ai-model-registry.ts` (§14–§16): eight models as data — provider, key, capabilities, status, context window,
structured-output/vision/tool flags, tier, latency class, privacy metadata. Cost comes from the **existing**
price table in `ai-pricing.ts`, not a second copy (§96 one cost registry). Only `ACTIVE`/`BETA` are routable;
the Mock is `BETA` and excluded from production.

`ai-model-router.ts` (§12–§13, §77–§80): selection from task + capability + risk + tenant policy + cost +
latency + provider health. §13 is implemented as a tier preference derived from the task's *declared shape*, not
a per-module opinion: classification wants `fast`, HIGH risk and vision extraction want `strong`, everything else
`balanced`; within a tier the cheapest wins. Every decision carries `routing.v1` and a written reason (§78). A
tenant may block providers or pin a model, and may only ever *narrow* the task's allow-list. Failover goes only
to a compatible alternative and is recorded on the decision; for HIGH risk it is refused outright (§80).

`ai-provider-health.ts` (§17, §81–§86): the adapter contract (`supports`, `health`) lifted over the existing
`AiProvider` port without touching `ai-providers.ts`; a per-provider circuit breaker with half-open probing
that feeds the router's health view; and error classification where **PERMANENT errors (400/401/403/404/422)
never trip the breaker** — one malformed request must not take a healthy provider offline for every tenant.

### Two corrections made during the pass
1. The first registry draft named the third provider `google` and marked it `DISABLED` "for having no adapter".
   `GeminiProvider` had been sixty lines further down `ai-providers.ts` the whole time, keyed `gemini`. The
   registry now uses adapter names, and a test reads the adapter source so the two cannot drift.
2. `whisper-1` had no price row and would have been billed at the conservative placeholder. Whisper is priced per
   minute of audio, not per token; the row now prices one "token" per audio-second so 60 s ≈ $0.006, with the
   §93 caveat recorded that the ledger needs an audio-seconds unit.

### Mutation testing
Five mutations across router and breaker. Four failed the suite immediately. The fifth — admitting the Mock in
production — passed with *both* production guards removed, because the test's task allow-list excluded the Mock
before either guard ran. Rewritten so the task explicitly allows the Mock; now each guard alone holds and the
test fails only when both go, which is what defence in depth is supposed to look like.


---

## Phase 8 — Prompt Registry (done)

**The finding that shaped this phase:** `ai_global_prompts` (migration 245) has a unique index on `prompt_key`
and an integer `version` bumped in place. Every edit *overwrites* the production prompt — the exact thing §22
forbids — and no historical AI result can ever know which text produced it. Separately, the in-code role for
`ai_analytics_forecasting` began "You forecast sales and appointment demand" — §44 violated in the prompt
itself. Both are fixed.

Migration 436 adds `ai_prompt_versions` with `UNIQUE (prompt_key, version)` and a **BEFORE UPDATE trigger that
raises on any change to content columns**; only lifecycle columns (status, rollout, approvers) may move.
Verified on PGlite: a status update succeeds, a template edit is refused with the §22 message, a duplicate
version is refused, and a rollback with a reason under ten characters is refused by a CHECK. `ai_prompt_rollbacks`
is the §25 who/what/reason/when ledger.

`ai-prompt-registry.ts`: fourteen seed versions (one ACTIVE v1 per task; a test enforces exact coverage in both
directions), typed variables (§26 — rendering refuses a missing, undeclared, or mistyped variable, and a
template that references an undeclared one or declares an unused one), three-block prompt structure (§27 —
`SYSTEM_POLICY` + version instructions, static and variable-free, then the template), and **untrusted-content
delimiting** (§28 — every variable flagged `untrusted` is wrapped in `<untrusted name="…">` with `<` escaped, so
the test's injected `</untrusted>` cannot close the block; the rendered prompt contains exactly one real
closing tag). Selection walks TESTING-for-listed-tenants, then ACTIVE with tenant list, then a stable per-tenant
percentage bucket (§24 — 400 synthetic tenants at 30% land the same tenants every time). Rollback marks the
current version `ROLLED_BACK`, activates the target at 100%, refuses a DRAFT target, and writes the audit row.

**A bug of my own caught by the suite's ordering:** the renderer used one shared `/g` regex. The §27 test made
`.test()` return true, the throw skipped the `lastIndex = 0` reset, and every later `matchAll` cloned the regex
starting mid-string — reporting a declared variable as "never used". Fresh regex per use now, with the
explanation in a comment.

The legacy `ai-prompts.ts` role table is annotated as such and stays for the free-form assistant surface until
Phase 23 migrates each package onto a task key; nothing new goes there.


---

## Phases 9–10 — Context Builder, PII, Structured Output (done)

**`ai-output-schemas.ts` (§72–§76, §136, §285–§286).** Fourteen closed schemas, one per task output key, with
exact two-way coverage against the task registry and prompt seed. The validator is purpose-built (the tree has
no validation library, and adding one is a dependency decision it has not made): required, enum, bounded string,
bounded number/integer, boolean, bounded array, nested object. Three properties matter most and are each
mutation-tested:
- **Extra keys are stripped, not passed through** — a hallucinated `refund_cents` or `tenant_id` never reaches
  a domain service (§136).
- **Enum case is normalised but the set is fixed** — `NEGATIVE` becomes `negative`; `angry` is refused.
- **Repair is bounded to exactly one attempt** (§74). A second invalid response fails with both problem lists;
  a mutation that added a third attempt failed the suite.
Confidence (§75) is read only where the schema declares a model-supplied source; a schema declaring none returns
`undefined` even when the model volunteers a number. Two guards enforce this; removing either alone still passes,
removing both fails — documented in a comment.

`validateWithRepair` is the §285 pipeline: parse → validate → (one repair) → value, throwing
`AI_OUTPUT_SCHEMA_INVALID` (502) on failure. The status vocabulary has no path from `FAILED_VALIDATION` to
`COMPLETED` without a new provider call (§286).

**`ai-context-builder.ts` (§55–§62).** Two protections in order. First, §60 **by field name**: `password`,
`otp`, `cvv`, `card_number`, `auth_token`, `api_key`, `merchant_secret` and their variants are refused at build
time as a programming error (500), and a caller cannot launder `cvv` by declaring it `PUBLIC` — the name check
runs regardless of the declared class. Constitution 8's `FORBIDDEN_AI_PAYLOAD_KEYS` is the opposite direction
(what may not be *logged*); this is what may not be *sent*. Second, §62 **free-text redaction** for things that
arrive by content rather than field: Luhn-checked card numbers (so an order number of similar shape is left
alone), SSN shapes, stated auth codes, API-key and bearer-token shapes, and email/phone unless the task allows
them. §61 masks financial fields to their last four unless the workflow is approved. §58 pseudonymizes PII the
task can do without, with a stable per-tenant hash so the same customer is the same token within a tenant and
unrelated across tenants. §57 truncates an over-budget string but **refuses** an over-budget object — a
truncated JSON is a lie. The manifest records classes, counts and redactions, never values (§116).

One test-setup error of mine: the total-ceiling test left per-field budgets at 500, so both fields were
truncated before the total could trip. Fixed in the test with the reason recorded.


---

## The one entry point — `AiPlatform.execute()` (done)

`src/ai/ai-platform.ts` is §6–§8 as a single method. Every AI call passes through, in order: task resolution
(§9) → entitlement **before any provider, prompt or context work** (§92, reusing the existing
`loadSnapshot → evaluateAiAccess` flow and the blocked_* usage statuses) → the prompt version that serves this
tenant (§23) → classified, redacted, budgeted context (§56) → typed render with untrusted delimiting (§26–§28)
→ route (§12) → breaker-aware call with one transient retry on the same provider and failover to a compatible
alternative (§79, §85) → schema validation with one bounded repair on the *same* provider (§73–§74) →
confidence and approval policy deciding `COMPLETED` vs `NEEDS_REVIEW` (§41, §76) → usage row with **real
token pricing** from the model registry (§96 — the existing gated path wrote `costMicroUsd: 0` with a comment
calling it honest; it was, and it no longer needs to be).

`AIResult` carries provenance (provider, model, prompt key, prompt version, content hash, routing policy
version, repair and attempt counts, any failover) so §22/§78/§242 reproducibility is a property of every result
rather than a log lookup. The context manifest records classes and counts, never values (§116). §87 idempotency
keys are tenant-scoped — a mutation removing the tenant from the key failed the cross-tenant test.

`providerFor(provider, model)` was added to `ai-providers.ts` — the same file as `selectRealProvider`, so the
adapter boundary the gate enforces is unchanged. `KyselyPromptStore` reads the seed **union** the
`ai_prompt_versions` table (a row overrides the seed for the same version; higher rows extend it), so a fresh
database serves prompts immediately and a Super Admin's later versions win without a redeploy. Tested against
the real migration on PGlite, including rollback and the immutability trigger through Kysely.

Twenty end-to-end tests against scripted providers: blocked-before-provider, one repair, two bad bodies →
`FAILED_VALIDATION` with a failed usage row carrying the real cost, transient retry, permanent-no-retry,
recorded failover, **§80 HIGH-risk failover refused with the backup provider never called**, all-down → 503,
missing adapter skipped, prohibited context refused, redaction visible in what the provider received. Eight
platform-level mutations all caught, including "cost always 0" — the old behaviour.

`AiPlatform` is now provided and exported by `AiModule`; the DI gate confirms every token resolves.


---

## Phase 23 — migrating the callers (3 of 4 done, 1 remaining)

`ai-money-protection`, `ai-queue-assignment` and `ai-voice-transcription` now call
`AiPlatform.execute()` through a thin typed adapter (`ai-platform.adapters.ts`). Each module keeps its own
narrow port (§18), so its tests inject a fake of the platform's *validated output shape* rather than raw
provider text. Queue's duplicated usage logger is deleted — the platform owns that. Voice's **minutes** logger
stays: it meters transcribed audio minutes, the unit its package is sold in, which is a different fact from the
per-call token usage the platform records. Two units, two rows, not duplication.

Deliberately kept in each module: the deterministic fallback (an AI outage must never break alert review or
queue explanation) and each module's own output sanitizer. `finalizeExplanation`'s accusation filter is defence
in depth over schema validation — **a schema guarantees shape, not acceptable words.**

### A registry error the migration caught
The registry declared `queue.recommend_assignment`, assuming the module asked a model to rank technicians from
an eligible shortlist. It never did: `ai-queue-assignment-engine` ranks deterministically via
`scoreTechnician()`, and the only model call in the module explains a ranking that already exists. Corrected to
`queue.explain_recommendation` across task registry, output schema, prompt seed and adapter — and the corrected
task is the stricter reading of §45, not a looser one. The existing tests caught all three places the rename had
to reach.

### The tightened gate found what I would have missed
With raw gateway use outside `src/ai/` promoted from a note to a fatal failure, `check:ai-platform` immediately
flagged `ai-marketing` — a module I had classified as already safe, because it uses `GatedAiCompletion`. The
reason was real: its **no-database branch returned a raw, ungated gateway**, while its own comment claimed it
was "left unbound rather than silently allowing a paid call." It was not. That was the last ungated provider
path in the tree, and it now denies. Both violation forms (a field typed `AiGatewayService`, and a bare
`new AiGatewayService(...)` not handed to `GatedAiCompletion`) are mutation-tested.

### The documented exception
`ai-assistant.service` keeps its own entitlement + usage path. It is the free-form assistant surface, and §9
forbids an arbitrary-prompt *task*, so it cannot become one; it lives inside the platform directory and gates
itself. The gate reports it as a note with that reasoning attached. Its entitlement check had been invisible to
the gate because the pattern list omitted `evaluateAiAccess` — a false negative, now fixed.

### ai-marketing — the fourth caller (done)
Ported carefully, because its prompt is load-bearing: `validateDraft` rejects invented offers, unknown tokens,
raw URLs, self-added opt-out wording and over-length SMS, and every one of those rejections only makes sense if
the model was told the rule.

Two things had to change to fit the constitution. First, the old system string was **dynamic** — offer rule,
channel rule, tone and language were concatenated per request — and §27 requires static instructions. The
invariant rules became the registered version's `systemInstructions`; the per-request rules became typed
variables built by a new `buildPromptVariables()`, which shares its helpers with the legacy `buildPrompt()` so
the two cannot describe different rules. Second, the registered schema was `{headline, body, cta}` — a generic
ad shape fitting none of the three channels the module supports. Corrected to `{subject, message}`, where
`subject` is the email subject or push title and null for SMS, and the service recomposes **exactly** the
string `validateDraft` has always received (`subject\n\nbody` for email, `title\nbody` for push, the message
alone for SMS). Changing what the validator sees would have silently weakened every rule it enforces.

One rule could not survive the move verbatim: the instruction naming the literal `{{booking_link}}` token,
because §27 forbids brace pairs in static instructions — and that rule is right, since a typo'd variable in an
instruction would otherwise ship silently. The token list now lives only in the `allowed_tokens` variable,
which is also the module's single source for it.

A new test renders the actual registered prompt and asserts every rule `validateDraft` enforces appears in what
the model receives — the drift this port makes possible. Four mutations (removing the opt-out rule, the
no-invention rule, the URL rule; weakening the offer rule) each fail it.

**All four raw callers are now migrated.** The only module holding a gateway is `ai-assistant` inside the
platform directory, for the documented §9 reason.

Full API battery after the migration: **6,458 tests across 8 shards, 0 failures.** 16/16 gates.


---

## Budgets, rate limits, jobs and fair queueing (§65–§70, §99–§108)

Migration 437 adds `ai_jobs`, `ai_job_attempts`, `ai_budgets`, `ai_budget_alerts`. **This is not a second
outbox.** Migration 433's `event_outbox` carries domain events between modules; these rows are units of *AI
work* with their own lifecycle (provider attempts, validation, human review) and their own scheduling rules. An
event that needs AI creates a job; the two stay separate. `input_reference` is deliberately a **pointer**, not a
payload — §60 prohibited data must not be able to sit in a queue row, and a job row is not a place to park
customer text. Attempts are separate rows (§70), so a job that failed over from one provider to another has two,
each with its own provider, model, error and cost; that is what makes failover analysis and cost accounting
possible at all.

`ai-budget-scheduler.ts` keeps two decisions apart that are easy to conflate: **may this run** (budget) and
**which runs next** (scheduler).

§103 is the rule worth stating plainly: a tenant queueing 100,000 forecasting jobs must not delay another
tenant's live receptionist call. **Priority alone does not achieve that** — 100,000 P1 jobs from one tenant
would still starve everyone else — so the scheduler caps how many of one batch a single tenant may take *at the
same priority*, while still letting a P1 call beat any tenant's P4 backfill. The cap is anti-starvation, not a
throughput ceiling: once every tenant has had its share, deferred work refills the batch rather than leaving
workers idle (§108).

§101's at-limit behaviours make a judgement explicit: under `block_low_priority`, analytics and bulk stop but
**a HIGH-risk money alert explanation keeps working**. Stopping that to save a fraction of a cent would be the
wrong trade. `block_all` stops even safety work, which is why it is a separate, deliberate setting.

### Two mutations survived the first pass — both were real test gaps
- The tighter-leash test left the tenant budget well under its limit, so *which* budget was consulted first was
  never observable; removing the sort still passed. Rewritten with both budgets exceeded and different
  behaviours.
- The §108 refill test used a single tenant, so nothing was ever deferred and the refill loop was never
  exercised; deleting it still passed. Rewritten with two capped tenants and a batch larger than their shares.

All seven mutations now fail the suite. The rate limiter checks every rule before incrementing any, so a
request refused by a hard limit does not burn its softer allowances — also mutation-tested.


---

## Tool Registry (§29–§35, §134–§135)

`ai-tool-registry.ts` makes a tool *possible* to declare; it does not grant one. **Every task still has
`allowedTools: []`**, and a test asserts that — turning a tool on for a task stays a separate deliberate act.

Six tools, all `read` or `propose`. There is deliberately no tool with effect `write`: no booking, no charge, no
refund, no message send, no permission change. §31 lists those under "Not", and a test runs every tool key
against forbidden patterns (`sql`, `execute`, `refund`, `payment`, `permission`, `delete`, `send_*`) so the
registry cannot quietly acquire one. `appointment.create_proposal` writes a *proposal* a human converts; there
is no `appointment.create`, because adding one would put an LLM in charge of the calendar.

The gateway implements §32's chain, each step able only to narrow: known tool → allowed for *this task* →
**the actor's** permission → argument validation → server context injected **last** → approval. A model naming
a real tool it was not granted is denied; a model naming a tool whose permission the actor lacks is denied 403.

### The §135 finding
Three independent things stop a model choosing a tenant: server-owned keys are stripped before validation,
validation drops undeclared keys, and server context merges last. **Mutation testing showed the first and third
could each be removed without failing a test** — the second was silently covering for them. That second layer
only holds while no tool *declares* a colliding field, so I added the invariant that pins it.

It failed immediately on the clean tree: `schedule.read` and `queue.read` both declared `branch_id`. That was a
real design error of mine, not a bad assertion — §135 makes `branchId` server-derived, so a model must no more
choose a branch than a tenant. Both tools now take no branch argument at all, and the consequence is
deliberate: the AI reads the branch the **actor** is working in, and a multi-branch tenant's assistant cannot
reach across branches by asking nicely.

`validate()` gained an optional inline-rule parameter rather than growing a second validator for tool
arguments — two implementations of "valid" is two places for them to disagree.

Six mutations on the authorization chain; the four that were genuinely load-bearing each fail the suite, and
the two that were masked are now pinned by the invariant above.


---

## Safety Policy Engine and decision trace (§109–§118)

`ai-safety-policy.ts` is the one place that decides what a task may do for a given tenant, and it is wired into
`AiPlatform.execute()` so it governs at runtime rather than sitting beside it.

**§110 shapes the whole file: a tenant may tighten safety, never weaken it.** Every setting composes by taking
the stricter of platform and tenant — automation via `stricter()`, tools by removal only, PII by intersection.
There is no code path where a tenant setting raises a ceiling, and a test asserts it for *every* task by forcing
`AUTOMATIC` and checking the result never exceeds the platform maximum. A tenant that asks for more is told so
in the decision's reasons rather than silently ignored.

**§113's kill switch has a subtlety worth naming:** turning off automatic AI *actions* must not turn off
read-only AI *insight*. An owner who hits the switch because a draft went wrong should still be able to read why
a money alert fired. So the switch **clamps the automation level to SUGGEST_ONLY rather than disabling the
task** — the result still comes back with its data, marked `NEEDS_REVIEW` and carrying the reason. A mutation
that made the switch disable the task outright fails the suite.

The §112 examples are implemented exactly as the constitution words them: review response is `DRAFT`, queue is
`SUGGEST_ONLY`, scheduling is `APPROVAL_REQUIRED`. A test cross-checks every ceiling against the task's own
approval policy, so a `REVIEW_BEFORE_USE` task can never be listed as `AUTOMATIC` — the two tables cannot drift.

`AiAuditRecord` implements §115 by what it *lacks*: there is no `prompt` field. It keeps the prompt version and
a sha256 of the rendered input, which is enough to reproduce a run and prove two runs saw the same thing,
without parking customer text in an audit table. A test asserts the shape contains none of the forbidden keys.

`citedFactorsAreReal()` checks §118 structurally: every factor an explanation cites must be a factor the
deterministic engine actually produced. It cannot prove prose is honest — nothing can — but it catches the
specific failure §118 names, an explanation resting on a factor the engine never computed.

Eleven mutations across the engine and its platform wiring, all caught on the first pass.


---

## AI events and the Super Admin control plane (§161–§165, §171–§176)

**The finding:** Constitution 8 registered five `ai.*` events and **nothing ever emitted any of them** — the
exact "registered but unemitted" defect class the realtime contract gate was built to catch, sitting in the
event vocabulary the whole time. §161 names seven; the two missing (`ai.job_started`, `ai.approval_required`)
are now registered, and all seven have a producer in `AiPlatform.execute()`.

A completed call announces `requested → started → usage_recorded → completed`; a validation failure announces
`job_failed` with the real cost and no completion; a safety block announces `safety_event_detected`. A
`NEEDS_REVIEW` result announces `ai.approval_required` so the Notification Service can raise it — §165 forbids
an AI module wiring itself to APNs, Twilio or email, so the platform states the fact and someone else decides
how to tell a human. Publishing goes through Constitution 8's **existing outbox**, not a second transport, with
`requestId` as both aggregate id and correlation id so every event of one execution traces together, and
`actorType: 'ai'` which §190 provides for exactly this producer. A test asserts every emitted type is in the
registered vocabulary, and another asserts no payload carries prompt or response text.

Publishing is best-effort by design: a mutation that let an outbox failure propagate would fail a completed AI
call, which is the wrong trade — announcing is not the work.

**A bug my own casts hid:** the first outbox wiring compiled only because of `as never`. Removing the casts
showed `aggregateType`, `aggregateId` and `correlationId` are required fields I had not supplied.

`ai-control-plane.ts` (§171–§176) is a **view, not a store** — every figure derives from `ai_usage_logs`, the
circuit breakers, and the registries. An `ai_metrics` table would be a second source of truth for numbers the
usage ledger already holds. Two honesty rules are enforced by test: an idle platform reports `successRate:
null`, **not a flattering 100%** — showing 100% when nothing has been measured tells a Super Admin everything
is fine when nothing is known — and §174's quality score is `null` until evaluations exist, because an invented
score is worse than none.

§173's "No credentials displayed" is checked by grepping the source. That test failed on first run against the
file's **own comment quoting the rule** — the same trap as the `sk-` pattern that matched "ai-task-registry"
earlier in this arc. It strips comments now and scans code only.


---

## Evaluations (§119–§128)

`ai-evaluation.ts` exists to enforce §123: **never replace a model just because a newer one exists.** A
candidate must beat the incumbent on an evaluation set first, and "beat" is defined precisely enough that the
comparison yields a verdict with named regressions rather than one number to squint at.

**§121 — the golden cases are synthetic, and a test enforces it.** Nothing here comes from a real customer,
receipt or call. That is not fastidiousness: a real review checked into a fixture is a privacy incident that
ships with the repo, which is exactly the "private production customer data casually" §121 forbids. The
fixtures are scanned for contact details, card numbers and government-id shapes.

Ten cases, each able to fail for one identifiable reason — a hundred that fail together say less than six that
fail separately. They cover the failures that actually matter: sarcasm (positive words, negative meaning — the
case a prompt edit most often breaks), an injected instruction inside review text, a review *demanding* a refund
where the draft may apologise but never promise money, an explanation proposing a different technician than the
engine chose, and a report narration reaching for a cross-tenant comparison it was never given.

**The verdict rules, in order of authority:** any safety regression → **reject**, not "weigh it against the
quality gain" — a candidate that newly promises a refund is not a trade-off, it is a defect. Then a lower pass
rate → reject. Then named non-safety regressions → hold for a human even when the net is positive. Then
materially worse cost or latency *with no quality gain* → hold. A test confirms a candidate that improves
overall quality while breaking one safety case is still rejected.

§127 assignment uses **the same hash bucketing as the prompt rollout**, asserted by test, so a tenant's canary
membership cannot flicker between the two mechanisms. §126 is enforced by refusing to assign variants on a
HIGH-risk task unless an explicit policy argument says so — the default is refusal.

§128 metrics report `null` for an unmeasured dimension rather than zero: an unknown acceptance rate is not a
bad one, and the §174 quality score stays null until real runs exist for the same reason.

### A flaky-by-construction test, caught by mutation
The determinism test checked one subject twice against two variants — which a **random** implementation passes
half the time, and a mutation proved it. Rewritten to check forty subjects twice each; re-run three times
against the random mutation, it fails every time.


---

## Human feedback, tenant dashboard, adversarial suite (§129–§132, §166–§170)

**§129 says feedback "becomes evaluation data" — and the useful part of a correction is what changed and why,
not the customer's words.** A table of human-edited AI output is a table of customer content under another
name, so migration 438 stores an outcome, a closed-vocabulary reason code, a short **staff-written** note, and
how much of the draft survived. Validation refuses any record carrying `draftText`, `editedText`,
`originalText`, `reviewText` and the rest. §130's isolation then costs nothing to guarantee: there is no
cross-tenant read path, and nothing stored is worth pooling.

Two coherence rules fall out of taking §129 seriously: an `edited` outcome without a retained ratio is refused,
because it carries no more information than `rejected`; and an `accepted` outcome may not carry a reason code.
Empty feedback reports every rate as `null` — nobody rejecting is not everybody rejecting.

**§168 and §169 are absences, which are easy to violate by being generous.** A technician gets `ai.read` and
nothing else — *not* usage, because usage is the tenant-wide analytics §168 says not to expose automatically. A
receptionist may draft and specifically may not touch settings. Tests assert both as negatives, and mutations
adding either permission fail.

The tenant dashboard **omits a forbidden section and names it in `hidden`** rather than returning it empty — an
empty usage panel and a forbidden one look identical to a user, and one of them is a lie about the data.
Pending approvals are filtered to what the role can actually grant, so a manager never sees a reconciliation
approval they cannot act on.

`ADVERSARIAL_INPUTS` collects §131's attack classes in one place — ignore-instructions, reveal-system-prompt,
call-unauthorized-tool, cross-tenant fetch, delimiter escape, tenant-id override — and the suite runs each
through the real renderer, the real tool gateway and the real context builder. Every one fails safely: exactly
one closing tag survives whatever the attack, an unauthorized tool is denied by name *and* by task grant, a
tenant-id override is overruled by server context, and a smuggled `api_key` field is refused at build time.
And every declared task still grants zero tools, so none of it is reachable by default anyway.

Seven mutations on the feedback guards and permission defaults, all caught.


---

## Tenant knowledge / RAG (§143–§150)

**§145 is a decision this pass made rather than deferred:** "do not introduce a vector database unless semantic
retrieval is actually required." A salon's knowledge is a handful of policy documents — hours, cancellation
terms, FAQs. Postgres full-text over that is the correct tool, not a compromise. So migration 439 adds no
vector extension and the implementation has no similarity search, asserted by a test that greps both the source
and the SQL.

What it *does* have is the shape that makes adding embeddings a migration rather than a rewrite: chunks are
already separate addressable rows, and `embedding_model_version` exists from the first row so §147 — never
silently mix incompatible vector spaces — is enforceable the day anything is embedded. `assertSingleVectorSpace`
is written now because writing it after a half-migrated index is in production costs a re-embedding run and a
stretch of quietly wrong answers.

**§144's rule is a structural one, not an ordering preference:** search must filter *before* retrieval, never
retrieve globally and filter after. A global search that filters afterwards has already put another tenant's
text in the candidate set, so a ranking bug or a later "optimization" leaks it. `buildRetrievalFilter` produces
the mandatory predicates and `assertFilterIsSafe` refuses a query missing any of them. The tests prove exclusion
happens in the **filter** — another tenant's chunk is not merely ranked lower, it never becomes eligible.

`staff_private` is in no visibility list at all, so §150's "employee-private document should not automatically
become receptionist knowledge" holds for every role including OWNER. `READY` is specifically not AI-readable:
processed is not approved, and `DRAFT → PUBLISHED` is not a legal transition. Eight mutations, all caught.

Not a second `help_articles` (migration 142): that table is *platform* product documentation with no tenant
column; this is a tenant's knowledge about their own salon.

---

## §304 Definition of Done — checked, not asserted

`npm run check:ai-dod` evaluates all 72 items as predicates against the tree — file contents, migration text,
the boundary gate, the type checker, the linter and the test run. A DoD that marks itself complete is not a
DoD, so anything unverifiable reports as such.

**66 done · 4 partial · 2 not done.**

Partial, with the reason recorded in the script itself:
- **Pricing versions** — prices exist and are the single source, but are not themselves versioned rows (§96/§218).
- **Realtime progress** — lifecycle events publish, but no SSE room streams `ai.job.progress` to clients (§164).
- **Super Admin control plane** — the read model is built and tested; no controller or UI is wired.
- **Tenant AI usage UI** — same: read model yes, UI no.

Not done:
- **Load tests** — none exist for AI. The realtime arc measured capacity; this one has not.
- **Tenant AI settings UI** — settings are modelled (`TenantSafetySettings`, honoured by the platform at
  runtime) but there is no screen.

The four partials and two gaps are all UI/ops surface or measurement, not platform rules. Every architectural
item — one entry point, task registry, model routing, immutable prompts, structured output, safety policy,
tool authorization, budgets, jobs, events, evaluations, knowledge isolation — verifies.
