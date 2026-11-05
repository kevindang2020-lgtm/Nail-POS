# AI PowerSalon — AI Platform Architecture Report
### Constitution 10 (305 sections) · §305 required final report · September 20, 2026

Base tree: the July snapshot `f420cfe`, same base as Constitutions 8 and 9. **Not yet landed on
`Power-Salon-main`.** Commits `baf37c3` … `3c11a9c`.

---

## 1. Existing AI Discovery

| | Found |
| --- | --- |
| **AI modules** | 18 tenant modules (`ai`, `ai-analytics-forecasting`, `ai-booking`, `ai-business`, `ai-center`, `ai-checkout-upsell`, `ai-customer-profile`, `ai-governance`, `ai-inventory`, `ai-marketing`, `ai-money-protection`, `ai-ocr-receipt`, `ai-queue-assignment`, `ai-readiness`, `ai-revenue`, `ai-review-reputation`, `ai-scheduling-optimizer`, `ai-voice-transcription`) + 8 `super-admin-ai-*` |
| **Provider SDKs** | **None.** No module imports `openai`, `@anthropic-ai/*` or any SDK. Provider HTTP lived in one file already: `src/ai/ai-providers.ts` (OpenAI, Anthropic, Gemini via a shared `postJson`) |
| **Models** | Chosen by env in `resolveAiProvider()`. No registry, no per-task allow-list, no status |
| **Prompts** | `ai-prompts.ts` role strings per package, plus `SYSTEM` constants inside modules. No versions, no rollout, no rollback |
| **Workers** | Per-module. No shared AI job table, states or attempts |
| **Queues** | None for AI. Constitution 8's `event_outbox` carries domain events, not AI work |
| **Usage tracking** | `ai_usage_logs` (091) + `ai_usage_cost` (093) existed; Constitution 8's `ai.usage_ledger` consumer already enforced forbidden payload keys |
| **Cost tracking** | `ai-pricing.ts` existed. The gated path wrote `costMicroUsd: 0` with a comment calling that honest — it was, because no per-model cost was computed |
| **Safety controls** | `ai-access-gate.ts` entitlement only. No risk levels, no PII classification, no approval policy, no automation levels |

## 2. Problems Found

1. **Two entry points, and the safe one was barely used.** `GatedAiCompletion` (entitlement → provider → usage) was used by **`ai-marketing` alone**. Four modules called `AiGatewayService` raw, each gating differently: `ai` logged usage but checked no entitlement; **`ai-money-protection` checked entitlement but logged no usage — a HIGH-risk money explanation that cost real money and attributed it to nobody**; `ai-queue-assignment` and `ai-voice-transcription` each did both in their own code. Two of four were half-right in opposite directions.
2. **An ungated provider path hiding behind a comment.** `ai-marketing`'s no-database branch returned a **raw gateway**, while its comment claimed it was "left unbound rather than silently allowing a paid call." It was not. Found only when the boundary gate was promoted from advisory to fatal.
3. **Five `ai.*` events registered by Constitution 8 with zero producers** — the "registered but unemitted" defect class, sitting in the vocabulary unnoticed.
4. **Prompts overwritten in place.** `ai_global_prompts` has `UNIQUE (prompt_key)` and an integer `version` bumped on edit: every change destroyed the previous text, and no historical result could know what produced it.
5. **A prompt that violated the architecture it served.** `ai_analytics_forecasting`'s role string began "You forecast sales and appointment demand" — §44 forbids an LLM as the numerical forecaster.
6. **Hard-coded models**: provider and model came from env, so every tenant and every task shared one model regardless of risk or cost.
7. **No cost tracking in practice**, no tenant AI budgets, no rate limits, no fair queueing.
8. **No structured validation.** Provider text was parsed ad hoc per module; a provider 200 was treated as success.
9. **Cross-tenant risk surface**: no PII classification before a provider call, no prohibited-field check, no delimiting of untrusted content, no tenant-safe knowledge retrieval.
10. **Unsafe tool surface**: none existed, which is safe — but nothing prevented one being added without authorization.

## 3. Final AI Architecture Diagram

```
  AI MODULE  (ai-review-reputation, ai-money-protection, ai-queue-assignment, …)
      │  depends on its OWN narrow port; a thin adapter maps it to the platform
      ▼
  AiPlatform.execute(AIRequest)                                    ← the one entry point
      │
      ├─ 1  resolveTask ...................... §9   unknown task refused first
      ├─ 2  evaluateAiAccess ................. §92  entitlement BEFORE any provider work
      ├─ 3  evaluateSafety ................... §109 automation ceiling, kill switch, task on/off
      ├─ 4  selectVersion .................... §23  the prompt version serving THIS tenant
      ├─ 5  buildContext ..................... §56  classified · redacted · budgeted
      ├─ 6  render ........................... §26  typed variables, untrusted DELIMITED
      ├─ 7  route ............................ §12  capability + risk + tenant policy + health
      ├─ 8  provider call .................... §79  breaker-aware · 1 retry · compatible failover
      │        └─ ai-providers.ts ............ §17  the ONLY file with provider HTTP
      ├─ 9  validateWithRepair ............... §73  schema; ONE bounded repair
      ├─ 10 confidence + approval ............ §41  COMPLETED vs NEEDS_REVIEW
      └─ 11 usage + cost + events ............ §92  real token pricing; 7 ai.* events
      ▼
  AIResult<T>  { status, data, confidence, risk, approval, automation, mayActAutomatically,
                 provenance{provider,model,promptKey,promptVersion,contentSha256,routingPolicyVersion},
                 usage{tokens,costMicroUsd,latencyMs}, contextManifest, warnings }
```

**§285 in one line:** a provider 200 is not completion. `FAILED_VALIDATION` has no path to `COMPLETED` without a new provider call.

## 4. AI Platform Package Structure

