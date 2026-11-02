# AI Receptionist — Gap Analysis (Phase 0)

| Area | Exists? | Gap / net-new work | External account needed? |
|---|---|---|---|
| Availability / book / reschedule / cancel | ✅ CustomerBookingService | thin `/voice/booking/*` adapters | No |
| Customer lookup/create + phone normalize | ✅ CustomersService | adapter + lookup-or-create endpoint | No |
| Services / technicians / hours read tools | ✅ services/technicians/branch | safe public-projection adapters | No |
| Integration-key auth (hashed, tenant-scoped) | ✅ api-webhooks model | new `voice_integration_keys` table + guard mirroring it | No |
| Notifications / audit / handoff | ✅ | wire adapters to reuse them | No |
| **Voice provider layer** (Twilio/Retell/Vapi…) | ❌ | `VoiceProviderPort` + one impl; agent/number/webhook | **YES — provider account + credentials + phone number** |
| **Call-session state machine + outcome store** | ❌ | new tables + state machine | No (storage); provider for live calls |
| **Learning pipeline (human-approved)** | ❌ | call summary → eval → suggestion → approval → versioned prompt | Possibly an LLM key for eval |
| **Knowledge base + pronunciation** | ⚠️ data exists in POS | versioned KB referencing canonical sources | No |
| **Config UI + call-history UI + analytics** | ❌ | admin-web/pos-web surfaces | No |
| **Privacy / consent / retention** | ⚠️ retention svc exists | consent config + recording policy — **legal review required** | No (but legal signoff) |

## Hard external dependencies (where I must stop for your input)
1. **Voice provider choice + account** — Twilio / Retell / Vapi / ElevenLabs. Each has different agent/number/webhook
   APIs. I can build the provider-agnostic port + a stub now, but a live implementation needs your chosen provider's
   credentials and a purchased phone number.
2. **Telephony number + live calls** — requires the provider account.
3. **Recording-consent legal review** — jurisdiction-specific; the spec itself says legal review is required before
   deployment.
4. **LLM key for the agent + evaluator** — if the eval loop runs an LLM.

Everything NOT dependent on the above (the gateway, key auth, read tools, outcome storage, state machine, docs) is
buildable now.
