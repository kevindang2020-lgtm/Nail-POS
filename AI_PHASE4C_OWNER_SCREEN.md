# AI Phase 4c (frontend) — owner-web "AI Packages" screen

The tenant-owner UI on top of the 4c API. An owner opens it from More → AI Packages and sees the 15 assistants with their
salon's subscription, usage meter, and live lock state; they can start a free trial or cancel. Completes Phase 4c.

## Files
- `apps/owner-web/src/api/ownerApi.ts` — `ownerAiApi` (packages / startTrial / cancel) + `OwnerAiPackage` type
- `apps/owner-web/src/screens/AiPackagesScreen.tsx` — the screen
- `apps/owner-web/src/screens/AiPackagesScreen.test.tsx` — 2 tests
- `apps/owner-web/src/shell/nav.tsx` — `aiPackages` pushed kind + `openAiPackages`
- `apps/owner-web/src/App.tsx` — renders the pushed screen
- `apps/owner-web/src/screens/MoreScreen.tsx` — "AI Packages" menu row

## The screen (mobile)
Per-package card: name + description, a status pill (**Active** / **Trial** when accessible, else the **lock label** from
the gate), price + included usage + trial length, and — when subscribed — a usage meter (`used / limit`, “N left”, a bar
that turns red at 100%). Actions:
- **Start Free Trial** when a trial is available (no subscription + trial days) → `POST /tenant/ai/subscriptions`.
- **Cancel** for an active/trialing subscription → `PATCH …/:code/cancel`.
- Packages with no trial and no subscription show “Subscribe via billing” (honest: paid activation is Phase 4d, never
  self-granted in the UI).
After any change the list reloads so status/usage update. 403s render an access message; errors offer Retry. Uses the
owner app's header/back shell and `--owner-*` design tokens, consistent with the other owner screens.

The lock labels shown here are exactly the gate's reasons (`not_subscribed`, `trial_expired`, `past_due`,
`limit_exceeded`, …) — the same decision the backend enforces on `POST /ai/:packageCode`. One source of truth, UI to gate.

## Verification
owner-web: `tsc` clean; **23 tests** (+2: lists packages with lock state + start-trial CTA + usage line; start-trial
posts the right code); `vite build` clean. Backend unchanged this turn (still 529, `RESULT: PASS`).

## Remaining
- **4d** — billing/webhook sync so a payment status change flips `tenant_ai_subscriptions.status` (and thus access), and
  paid (non-trial) activation from the owner UI.
- **Phase 3** — real OpenAI/Anthropic/Gemini adapters + per-assistant prompt templates behind the existing `AiProvider`
  port (needs provider keys; runs on the Mock until then).
- **Phase 5** — POS entry points per assistant (pos-web) rendering the gate's locked/upgrade panel at each POS area.