| File | Role |
| --- | --- |
| `ai-platform.ts` | **The one entry point** (§6–§8). `execute()`, `callWithFailover()`, usage, events |
| `ai-platform.adapters.ts` | Thin module↔platform adapters (money, queue, voice, marketing) |
| `ai-task-registry.ts` | §9–§11 the allowed tasks, with risk, ceilings, approval policy |
| `ai-model-registry.ts` | §14–§16 models as data; cost from the existing price table |
| `ai-model-router.ts` | §12–§13, §77–§80 selection and failover |
| `ai-provider-health.ts` | §17, §81–§86 adapter contract, breakers, error classification |
| `ai-prompt-registry.ts` | §21–§28 versions, typed variables, untrusted delimiting, rollout, rollback |
| `ai-prompt-store.kysely.ts` | Seed ∪ `ai_prompt_versions` |
| `ai-output-schemas.ts` | §72–§76, §285–§286 schemas, validation, bounded repair, confidence |
| `ai-context-builder.ts` | §55–§62 data classes, prohibited fields, redaction, budgets |
| `ai-safety-policy.ts` | §109–§118 automation levels, kill switch, audit shape, decision trace |
| `ai-tool-registry.ts` | §29–§35, §134–§135 tools, authorization chain, server-derived context |
| `ai-budget-scheduler.ts` | §99–§108 budgets, thresholds, rate limits, fair-share scheduling |
| `ai-evaluation.ts` | §119–§128 golden cases, regression verdicts, experiments |
| `ai-feedback.ts` | §129–§132, §166–§170 feedback, permissions, tenant dashboard, adversarial corpus |
| `ai-knowledge.ts` | §143–§150 tenant knowledge, filter-before-retrieval |
| `ai-control-plane.ts` | §171–§176 Super Admin read model |
| `ai-providers.ts` | §17 the only file containing provider HTTP (pre-existing; `providerFor()` added) |

Scripts: `check:ai-platform` (boundary gate), `check:ai-dod` (§304), `measure:ai-capacity` (§45), `eval:ai` (§37).

## 5. AI Task Registry

14 tasks. Every one declares capability, allowed providers, output schema, risk, mode, token/timeout ceilings, cache TTL, approval policy, temperature, allowed tools, and a written risk rationale.

| Task | Risk | Approval | Max automation |
| --- | --- | --- | --- |
| `review.sentiment_analyze` | LOW | NO_APPROVAL | AUTOMATIC |
| `review.response_draft` | MEDIUM | REVIEW_BEFORE_USE | DRAFT |
| `voice.transcribe` | LOW | NO_APPROVAL | AUTOMATIC |
| `voice.summarize` | LOW | NO_APPROVAL | LIMITED_AUTOMATION |
| `ocr.receipt_extract` | MEDIUM | REVIEW_BEFORE_USE | APPROVAL_REQUIRED |
| `forecast.explain` | LOW | NO_APPROVAL | LIMITED_AUTOMATION |
| `queue.explain_recommendation` | MEDIUM | REVIEW_BEFORE_USE | SUGGEST_ONLY |
| `schedule.explain_suggestion` | MEDIUM | REVIEW_BEFORE_USE | APPROVAL_REQUIRED |
| `reconciliation.explain_exception` | HIGH | REVIEW_BEFORE_USE | SUGGEST_ONLY |
| `money.explain_alert` | HIGH | REVIEW_BEFORE_USE | SUGGEST_ONLY |
| `receptionist.reply_draft` | MEDIUM | REVIEW_BEFORE_USE | DRAFT |
| `marketing.content_draft` | LOW | REVIEW_BEFORE_USE | DRAFT |
| `business.report_narrate` | LOW | NO_APPROVAL | LIMITED_AUTOMATION |
| `checkout.upsell_suggest` | MEDIUM | REVIEW_BEFORE_USE | SUGGEST_ONLY |

**What is deliberately absent is the more important half.** There is no `ai.run_arbitrary_prompt` (§9/§27: an open prompt endpoint is how injection becomes a system instruction). No `forecast.appointment_demand` or `forecast.revenue` (§44: an LLM is never the numerical forecaster). No `schedule.optimize`, no `queue.assign`, no `reconciliation.resolve`. **No task is CRITICAL** — payment capture, refunds, permission changes and suspension are not AI tasks at all, and a test asserts the registry can never acquire one by name.

## 6. Provider Registry

| Provider | Adapter | Status | Models |
| --- | --- | --- | --- |
| `openai` | `OpenAiProvider` | integrated | `gpt-4o-mini`, `gpt-4o`, `whisper-1` |
| `anthropic` | `AnthropicProvider` | integrated | `claude-3-5-haiku-latest`, `claude-3-5-sonnet-latest` |
| `gemini` | `GeminiProvider` | integrated | `gemini-1.5-flash`, `gemini-1.5-pro` |
| `mock` | `MockAiProvider` | dev/test only | `mock-1` — refused in production by two independent guards |

A test reads `ai-providers.ts` and asserts every registry provider name matches an adapter, so the two cannot drift. My first registry draft called the third provider `google` and marked it disabled for "having no adapter"; `GeminiProvider` had been sixty lines further down the same file.

## 7. Model Registry

Each model declares provider, wire key, capabilities, status, context window, structured-output/vision/tool flags, tier, latency class and privacy metadata. **Cost comes from the existing `ai-pricing.ts` table** — §96 wants one cost registry, and this tree already had one. Only `ACTIVE`/`BETA` are routable; `DEGRADED`, `DISABLED` and `DEPRECATED` are invisible to the router, so taking a model out of service is a one-line status change.

`whisper-1` had no price row and would have billed at the placeholder; it is now priced per audio-second (≈$0.006/min) with the §93 caveat that the ledger needs an audio-seconds unit.

## 8. Model Routing

