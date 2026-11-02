# AI Receptionist — Phase 2: voice integration-key store + guard (2026-07-03)

Built the auth foundation for the voice gateway: a hashed, tenant+branch-scoped integration-key store and a guard that
resolves the call's tenant/branch FROM THE KEY — never from the caller or the voice provider. This is the security
gate the whole gateway sits behind. Mirrors the existing `tenant_api_keys` (api-webhooks) model; no external account
needed.

## The security contract (why this matters)
The AI voice agent must never be able to choose which tenant it acts on. So tenant + branch are bound to the integration
key at issuance and read back from the stored row on every request. The presented key is only ever compared by hash;
the raw key is shown once at creation and never stored. Unknown / expired / revoked keys fail closed (401).

## What was built
### 1. Migration `298_voice_integration_keys.sql`
Mirrors `tenant_api_keys` (134): `id`, `tenant_id`, **`branch_id`** (voice resolves both), `label`, `provider`,
`prefix` (display only, e.g. `vk_live_Ab12`), `secret_hash` (sha-256; raw never stored), `last_used_at`, `expires_at`,
`revoked_at`. Indexes: hash lookup + tenant, both partial on non-revoked; a unique index prevents a duplicate active
hash. **Applied cleanly on real Postgres 16** (table + 4 indexes).

### 2. `voice-key-core.ts` — pure, testable
`composeVoiceKey` (`vk_<env>_<token>` + short prefix), `hashVoiceKey` (sha-256), `voiceKeyStatus` (revoked > expired >
active), `isUsableVoiceKey`. No I/O — mirrors api-webhooks-core.

### 3. `voice-key.service.ts` + `voice-key.kysely.repository.ts` + in-memory repo
- `issue(...)` → generates a random token, stores hash+prefix, returns the RAW key exactly once.
- `resolveContext(presentedRaw)` → the hot path: hash the presented key, look up the active row, return
  `{ tenantId, branchId, keyId, provider }` from the STORED row, or null. Best-effort `last_used` touch.
- `revoke(tenantId, id)` (tenant-scoped — can't revoke another tenant's key), `list(tenantId)`.
- Kysely repo backs prod (verified end-to-end on real Postgres); in-memory repo backs dev/tests.

### 4. `voice-auth.guard.ts` — the enforcement point
Reads the key from `X-Voice-Key` or `Authorization: Bearer`, resolves the VoiceContext, attaches `req.voiceCtx`
(tenant+branch), rejects with 401 if invalid. Downstream tools read tenant/branch ONLY from `req.voiceCtx` — never from
the request body.

## Verification (fresh runs)
- **Real Postgres end-to-end:** issue → resolve returns the correct tenant+branch → unknown key → null → revoked key →
  null. Migration applies cleanly.
- **Unit tests:** `voice-key.vitest.spec.ts` **9/9** — prefix/hash one-way (raw not recoverable/stored); status
  derivation; resolve returns stored tenant+branch; unknown/revoked/expired → null; cross-tenant revoke is a no-op.
- Typecheck 0; lint 0; voice-booking suite **30 tests / 4 files**; full api suite **2632/2632 across 418 files**; build
  clean.

## Files created
- `apps/api/db/migrations/298_voice_integration_keys.sql`
- `apps/api/src/voice-booking/voice-key-core.ts`
- `apps/api/src/voice-booking/voice-key.service.ts`
- `apps/api/src/voice-booking/voice-key.kysely.repository.ts`
- `apps/api/src/voice-booking/voice-auth.guard.ts`
- `apps/api/src/voice-booking/voice-key.vitest.spec.ts`

## Where this leaves the receptionist build
- ✅ Phase 0 (audit/map), Phase 1a (read gateway), Phase 3 (provider port + Retell adapter + tools), **Phase 2 (key
  auth)** — all built, no external account used.
- Next buildable-now: wire a `VoiceBookingModule` (controller with `@UseGuards(VoiceAuthGuard)` exposing the read tools
  + the Retell webhook endpoint using raw-body signature verify), and a tiny admin surface to issue/revoke keys.
- Needs your go-ahead (touches real appointments): **Phase 1b write path** (enable create/reschedule/cancel/handoff
  tools) — will stay behind this guard + confirm-before-write.
- Needs your accounts: Retell account + webhook-badged API key, Twilio number, LLM key.

## Rollback
Additive: new table + new module files, not yet wired into app routing. Drop the folder + skip migration 298 to revert;
the migration is idempotent (`IF NOT EXISTS`).
