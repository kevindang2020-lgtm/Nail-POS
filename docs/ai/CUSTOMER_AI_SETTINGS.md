# Customer AI Settings (POS) — Nov 2 2026

Guide: *Customer AI Settings* (Kevin, Nov 1 2026). Route: `/tenant/ai/customer-profile/settings` (unchanged).

## Audit findings (before the build)

| Area | Status | Finding |
|---|---|---|
| Screen | Partial | Read-only table of the five thresholds and a Disable / Enable button. No provenance, history, confirmation or health check. The photographed 3 / 3 / 3 / 90 / 180 are the code defaults (`DEFAULT_TUNABLES`), shown only because nothing was stored. |
| Resolver | Verified | `resolveSettings`: code defaults → tenant → branch → user; any `enabled: false` disables; invalid values are dropped. Every customer-AI screen reads it. |
| Settings read | **Broken (fail-open)** | `KyselyProfileSettings.layers` did `.catch(() => [])`: a database error read as "no overrides", so the assistant ran **enabled past the salon's own Disable**. |
| Enable / Disable | **Broken** | `PUT /pos/ai-customer-profile/settings/tenant` deleted and re-inserted the whole row with only the field sent, so **toggling the assistant wiped the salon's thresholds**. No version check (last write wins), audit was fire-and-forget, no history. |
| Super Admin | Partial | Super Admin has the package's global on/off (the AI entitlement gate's `package_disabled`) and a read-only overview. It has **no per-salon threshold overrides or per-salon emergency switch** — the screen's note claiming that was not true. |
| Subscription | Partial | The assistant's routes are gated by `@RequiresAiPackage('ai_customer_profile_assistant')` (observe mode by default). The guide-4–7 screens were missing that gate — fixed in guide 7. The settings screen did not show the subscription at all. |
| Propagation | Missing | No way to tell whether Customer Intelligence / Churn Watch / Rebooking / Service Recommendations used the current values. |

## What was built

- **Fail-closed settings read** (FC-01) and a **merging** settings port (FC-02): a switch-only write keeps the thresholds, and vice versa.
- **`/pos/customer-ai-settings/*`** (the old `GET settings` and `PUT settings/:level` routes and client methods are retired and pinned):
  - `GET state` — each threshold's effective value, unit, code default, **which level set it** (Default / This salon / This branch / Your user), invalid stored values flagged; the salon switch, branch / user switches, the **package + subscription decision from the AI entitlement gate's own rules** and its enforcement mode, what is effective, and **propagation** (did the last Customer Intelligence and Service Recommendations evaluations use these values — Applied / Pending / Never).
  - `POST assistant` (Disable / Enable for this salon) and `POST thresholds` (change or **Reset to defaults**) — existing manage permission; salon level only; validated ranges (visits 1–20, cadence 2–20, inactive 14–730 days, long-term 30–1095 days) and order (long-term after inactive, checked on the result); **version-checked** (`CAS_STALE_VERSION`); one transaction writes the row, an **append-only history** event and a **fail-closed audit**; then the assistant's cache is invalidated. "Enable" stores *inherit*, so a salon never overrides a platform or package decision. Nothing re-evaluates customers synchronously; nothing books, texts or bills.
  - `POST preview` — read-only estimate of how many authorized customers a proposed value moves across a line (labelled an estimate).
  - `GET history` (+ `/:id`) — search (setting, person, role, reason, change ID), type, presets and From/To month calendar, pages of 10/25/50/100, newest first; the detail shows before / after, actor and role, version, reason, and whether each evaluation picked the change up.
  - `POST check` — Check Customer AI System, read-only, one run per salon per 30 s: settings readable · stored values valid · threshold order · values in range · assistant switched on · branch / personal overrides · package & subscription · Intelligence applied · Recommendations applied · recent evaluation failures · completed-visit history · every change in History · tenant isolation · no side effects.
- **POS screen** rebuilt in place: title, description, Assistant + Disable / Enable, the five exact labels — always visible together. Added the status strip, source / default / allowed columns, last change, a confirmation dialog (salon, change, role, reason), the edit dialog with preview and Reset, History and System Health tabs. EN/VI.
- The screen is **not** behind the AI subscription gate on purpose: an unpaid salon must still see *why* the assistant is blocked.

## Database (migration 767, additive)

`ai_customer_profile_settings.version`; `ai_customer_profile_settings_events` (append-only trigger); `customer_ai_settings_health_runs`. Rollback: drop the two tables and the column.

## Proof

- **pgtest 12/12** (`customer-ai-settings-center.pgtest.vitest.spec.ts`): defaults with source; subscription kept apart from the switch (observe vs enforce); ranges, order, unknown key, missing / stale version, no-op; another salon untouched; cache invalidated; audit; Disable keeps thresholds; Enable = inherit; branch override shown and still winning, invalid branch value flagged; propagation Applied → Pending → Applied with the real Intelligence scan; Reset; preview exact counts and no writes; history order / search / type / append-only / other salon; fail-closed read; merging port; health check read-only and finding an outside change.
- **Deliberate breaks caught:** restoring the `.catch(() => [])` and the replace-not-merge write (2 tests); removing the version check (6 tests).
- **AI module suites:** 216 passed (incl. the request-schema spec rewritten to the new routes and the retired-route pins). **POS:** screen 6/6.

## For Kevin

- **Decision:** should Super Admin get per-salon threshold overrides and a per-salon emergency switch (the old screen note promised them)? Today Super Admin can only switch the package off for every salon.
- The AI entitlement gate is still in **observe** mode platform-wide (`AI_ENTITLEMENT_ENFORCEMENT`); the screen shows "Not enforced yet" honestly.