`route(task, { tenant, health, env, excludeProvider })`. §13's "do not automatically use the most expensive model" is implemented as a tier preference derived from the task's **declared shape**, never a per-module opinion:

- `text.classify` → `fast`; HIGH risk and `vision.extract` → `strong`; `text.summarize` → `fast`; otherwise `balanced`
- within a tier, cheapest wins; ties break on latency
- a task-declared `defaultModel` outranks the heuristic
- a tenant may **block providers or pin a model, and may only ever narrow** what the task allows
- cost-sensitive tenants get the cheapest capable model regardless of tier

Every decision carries `routingPolicyVersion: 'routing.v1'` and a written reason (§78).

## 9. Provider Failover

Exact behaviour:

1. Chosen provider fails → `classifyError` sorts it into `PERMANENT` / `RATE_LIMITED` / `TRANSIENT` / `TIMEOUT`.
2. `PERMANENT` (400/401/403/404/413/422) → **no retry, no breaker trip**, `AI_PROVIDER_REJECTED` 502. A malformed request is the request's fault; it must not take a healthy provider offline for every tenant.
3. `TRANSIENT`/`TIMEOUT` → one retry on the same provider after 250 ms. `RATE_LIMITED` skips the immediate retry.
4. Second failure → the breaker records it and the router is re-asked with that provider excluded; up to three hops.
5. **§80: a HIGH-risk task refuses to change provider.** `HighRiskFailoverRefused` rather than a silent substitution — tested with the backup provider asserted never to be called.
6. All providers exhausted → `AI_PROVIDER_UNAVAILABLE` 503, never a fabricated result.
7. Breakers open after 5 consecutive non-permanent failures, half-open after 30 s, one probe decides.

Any failover is recorded on `AIResult.provenance.failover` and surfaced in `warnings`.

## 10. Prompt Registry

14 prompt keys, one ACTIVE v1 each, with exact two-way coverage against the task registry enforced by test: a task cannot exist without a prompt, and a prompt cannot exist without a task.

`review.sentiment_analyze` · `review.response_draft` · `voice.transcribe` · `voice.summarize` · `ocr.receipt_extract` · `forecast.explain` · `queue.explain_recommendation` · `schedule.explain_suggestion` · `reconciliation.explain_exception` · `money.explain_alert` · `receptionist.reply_draft` · `marketing.content_draft` · `business.report_narrate` · `checkout.upsell_suggest`

Each version stores system instructions, template, typed variables, output schema key, language behaviour, status, rollout, approvers and a sha256 of its content. **Migration 436 enforces immutability with a BEFORE UPDATE trigger** that raises on any change to a content column; only lifecycle columns move. Verified on PGlite: a status update succeeds, a template edit is refused, a duplicate version is refused, a rollback reason under ten characters is refused.

## 11. Prompt Rollout

`DRAFT → TESTING → ACTIVE → DEPRECATED | ROLLED_BACK`. Selection order: a `TESTING` version for tenants explicitly listed on it (internal testing), then `ACTIVE` with this tenant listed, then `ACTIVE` at a stable percentage bucket. **Bucketing is a sha256 of (tenant, promptKey)** — 400 synthetic tenants at 30% land the same tenants every run, and it is the **same function the evaluation canary uses**, asserted by test, so a tenant's membership cannot flicker between the two mechanisms.

Rollback marks the current version `ROLLED_BACK`, activates the target at 100%, refuses a `DRAFT` target ("it was never known-good") and a target already active, and writes a who/what/reason/when row. Tested through the real Kysely store against migration 436.

## 12. Context Builder

`buildContext(tenantId, fields, opts)` refuses to run without a tenant (§7). Each field declares a name, value, data class and character budget. §57 truncates an over-budget **string** but **refuses an over-budget object** — a truncated JSON is a lie. The whole context has a ceiling. The returned manifest records classes, counts and redactions, **never values**.

Knowledge retrieval (§143–§150) is separate and stricter: `buildRetrievalFilter` produces the mandatory predicates and `assertFilterIsSafe` refuses a query missing any. §144 is structural — **filter before retrieval, never retrieve globally and filter after** — and the tests prove exclusion happens in the filter: another tenant's chunk never becomes eligible, rather than ranking lower.

## 13. PII Protection

Two protections in order.

**§60 by field NAME, at build time.** `password`, `otp`, `cvv`, `card_number`, `auth_token`, `api_key`, `merchant_secret` and their variants throw `ProhibitedAiDataError` (500, a programming error). **A caller cannot launder `cvv` by declaring it `PUBLIC`** — the name check runs regardless of declared class. This is the mirror of Constitution 8's forbidden-key list: that governs what may not be *logged*; this governs what may not be *sent*.

**§62 free-text redaction**, second line by nature: Luhn-checked card numbers (an order number of similar shape is left alone), SSN shapes, stated auth codes, API-key and bearer shapes, email and phone unless the task allows them. §61 masks financial fields to their last four unless the workflow is approved. §58 pseudonymizes PII a task can do without, with a stable per-tenant hash — the same customer is the same token within a tenant and unrelated across tenants.

## 14. Structured Output

14 schemas, one per task, exact two-way coverage. The validator is purpose-built (this tree has no validation library, and adding one is a dependency decision it has not made): required, enum, bounded string, bounded/integer number, boolean, bounded array, nested object.

Three properties carry the weight: **extra keys are stripped, not passed through** (a hallucinated `refund_cents` never reaches a domain service); **enum case is normalised but the set is fixed**; **repair is bounded to exactly one attempt**, and a second invalid response fails with both problem lists. Confidence is read only where a schema declares a model-supplied source — a schema declaring none returns `undefined` even when the model volunteers a number.

## 15. AI Safety

