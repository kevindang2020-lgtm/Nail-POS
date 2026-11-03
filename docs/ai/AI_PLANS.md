# AI Plans & Packages (POS) — Nov 2 2026

Guide: *AI Plans & Packages* (Kevin, Nov 1 2026). Route: `/tenant/ai/plans` (unchanged). The five plan cards and their 15
assistants are unchanged (catalog: `modules/ai/src/ai/ai-plans.ts` + `ai-catalog.ts`).

## Audit findings (before the build)

| Area | Status | Finding |
|---|---|---|
| Plan state | **Broken** | A plan whose trial had ended still showed "On trial" (the stored row stays `trialing`), and its members counted as live — the same contradiction the add-on pages had. |
| Re-trial loophole | **Broken** | The package path allows one free trial per package, but the plan path re-trialled cancelled packages and re-opened a cancelled plan's trial: cancel → start plan trial → another free period, indefinitely. |
| Cancel | **Broken** | Per-package cancel errors were swallowed and Cancel answered "ok" even when nothing was cancelled. |
| Reads | **Broken** | The subscription / usage reads behind the plans and add-on catalogs turned a database error into "not subscribed" and "0 used". |
| Confirmation | Missing | Start trial / Cancel fired on one tap. |
| "Bundle and save" | Partial | Every plan price equals its assistants' total (no discount configured); the card said nothing about it. Super Admin can already set a plan price override / discount (`ai_plan_settings`, admin AI Plans). |
| Super Admin per-assistant prices | Missing | Assistant prices live in the code catalog; there is no editor. |
| Self-serve paid purchase | **Blocked** | No online recurring-billing integration exists for AI packages; paid activation is Billing / Super Admin. Nothing pretends a charge happened. |
| Billing history / health check | Missing | Not built in this pass. |

## What was built

- **Honest plan state** (`listPlans`): `trial_available · trialing · trial_expired · active · past_due · cancelled · available`, the trial
  end date, `canCancel`. A member package counts as live only if active, or trialing with its trial not yet ended.
- **One free trial per plan and per assistant**: a plan with any prior row (cancelled / expired) is refused `trial_already_used`; a member
  package that ever had a row is never re-trialled; a plan whose every member already used its trial offers no trial.
- **Cancel** reports a real result: errors propagate, and "nothing live to cancel" is `subscription_not_found`.
- **Reads fail loudly** (`KyselyTenantAiRepo`): no more "not subscribed" / "0 used" on a database error.
- **POS screen**: state chip in the shared AI-usage vocabulary, trial end / ended dates with the next step, a plain "no bundle discount"
  note, confirmation before Start trial / Cancel, a clear "trial already used" message, and an **Individual assistants** link to the
  AI Usage & Limits page (all 15 assistants with their own honest state, trial and cancel). EN/VI (`plx.*`).

## Tests

- `ai-plans.pgtest.vitest.spec.ts` 5/5 (trial → lapsed → cancel → refused re-trial; members not re-trialled; cancel with nothing live).
  Sabotage (removing the re-trial guards) was caught. tenant-ai suite 33/33.
- `POSAIPlansScreen.test.tsx` 3/3.

## Decisions for Kevin

- Super Admin per-assistant price editor (today: prices in code; plan-level override/discount exists) — build it?
- Self-serve paid purchase needs a billing provider integration for AI packages (Stripe/Fiserv recurring). Which provider?
