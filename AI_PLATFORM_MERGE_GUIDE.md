# AI_PLATFORM_MERGE_GUIDE.md
### Landing Constitution 10 (patch 16) on `Power-Salon-main` — September 20, 2026

This arc was built on the July snapshot `f420cfe`, the same base as Constitutions 8 and 9. **`Power-Salon-main`
has moved since.** Constitution 9 (patch 15) is also not landed there yet, and patch 16 depends on parts of it.

---

## 0. Order

Patch 16 touches files patch 15 also touches (`ai-queue-assignment.adapters.ts`, `kysely.types.ts`,
`package.json`). **Land 15 first, then 16.** Patches 1–16 applied in order to `f420cfe` reproduce this tree
exactly — that is verified after every commit in this arc, so a clean `git apply` in sequence is the expected
outcome, and a conflict means the target tree has diverged in that file specifically.

## 1. Run the checker in the target tree FIRST

```
cd Power-Salon-main
node <this-arc>/apps/api/scripts/audit-ai-infra-duplicates.mjs --root=$(pwd)
```

Every ⚠ is a decision, and **"keep both" is never one of them.** Against this tree it reports exactly two ⚠ —
`ai_usage_logs` and `tenant_settings` — both pre-existing tables this arc extends rather than replaces. Anything
beyond those two in `Power-Salon-main` is a genuine collision.

## 2. Decision table

| Concept | If `Power-Salon-main` already has one | If it does not |
| --- | --- | --- |
| **`AiPlatform` / a second AI entry point** | **Stop.** Two entry points is the precise defect this arc exists to remove. Keep one and migrate its callers; `check:ai-platform` will tell you when none are left. | Land as-is |
| **Task registry** | Merge rows into ONE registry. A task key that resolves in one and 400s in the other is the worst failure mode here. | Land |
| **Model registry / router** | Keep one router; two means two `routingPolicyVersion` values and no way to say which chose a model. | Land |
| **Prompt storage** | **Theirs wins if it is already a table.** Keep their table, land migration 436's *immutability trigger* onto it, and seed from their rows rather than `PROMPT_SEED`. | Land 436 + the seed |
| **Output schemas** | Merge. A task must have exactly one output contract. | Land |
| **Safety / automation levels** | The ORDER of `AUTOMATION_LEVELS` **is** the comparison — two orderings silently invert `stricter()` and a tenant "tightening" would loosen. Keep one array. | Land |
| **Tool registry** | Merge carefully: a tool granted in one registry and absent from the other is an authorization hole. Re-run the §135 invariant (no tool schema declares a server-owned key) after merging. | Land |
| **Pricing** | **Theirs wins if they already version pricing.** Drop this arc's `PRICE_VERSIONS` seed and keep `costAt()`/`priceVersionAt()` pointed at their rows. | Land 440 |
| **`ai_usage_logs`** | Pre-existing (091). This arc adds **one column** (`price_version_id`). If they added their own, reconcile the name, do not add a second. | — |
| **`tenant_settings`** | Pre-existing (016). This arc adds a **category** and a **partial unique index** (441). If they have already fixed the NULL-branch duplicate bug, skip 441; if not, land it — it fixes every settings category, not just AI. | — |
| **Circuit breakers** | One set, or a provider is open on one path and closed on another. | Land |
| **Entitlement (`evaluateAiAccess`)** | **Theirs wins.** The platform calls whatever their access gate is; do not introduce a second. | Land |
| **Events** | `event-contract.ts` must end with **seven** `ai.*` types. If they added their own `ai.job_started`, keep theirs and delete this arc's. | Land the two additions |

## 3. Migrations

436 → 441, all additive, no existing table altered destructively, no backfill.

| | Note when landing |
| --- | --- |
| `436_ai_prompt_versions` | If their prompt table exists, land only the trigger + `ai_prompt_rollbacks`. |
| `437_ai_jobs_budgets` | Renumber if 437 is taken. No dependency on 436. |
| `438_ai_feedback` | Independent. |
| `439_ai_knowledge` | Independent. Uses `to_tsvector`, no extension required. |
| `440_ai_price_versions` | Adds `ai_usage_logs.price_version_id` (TEXT, nullable). Pre-existing rows stay NULL and are still valued by recomputation — a known and documented limitation. |
| `441_tenant_settings_unique_tenantwide` | **Deletes duplicate tenant-wide settings rows** before adding the index. Check the target tree for duplicates first: `select tenant_id, category, count(*) from tenant_settings where branch_id is null group by 1,2 having count(*) > 1;` — the migration keeps the most recently updated and drops the rest. If that is not the desired resolution there, resolve manually first. |

Renumber any that collide. None of them reference each other by number.

## 4. After merging — the checks that matter

```
npm run check:ai-platform     # fatal on a raw gateway outside src/ai/, or provider HTTP outside the adapter
npm run check:ai-dod          # the §304 Definition of Done, evaluated against the tree
npm run check:di              # every injected token resolves (AiPlatform, AiSettingsStore, AiUsageReadPort)
npm run check:types-drift     # kysely.types vs migrations
npm run eval:ai               # the golden dataset and the regression verdict
npm run measure:ai-capacity   # decision-path cost
```

`check:ai-platform` is the one that will complain loudest if the merge went wrong: it is fatal on any module
outside `src/ai/` holding an `AiGatewayService`, which is exactly what a half-finished merge leaves behind.

## 5. What this arc deliberately did NOT build

So nobody "completes" it by accident:

- **No `ai.run_arbitrary_prompt` task** (§9/§27). An open prompt endpoint is how injection becomes a system
  instruction. The free-form assistant surface keeps its own path, documented.
- **No LLM-as-forecaster, scheduler, eligibility engine or reconciler** (§42–§46). The tasks are
  `forecast.explain`, `schedule.explain_suggestion`, `queue.explain_recommendation`,
  `reconciliation.explain_exception` — all explanation of deterministic output.
- **No CRITICAL task.** Payment capture, refunds, permission changes, suspension are not AI tasks.
- **No tool with effect `write`**, and **every task declares `allowedTools: []`.** The first task to grant a
  tool deserves a fresh adversarial pass, not trust in the existing tests.
- **No vector database** (§145). Postgres full-text is the correct tool for a handful of salon policy
  documents; the schema is shaped so embeddings are a migration, not a rewrite.

## 6. Known gaps arriving with this patch

From `check:ai-dod` (67 done / 5 partial / 0 not done), all five partials are UI or measurement:

- No admin-web screens for the Super Admin AI pages (API routes exist, guarded and tested).
- No pos-web screens for the tenant AI dashboard or settings (same).
- No SSE room streams `ai.job.progress` to clients (§164); the lifecycle events publish.
- Load testing covers the decision path (11.8 µs/request) but not real-provider concurrency.
- `ai_price_versions` is seeded from code — a rate change still arrives as a deploy.

The §54 risk list in `AI_PLATFORM_REPORT.md` is the fuller version and is worth reading before the first
tenant is switched on.