Risk classes as implemented: **LOW** — a record or a label nothing acts on. **MEDIUM** — a human-visible recommendation or draft. **HIGH** — money and reconciliation: temperature 0, `strong` tier, no automatic action, no silent failover. **CRITICAL** — declared in the type and deliberately **unused**: payment, refunds, permissions, suspension are outside AI entirely (§40).

A design question the invariants forced: `voice.transcribe` was first MEDIUM/`NO_APPROVAL`, and the registry's own rule rejected it — a MEDIUM task is by definition a human-visible recommendation, and one nobody must see is an action. A transcript is a *record*, not a recommendation: LOW, with consent enforced before dispatch and redaction on the output.

## 16. AI Tools

| Tool | Permission | Scope | Approval |
| --- | --- | --- | --- |
| `booking.search_availability` | `pos.booking.view` | tenant+branch (server-derived) | none |
| `customer.lookup_limited` | `pos.customers.view` | tenant, minimal projection | none |
| `appointment.create_proposal` | `pos.booking.create` | tenant+branch | **required** |
| `schedule.read` | `pos.schedule.view` | actor's branch — **no branch argument** | none |
| `queue.read` | `pos.queue.view` | actor's branch — **no branch argument** | none |
| `review.create_response_draft` | `pos.reviews.respond` | tenant | **required** |

All `read` or `propose`; **none has effect `write`**. No booking, charge, refund, message send or permission change, and a test runs every key against forbidden patterns so the registry cannot quietly acquire one. **Every task still declares `allowedTools: []`** — this file makes a tool possible, it does not grant one.

The §135 finding is worth recording: three layers independently stop a model choosing a tenant, and mutation testing showed two of them could each be removed without failing a test. The invariant added to pin the third — no tool schema may declare a server-owned key — **failed immediately on the clean tree**: `schedule.read` and `queue.read` both declared `branch_id`. A real design error. Both now take no branch argument, so the AI reads the branch the **actor** is in and a multi-branch tenant's assistant cannot reach across branches by asking.

## 17. Human Approval

Automation levels `OFF < SUGGEST_ONLY < DRAFT < APPROVAL_REQUIRED < LIMITED_AUTOMATION < AUTOMATIC` — the array order *is* the comparison. §112's examples are implemented as worded: review response `DRAFT`, queue `SUGGEST_ONLY`, scheduling `APPROVAL_REQUIRED`. A test cross-checks every ceiling against the task's own approval policy so the two tables cannot drift.

**§113's kill switch clamps rather than disables.** Turning off automatic AI *actions* must not turn off read-only AI *insight* — an owner who hits the switch because a draft went wrong should still read why a money alert fired. The result returns with its data, marked `NEEDS_REVIEW`, carrying the reason.

## 18. Tenant AI Settings

**Where they live (§52/§53).** The safety engine honoured `TenantSafetySettings` from the first commit of this
arc — and until now **nothing ever stored them**. A tenant could not change a setting the platform was already
obeying, which is the worst of both: a working mechanism, unreachable. They now persist in the **existing**
`tenant_settings` table (migration 016) under category `ai-platform`; a second AI-specific settings table would
have been the duplicate-architecture mistake this arc exists to avoid. `GET/POST /ai/dashboard/settings` read
and write them behind `ai.settings.manage` (§169).

**§110 is enforced on the WRITE, not only on read.** A payload asking for more automation than the platform
allows is **rejected with the ceiling named**, not stored and clamped at read time — storing a lie and
correcting it later shows the tenant a setting they do not actually have. Unknown task keys, tool names, levels
and setting keys are all refused, because a typo silently accepted reads to the tenant as "switched off".

**§53 branch settings layer over tenant-wide by tightening**: a branch may lower an automation level, never
raise it; a kill switch set at either level is on; disabled lists union; PII permission *intersects*, since
that is the loosening direction and a branch cannot permit what the tenant did not.

Hierarchy, strictest wins at every step: **platform task ceiling → tenant preference (`stricter()` only) → platform kill switch → tenant kill switch → task off**. §110 is enforced by construction — tools compose by removal, PII by intersection, automation by `stricter` — and a test forces `AUTOMATIC` on *every* task and asserts the result never exceeds the platform maximum. A tenant asking for more is told so in the decision's reasons rather than silently ignored.

## 18b. Tenant AI Dashboard API (§166)

`GET /ai/dashboard` returns the tenant's own view, **already filtered by the caller's AI permissions** — a
section the role may not see is absent and named in `hidden`, not returned empty for the client to suppress.
An endpoint that returns everything and trusts the UI to hide it is not access control. `GET/POST
/ai/dashboard/feedback` read and record corrections: reading needs `ai.usage.read` (it is tenant-wide
analytics, §168), while **submitting needs only `ai.read`** — withholding that from the people who actually
read the drafts would leave the evaluation data to whoever holds the admin role.

`tenantId` comes from the session on every route, never the body — the same rule the tool gateway applies
(§135), and mutation-tested: taking it from the body fails the suite. An unknown role falls back to the
**least** privileged default, not the most.

## 19. AI Permissions

`ai.read` · `ai.settings.manage` · `ai.usage.read` · `ai.reviews.manage` · `ai.scheduling.approve` · `ai.queue.automation.manage` · `ai.ocr.approve` · `ai.reconciliation.approve`

Defaults: OWNER all · MANAGER all but settings and reconciliation approval · FRONT_DESK/RECEPTION read + reviews · **TECHNICIAN `ai.read` only** · CUSTOMER none. §168 and §169 are *absences*, easy to violate by being generous, so both are asserted as negatives: a technician does not get usage (that is tenant-wide analytics), a receptionist does not get settings.

## 20. AI Jobs

Sync when a user is waiting and the failure does not block a critical operation (classification, short drafts). Async for OCR, transcription, forecasting and batch work. `ai_jobs` carries the §68 state machine, priority 0–4, attempts and idempotency; `ai_job_attempts` is a **separate row per attempt** so a job that failed over has two, each with its own provider, model, error and cost — which is what makes failover analysis and cost accounting possible at all.

