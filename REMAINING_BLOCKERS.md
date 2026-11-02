# Payment Gateways — Remaining Blockers (honest)

> **STATUS (Jul 29, 2026): historical snapshot — do not work from this file.** The platform has moved far past it; the verified current state lives in `PROJECT_STATUS.md`, the dated build narratives in `CHANGELOG_HANDOFF.md`, and the conventions in `NEW_CLAUDE_INSTRUCTIONS.md`. Remaining work is owner-side only (credentials, hosting, devices, two Kevin decisions) — authoritative list in `PROJECT_STATUS.md`.
> Since this was written, **Stripe and Square were permanently REMOVED** from the platform (Fiserv/CardPointe/Bolt/Clover only), so the "Stripe & Square are implemented to spec" line no longer applies. The CardPointe signature confirm remains creds-gated (owner-side), like all processor-sandbox items.


> **Closed:** ~~Chargebacks have no source table.~~ (096 — `CHARGEBACKS_BUILD_REPORT.md`)
> · ~~City/State shows only the first branch.~~ (branch footprint — `BRANCH_FOOTPRINT_BUILD_REPORT.md`)
> · ~~Dedicated pause/resume/disable endpoints are not built.~~ (097 + audited lifecycle — `GATEWAY_LIFECYCLE_BUILD_REPORT.md`)
> · ~~Detail-panel "Underwriting Approved" is a proxy.~~ (098 + real onboarding status — `UNDERWRITING_STATUS_BUILD_REPORT.md`)
> · ~~"Today's Volume" is not in the per-row data.~~ (intraday approved-payment rollup — `TODAY_VOLUME_BUILD_REPORT.md`)
> · ~~Live webhook signature verification.~~ (raw-body capture confirmed + processor-aware schemes w/ replay window — `WEBHOOK_SIGNATURE_BUILD_REPORT.md`)

1. **Per-branch gateway overrides** don't exist (the gateway is tenant-scoped). Not a gap for the current design; would be a
   separate feature if branches ever need distinct merchant accounts.
2. **Design KPI magnitudes are seed/dev.** Real pilot numbers will be far smaller; expected, not a defect.

### Confirm-against-sandbox (not code gaps — external inputs)
- **Fiserv/CardPointe exact signature header + signing string.** Stripe & Square are implemented to spec; CardPointe uses the
  generic HMAC-SHA256 hex default until confirmed against their sandbox (a one-branch swap in `verifyProcessorSignature`).

### Small, optional follow-ups surfaced during the builds (not blockers)
- Per-tenant **timezone** day boundary for "Processed Today" (currently server-local; fine for one market).
- A platform-wide **"Today's Processed Volume" KPI card** (the per-tenant figures it would sum are now in the payload).
