# AI Voice Modules — Deep-Chain Trace (ai_phone, ai_voice_transcription)

Both privacy- and isolation-sensitive; both registered in AppModule (`VoiceBookingModule`,
`VoiceTranscriptionModule`). Provider integrations (Retell/Twilio, transcription) live in **backend** adapters
behind the gateway — no frontend calls a provider.

## ai_phone  → `voice-booking/` (AI Receptionist)

- Controllers: `api/ai-receptionist/v1` (`VoiceAuthGuard` — the endpoint Retell voice functions call),
  `voice` (`VoiceAuthGuard` — voice booking), `tenant/ai/receptionist` (`TenantAuthGuard` — tenant config).
- **Tenant isolation (per the spec's "isolated phone config, credentials, numbers, prompts, call records"):**
  311 tenant-scoping references; repositories query `WHERE tenant_id = ${tenantId}` with a **server-derived**
  tenant id (agents, FAQs, agent-versions, settings all tenant-scoped). Provider credentials are per-tenant.
- **Provider**: `retell-voice.provider.ts` is a **backend** adapter (correct location); the client never calls
  Retell/Twilio. `VoiceAuthGuard` authenticates the inbound voice-function/webhook traffic; migration **301**
  adds gateway idempotency.
- DB: migrations **298** (voice_integration_keys — per-tenant provider creds), **299** (call_outcomes),
  **300** (voice_learning), **301** (gateway_idempotency), **302** (receptionist_agents), **303** (follow_ups),
  **304** (faqs), **305** (settings), **306** (provisioning_jobs).
- Tests: **52 spec files**. **Status: Complete.**

## ai_voice_transcription  → `ai-voice-transcription/`

- Controllers: `pos/ai-voice-transcription` (`TenantAuthGuard` + `RolePermissionGuard`),
  `super-admin/voice-transcription` (`SuperAdminGuard`), `voice-transcription` (`VoiceAuthGuard` — ingest/webhook).
- **Role-based transcript access (per spec):** permissions split summary vs raw —
  `ai_voice_transcription.view` / `.view_transcripts` / **`.view_raw`** / `.delete` / `.manage_rules` /
  `.manage_settings`. `GET transcripts/:id/raw` requires `view_raw`; summaries/intelligence require the lesser
  grants.
- **Retention + privacy controls:** `POST retention-sweep` + a `VoiceRetentionSweepScheduler` (cron);
  `POST consent`; `POST transcripts/:id/legal-hold`; `DELETE transcripts/:id`; redaction in the pipeline.
- **Extraction:** `transcripts/:id/intelligence` (intent/appointment-detail/unresolved extraction),
  `transcripts/:id/summary`, `transcripts/search`.
- DB: migrations **326** (transcription_core), **327** (redaction), **328** (intelligence),
  **329** (deletion). Usage flows through the gateway to `ai_usage_logs`.
- Tests: **18 spec files**. **Status: Complete.**

## Invariants confirmed (both)
- Provider calls are backend-only (Retell/Twilio/transcription adapters); **no direct frontend provider calls**.
- Phone config, credentials, numbers, prompts, and call records are per-tenant and server-scoped.
- Transcripts have role-gated access (summary vs raw), consent, redaction, legal hold, deletion, and a
  scheduled retention sweep.
- Both modules are guarded (`VoiceAuthGuard` for provider/webhook traffic, `TenantAuthGuard`/
  `RolePermissionGuard`/`SuperAdminGuard` for user-facing surfaces).