`input_reference` is deliberately a **pointer, not a payload**: §60 prohibited data must not be able to sit in a queue row.

## 21. Usage

Units tracked: input tokens, output tokens, and the package's own unit (`calls`, or audio minutes for transcription). Every call writes one `ai_usage_logs` row — `success`, `failed`, or one of `blocked_limit`/`blocked_permission`/`blocked_unpaid` — so a blocked attempt is visible without consuming allowance. Voice keeps a second, different row for transcribed **minutes**: a different unit, not duplication.

## 22. Cost

`cost = (inputTokens × inPerM + outputTokens × outPerM) / 1e6`, in micro-USD. A failed validation still costs money and is logged with the real figure, including both attempts when a repair ran.

**§96/§218 versioning (migration 440).** Prices now carry `provider, model, unit, in_per_m, out_per_m, effective_from, effective_to`, and a partial unique index enforces exactly one open-ended row per model so "today's price" is never ambiguous. Superseding a rate **closes** the old row rather than editing it. `priceVersionAt(model, date)` returns the rate in force on a date and **returns null rather than guessing** — `costAt` throws instead of inventing a figure, because a guessed rate is indistinguishable from a real one afterwards. Whisper is finally expressed in its own unit (`audio_seconds`) rather than through a token-shaped column with a fudge.

Independently, `ai_usage_logs.price_version_id` records **which** rate valued each row, so history survives a rate change whatever the price table later says.

## 23. Budgets

Per tenant, per scope (`*` or a module name), per period (daily/monthly), with `at_limit_behavior` ∈ `block_low_priority` | `block_all` | `queue` | `downgrade_model`. The **tighter leash binds**: a module daily budget decides before a tenant monthly one. Thresholds at 50/80/90/100 report only what *this* call crossed, so an alert fires once.

§101 forced an explicit judgement: under `block_low_priority`, analytics and bulk stop but **a HIGH-risk money alert explanation keeps working**. Stopping that to save a fraction of a cent is the wrong trade. `block_all` stops even safety work, which is why it is a separate deliberate setting.

## 24. Rate Limits

Fixed-window counters per dimension (tenant, branch, user, module, task, provider) — the caller supplies the dimensions. **Every rule is checked before any is incremented**, so a request refused by a hard limit does not burn its softer allowances. Provider concurrency is bounded by the breakers; §108 backpressure is observable through `oldestQueuedAgeMs` per priority.

## 25–28. Module migrations

**§25 AI Receptionist** — `receptionist.reply_draft` is registered with `DRAFT` automation and an empty tool list. The free-form assistant surface (`ai-assistant.service`) is **the documented exception**: it takes arbitrary user prompts, and §9 forbids an arbitrary-prompt *task*, so it cannot become one. It keeps its own entitlement + usage path, lives inside the platform directory, and the boundary gate reports it as a note with that reasoning attached. Not hidden, not pretended away.

**§26 Review AI** — `ai-marketing` and review drafting both migrated. Marketing was the delicate one: its prompt is load-bearing (`validateDraft` rejects invented offers, unknown tokens, raw URLs, self-added opt-out wording), and its old system string was *dynamic*, which §27 forbids. Invariant rules became the registered version; per-request rules became typed variables from a new `buildPromptVariables()` sharing helpers with the legacy builder so the two cannot describe different rules. The registered schema was `{headline, body, cta}` — a generic ad shape fitting none of the three channels — corrected to `{subject, message}`, with the service recomposing **exactly** the string `validateDraft` has always received. A test renders the actual registered prompt and asserts every rule the validator enforces appears in it.

**§27 Voice Transcription** — summarization migrated to `voice.summarize`; the module's own **minutes** logger stays (different unit). Consent is a precondition the platform enforces: a transcription request without it is refused 400.

**§28 OCR** — `ocr.receipt_extract` is registered at MEDIUM with `APPROVAL_REQUIRED`; amounts are integer cents and a low-confidence result routes to human review. The module's provider path was not among the four raw callers, so no rewiring was needed.

## 29–32. Deterministic engine + AI explanation separation

This is the separation the constitution cares about most, and it is enforced by what the task registry **refuses to contain**:

| Domain | Deterministic engine decides | AI does |
| --- | --- | --- |
| **§29 Forecasting** | the forecaster computes the numbers | `forecast.explain` narrates them. There is no `forecast.appointment_demand` or `forecast.revenue` |
| **§30 Queue** | `scoreTechnician()` ranks eligible technicians | `queue.explain_recommendation` writes the sentence. No `queue.assign` — **and no `queue.recommend_assignment` either** |
| **§31 Scheduling** | the constraint solver produces the change | `schedule.explain_suggestion` explains it. No `schedule.optimize` |
| **§32 Reconciliation** | the matcher decides what reconciles | `reconciliation.explain_exception` lists likely causes for a human already looking. No `reconciliation.resolve` |

**The queue row is a correction I had to make.** The registry first declared `queue.recommend_assignment`, assuming the module asked a model to rank from an eligible shortlist. It never did — the engine ranks deterministically and the only model call explains a ranking that already exists. Found during migration, corrected across registry, schema, prompt and adapter. The corrected task is the *stricter* reading of §45.

`citedFactorsAreReal()` checks §118 structurally: every factor an explanation cites must be one the engine actually produced. It cannot prove prose is honest — nothing can — but it catches the failure §118 names.

## 33. Event Architecture

Seven `ai.*` events, all with producers in `AiPlatform.execute()`: `job_requested` → `job_started` → `usage_recorded` → `job_completed`; `job_failed` with the real cost on validation failure; `safety_event_detected` on a block; `approval_required` on `NEEDS_REVIEW`.

