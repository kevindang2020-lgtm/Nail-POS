# AI Receptionist — admin management API (2026-07-03)

Built the super-admin-authenticated API a config/history UI needs. Every endpoint delegates to a REAL store built
earlier (voice keys / call outcomes / learning), so any UI on top shows only real data — no fabricated status.

## Endpoints (all behind `SuperAdminGuard`, tenant selected by the admin)
Integration keys:
- `GET  /super-admin/voice/keys?tenantId=` — list keys (secret hash never returned; prefix + status only).
- `POST /super-admin/voice/keys` — issue a key; returns the RAW key exactly once (UI must prompt "copy now").
- `PATCH /super-admin/voice/keys/:id/revoke?tenantId=` — revoke (tenant-scoped).

Call history (real outcome store):
- `GET /super-admin/voice/calls?tenantId=&branchId=&limit=` — recent call outcomes.
- `GET /super-admin/voice/calls/:callId?tenantId=` — one call's outcome.

Learning (human approval gate — approve and activate are SEPARATE endpoints, mirroring the safety model):
- `GET  /super-admin/voice/suggestions?tenantId=&status=`
- `POST /super-admin/voice/suggestions/:id/approve` (drafts a prompt version — never activates)
- `POST /super-admin/voice/suggestions/:id/reject`
- `POST /super-admin/voice/prompts/:id/submit` (draft → pending_review)
- `POST /super-admin/voice/prompts/:id/activate` (explicit human activation)
- `POST /super-admin/voice/prompts/rollback`
- `GET  /super-admin/voice/prompts/active?tenantId=&scope=`

## Security
- Behind the normal admin guard (NOT the integration-key guard, which is for the provider).
- The key secret hash is redacted server-side and never sent to the UI; the raw key is shown once at issuance.
- All actions are tenant-scoped (the admin picks the tenant); the acting admin's userId is captured for approvals.

## Verification (fresh runs)
- Unit tests **7/7**: keys listed without the secret hash; raw key returned once; required-param enforcement; revoke
  scoping; call-list delegation; approve yields a draft (not active); activate is a distinct endpoint.
- typecheck 0; lint 0; **full api suite 2675/2675 across 423 files**; build clean.

## Files created / changed
- NEW `apps/api/src/super-admin-voice/super-admin-voice.controller.ts` (+ `.vitest.spec.ts`),
  `super-admin-voice.module.ts`
- CHANGED `app.module.ts` (register `SuperAdminVoiceModule`)

## Receptionist status
Backend is now complete AND admin-operable via API: audit → read gateway (callable) → key auth → provider port + Retell
adapter → pilot-safe write path (dark) → call-outcome store → human-approved learning loop → **admin management API**.

## Remaining work (honest)
- **Frontend page(s)** in admin-web: issue/revoke keys, browse call history, review+approve suggestions, activate/roll
  back prompt versions. The API is ready to consume; this is the main remaining build and is pure frontend.
- **Provider config store + UI** (agent name/voice/greeting/phone number) — most of it only meaningful once a Retell
  account exists; deferred honestly rather than mocked.
- Decision-gated: reschedule/cancel policy + caller verification, consent-gated customer creation, recording retention.
- Account-gated: Retell + Twilio + LLM keys, then `VOICE_WRITE_TOOLS_ENABLED=true`.

## Rollback
Additive: new controller/module. Remove the app.module registration + delete the folder. No schema change, no effect on
existing routes.