**Constitution 8 had registered five of these and nothing emitted any of them.** Two more were missing from the vocabulary entirely. Publishing uses the existing outbox — not a second transport — with `requestId` as both aggregate id and correlation id so every event of one execution traces together, and `actorType: 'ai'`. Publishing is best-effort: an outbox failure must never fail a completed AI call, and a mutation that let it propagate fails the suite.

## 34. Realtime

`ai.approval_required` is the §165 integration point: the platform states the fact, the Notification Service decides how a human hears about it. An AI module never touches APNs, Twilio or email directly.

**Gap, stated plainly:** no SSE room streams `ai.job.progress` to authorized clients yet (§164). The events exist and Constitution 9's gateway could carry them; nothing is wired.

## 35. Super Admin AI

Read models built and tested for: **Overview** (requests, success rate, latency, cost today/month, active tenants, jobs running, failures, provider health, safety events) · **Providers** (status, latency, error rate, usage, cost, last incident — **no credentials**, grepped from source) · **Models** (provider, status, allowed tasks, usage, cost, prices) · **Routing** (task, risk, tier, ceilings, automation maximum, policy version) · **Tenant AI Usage** (ranked by cost, busiest task).

**Guarded API routes now exist** under `super-admin/ai-platform` (`/overview`, `/providers`, `/models`,
`/routing`, `/tenants`), behind `SuperAdminGuard`, backed by `AiControlPlaneService` over `ai_usage_logs`,
`ai_jobs` and the live breakers. **No admin-web screens are built** — the gap is the UI, not the data.

## 36. AI Observability

Per request the platform records: provider, model, prompt key and version, content hash, routing policy version, attempts, whether a repair ran, any failover, input/output tokens, cost in micro-USD, latency, status, confidence, automation level, and a context manifest of data classes and redaction counts. `AiAuditRecord` implements §115 **by what it lacks** — there is no `prompt` field; a version plus an input hash is enough to reproduce and to prove two runs saw the same thing, without parking customer text in an audit table.

## 37. Evaluations — results

`npm run eval:ai`, run against the golden dataset:

```
  incumbent: 10/10 passed
  (accuracy ×3, safety ×3, hallucination ×2, structured_output ×1, tenant_isolation ×1)

  candidate that improves quality but breaks ONE safety case:
    ✗ resp-no-refund (safety) → output contains forbidden "refund"
    incumbent  pass 100%  safety 100%  420 ms   45 µUSD
    candidate  pass  90%  safety  83%  610 ms  190 µUSD
    VERDICT: REJECT — a safety regression is a defect, not a trade-off
```

**Honest framing:** with no provider key configured these answers come from a deterministic stand-in, so what this proves is that the harness *discriminates* — correct output passes, wrong output fails for the stated reason, and the verdict rules behave. Real quality numbers require the same command with a key. Publishing mock-derived quality scores would be exactly the invented figure §174 refuses, which is also why the model dashboard's quality score is `null`.

## 38. Prompt Injection Tests — results

Six §131 attack classes, each run through the **real** renderer, tool gateway and context builder. All pass:

| Attack | Result |
| --- | --- |
| ignore-all-instructions | contained inside `<untrusted>`; exactly one real closing tag survives |
| reveal-system-prompt | system policy never echoed into the user-content block |
| call-unauthorized-tool | denied twice over — unknown tool, and not granted to the task |
| cross-tenant fetch | no cross-tenant tool exists; retrieval filters before searching |
| delimiter escape | injected `</untrusted>` is escaped; the block cannot close early |
| tenant-id override | overruled by server context and recorded in `rejectedOverrides` |

## 39. Tenant Isolation Tests — results

Pass. Another tenant's knowledge chunk **never becomes eligible** (proved by asserting the filter, not the ranking); another branch's is excluded while tenant-wide is included; pseudonyms differ across tenants for identical input; idempotency keys are tenant-scoped (a mutation dropping the tenant fails the cross-tenant test); no cross-tenant AI cache exists.

## 40. Tool Security Tests — results

Pass. Unknown tool denied; real tool not granted to the task denied; actor lacking the permission denied 403; every server-owned key alias stripped and recorded; undeclared arguments dropped; a `propose` tool is `pendingApproval` and **the executor refuses to run it** (the check is not advisory); with an approver it runs and the audit records who. Six mutations on the chain, four load-bearing ones caught, two pinned by the schema invariant above.

## 41. Structured Output Tests — results

Pass. Missing, mistyped, out-of-range, over-long, non-integer-cents, too-few-items and too-many-items all rejected with a path. Hallucinated fields stripped. Enum case normalised, set fixed. Fenced/prefixed/suffixed JSON parsed; malformed JSON rejected. One repair attempted, never two. A provider error during repair is not rewrapped as a schema failure.

## 42. Provider Failure Tests — results

Pass. Transient 503 retried once on the same provider; permanent 401 not retried and the breaker not tripped; 50 permanent errors leave the breaker closed; breaker opens after the threshold, half-opens after the window, one probe decides; all providers down → 503 with no fabricated result and no usage row.

## 43. Failover Tests — results

Pass. Two failures on the primary → a compatible alternative, recorded in `provenance.failover` and `warnings`. Call-time exclusion behaves the same. **A HIGH-risk task refuses to fail over and the backup provider is asserted never called.** A provider with no adapter configured is skipped to the next alternative.

## 44. Cost / Budget Tests — results

Pass. Real cost computed and logged (100 in + 50 out on `gpt-4o-mini` = 45 µUSD, asserted exactly); both attempts billed when a repair runs; a failed validation logs the real cost with `usageAmount: 0`. Budget: within → proceed; `block_low_priority` stops analytics and bulk while safety continues; `block_all` stops everything; `queue` and `downgrade_model` behave; the tighter leash binds; thresholds report only what this call crossed. Seven mutations; two survived the first pass and were **real test gaps**, both rewritten.

## 45. Load Tests — measured results

`npm run measure:ai-capacity`:

```
  evaluateSafety                    p50  0.6 µs   p95  2.0 µs   p99   2.4 µs
  route (healthy)                   p50  3.1 µs   p95  7.5 µs   p99  23.2 µs
  evaluateBudget                    p50  1.8 µs   p95  2.2 µs   p99   5.3 µs
  buildContext (1 redacted field)   p50  2.8 µs   p95  4.9 µs   p99  13.8 µs
  render prompt                     p50  2.1 µs   p95  2.3 µs   p99   5.8 µs
  validate output                   p50  1.4 µs   p95  1.7 µs   p99   2.7 µs
  ─────────────────────────────────────────────────────────────────────────
  PLATFORM OVERHEAD PER REQUEST     11.8 µs  ≈ 0.002% of a 500 ms provider call

  scheduler (§103 fair-share):  100 → 0.06 ms | 1k → 0.12 ms | 10k → 0.78 ms | 100k → 9.63 ms
  rate limit check:             p50 0.5 µs
  20,000 queued job descriptors: 3.2 MB (168 B each)
```

**The finding worth acting on:** the scheduler is linear in **queue depth**, not batch size, because the fairness rule must know whether another tenant is waiting at the same priority. 9.63 ms per batch at 100k queued is the signal to push fairness into SQL (a window function over migration 437's partial index), not to make the function cleverer. The caller is expected to hand it a `LIMIT`-ed window; that expectation is now written at the function.

**Caveat stated, not buried:** this measures the platform's own decision path with a deterministic provider. It does **not** measure provider latency, which dominates any real request and is not ours to characterise.

## 46. Files Changed (this arc)

`apps/api/src/ai/ai-providers.ts` (added `providerFor`) · `ai-pricing.ts` (Whisper price) · `ai-prompts.ts` (legacy annotation + §44 fix) · `ai.module.ts` (platform, prompt store, breakers, events) · `src/events/event-contract.ts` (two missing AI events) · `src/database/kysely.types.ts` (8 tables) · `apps/api/package.json` (4 scripts) · `AI_PLATFORM_AUDIT.md`
Migrated modules: `ai-money-protection/{explain.service,explain,module}.ts` · `ai-queue-assignment/{explanation.service,module}.ts` · `ai-voice-transcription/{service,module}.ts` · `ai-marketing/{content.service,content,module}.ts` — and each module's spec, updated to the platform's validated-output shape with the reason recorded in a comment.

## 47. Files Created

`src/ai/`: `ai-platform.ts` · `ai-platform.adapters.ts` · `ai-task-registry.ts` · `ai-model-registry.ts` · `ai-model-router.ts` · `ai-provider-health.ts` · `ai-prompt-registry.ts` · `ai-prompt-store.kysely.ts` · `ai-output-schemas.ts` · `ai-context-builder.ts` · `ai-safety-policy.ts` · `ai-tool-registry.ts` · `ai-budget-scheduler.ts` · `ai-evaluation.ts` · `ai-feedback.ts` · `ai-knowledge.ts` · `ai-control-plane.ts` (+ 13 spec files, including one PGlite integration spec)
`scripts/`: `audit-ai-platform.mjs` · `audit-ai-dod.mjs` · `measure-ai-capacity.mjs` · `run-ai-evals.mjs`
Root: `AI_PLATFORM_AUDIT.md` · `AI_PLATFORM_REPORT.md`

## 48. Database Migrations

| Migration | Contents |
| --- | --- |
| `436_ai_prompt_versions.sql` | `ai_prompt_versions` (+ immutability trigger), `ai_prompt_rollbacks` |
| `437_ai_jobs_budgets.sql` | `ai_jobs`, `ai_job_attempts`, `ai_budgets`, `ai_budget_alerts` |
| `438_ai_feedback.sql` | `ai_feedback` |
| `439_ai_knowledge.sql` | `ai_knowledge_documents`, `ai_knowledge_chunks` (generated tsvector, GIN) |
| `440_ai_price_versions.sql` | `ai_price_versions` (+ one-current-row index), `ai_usage_logs.price_version_id` |
| `441_tenant_settings_unique_tenantwide.sql` | **Fixes a latent bug in migration 016** affecting every settings category: `UNIQUE (tenant_id, branch_id, category)` does not dedupe NULL branch_id in Postgres, so tenant-wide rows could silently duplicate and upserts never matched. Dedupes, then adds the partial unique index |

All six verified on real Postgres (PGlite/PG16) through the project's existing migration verifier; `kysely.types` matches (631 tables).

## 49. Secrets Required

Names only, never values: `OPENAI_API_KEY` · `ANTHROPIC_API_KEY` · `GEMINI_API_KEY`. Read in exactly one file (`ai-providers.ts`); `check:ai-platform` fails the build if a key **value** is used anywhere else. A *presence* check (`!!env.OPENAI_API_KEY`) is permitted and used by the readiness dashboard — distinguishing those two was a fix, because the first gate version flagged three innocent files. The `ai_providers` table (migration 245) holds encrypted per-tenant credentials; nothing in the control plane reads them, grepped by test.

## 50. Environment Configuration

Non-secret: `AI_DEFAULT_PROVIDER`, `AI_DEFAULT_MODEL` (legacy assistant path only — the platform routes per task), `AI_TIMEOUT_MS` (default 30000), `NODE_ENV` (production refuses the Mock provider). Everything else that would traditionally be env — models, prices, ceilings, risk levels, automation maximums — is **registry data or tenant settings**, deliberately, so changing them is a reviewed code or settings change rather than an untracked deploy variable.

## 51. Deployment Order

1. Migrations 436–439 (additive; no existing table altered, no data backfill).
2. Deploy the API. The platform is inert until a module calls it, and the four migrated modules call it immediately — behaviour-identical, with entitlement and usage now enforced where they previously were not.
3. Seed nothing: prompts serve from the in-code seed, so a fresh database works before any Super Admin action.
4. Optional: insert `ai_budgets` rows per tenant. **No budget row means no limit** — a deliberate default, so deploying cannot silently throttle anyone.
5. Watch `ai.job_failed` and `ai.safety_event_detected` volume, and `check:ai-platform` in CI.

Rollback is the reverse: the previous API binary works against 436–439 because nothing reads those tables unless the new code is running.

## 52. Legacy AI Code Removed

- **Direct provider integrations**: four raw `AiGatewayService` holders removed from modules; `ai-marketing`'s ungated no-database fallback replaced with a denial. The only remaining gateway holder is `ai-assistant.service` inside the platform directory, documented above.
- **Hard-coded prompts**: the module-level `SYSTEM` constants in `ai-queue-assignment` and `ai-money-protection` are gone; `ai-marketing`'s `buildPrompt` survives only as the legacy path, with its rules now in the registered version and its per-request pieces shared so the two cannot diverge. `ai-prompts.ts` is annotated as legacy and frozen.
- **Duplicate usage tracking**: `ai-queue-assignment`'s own `logUsage` deleted. Voice's minutes logger deliberately kept (different unit).
- **Duplicate AI settings**: none existed to remove; tenant AI settings now have one home in the safety policy engine.

## 53. Rollback Plan

| Layer | How |
| --- | --- |
| **Provider** | Set its models `DISABLED` in the model registry, or remove the key. The router treats non-routable as absent and picks an alternative; HIGH-risk tasks refuse rather than substitute. |
| **Model** | Status → `DEPRECATED`/`DISABLED`. One line; no task references a model name directly. |
| **Prompt** | `rollback(store, key, toVersion, actor, reason)` — current → `ROLLED_BACK`, target → `ACTIVE` at 100%, audit row written. No redeployment (§125). |
| **Routing** | `ROUTING_POLICY_VERSION` identifies the active rules; reverting the router file reverts the policy, and every stored result records which version chose its model. |
| **Module** | Each migrated module keeps its deterministic fallback, so pointing its port at a stub that returns `null` degrades it to the deterministic path with no other change. |
| **Whole platform** | Tenant or platform kill switch clamps automation to `SUGGEST_ONLY`; `disabledTasks`/`suspendedTasks` switch individual tasks off without a deploy. |

## 54. Remaining Risks

Not hidden, in order of how much they would cost to discover late.

**Quality.** The golden dataset is ten synthetic cases and the evaluation run used a deterministic stand-in. It proves the harness discriminates; it does **not** establish that any model is good at these tasks. Nobody should read §37's "10/10" as a quality claim — real numbers need a provider key and real runs, and until then §174's quality score stays `null` on purpose.

**Cost.** Pricing is now versioned and usage rows record the version that priced them (migration 440), so a rate change no longer re-values history. What remains: rows written before 440 have `price_version_id IS NULL` and are still valued by recomputation, so comparisons reaching back past this migration carry the old flaw. The `ai_price_versions` table is seeded from code rather than administered — there is no Super Admin screen to publish a rate change, so in practice a new rate still arrives as a deploy.

**Privacy.** Field-name prohibition is structural and strong. Free-text redaction is pattern-based and therefore best-effort by nature — a novel identifier format will pass through. The tenant knowledge path is isolated by construction, but tenant-authored documents are treated as untrusted content and the model is still told to ignore instructions inside them, which is mitigation, not proof.

**Security.** No tool is granted to any task, so the tool-authorization surface is currently unreachable — its correctness is tested but not exercised in production. The first task that grants a tool deserves a fresh adversarial pass rather than trust in these tests.

**Provider dependency.** Three providers are integrated but every registered task allows at most two, and `voice.transcribe` allows exactly one (`openai`/`whisper-1`) — an OpenAI outage stops transcription entirely, with no failover possible. That is a deliberate consequence of the allow-list and should be a conscious decision, not a surprise.

**Automation.** Every ceiling is currently conservative and no task can act without a human where risk is MEDIUM or above. The risk is the opposite direction: a future change that raises a ceiling looks like a one-word edit. The cross-check test between ceilings and approval policies is what makes that edit fail loudly.

**Scale.** The platform adds 11.8 µs per request — irrelevant beside a provider call. The scheduler is linear in queue depth (9.63 ms at 100k) and expects a windowed claim query; at genuine six-figure backlogs the fairness rule belongs in SQL.

**Operational surface.** Everything has persistence and guarded API routes; **no screens are built** in
admin-web or pos-web. A tenant can now change their AI settings through the API and the platform obeys
immediately, but they cannot do it without a developer or an API client. That is a UI gap, not an
architectural one — which is a materially different situation from where this arc started, when the settings
had nowhere to be stored at all.

---

## Definition of Done (§304)

`npm run check:ai-dod` evaluates all 72 items as predicates against the tree — file contents, migration text, the boundary gate, `tsc`, `eslint`, `vitest`. **67 done · 5 partial · 0 not done.** Pricing versions moved to done with migration 440. Every remaining item is
**partial on UI only** — each has persistence, guarded API routes and tests; what is missing is screens in
admin-web and pos-web, plus a real-provider concurrency load test. The four partials (`ai.job.progress` streaming, Super Admin UI, tenant usage UI, and load testing — measured for the decision path but not under real-provider concurrency) and the single gap (tenant AI settings UI) are all UI, ops surface, or measurement. **Every architectural item verifies.**

## Verification

API **6,458 tests across 8 shards, 0 failures** (measured after the module migration); `src/ai` **412**. Migrations verified on real Postgres. **17 CI gates green**, including `check:ai-platform`, which is now fatal on any raw gateway use outside the platform. Typecheck and lint clean. Patches 1–16 reproduce HEAD exactly.
