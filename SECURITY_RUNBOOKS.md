# SECURITY_RUNBOOKS.md — Constitution 12 §195–202, §310–312

**Every control named here exists in the code** — each backticked route, variable and script is checked by
`security-runbooks.vitest.spec.ts`. If a runbook step names something that is not built, CI fails. This is the
security companion to `RUNBOOKS.md` (operations) and `SECURITY_DR.md` (backup and recovery).

## The workflow (§195) and severity (§196)

The Security Center's incident log already has a validated workflow; the constitution's names map onto it:

| §195 state | Incident status in the system | | Severity | SEV |
|---|---|---|---|---|
| DETECTED | `detected` | | critical | **SEV1** — confirmed cross-tenant leak, payment credential compromise, Super Admin compromise, mass takeover, database exfiltration (§197) |
| TRIAGED | `investigating` | | high | **SEV2** |
| CONTAINING | `contained` | | medium | **SEV3** |
| ERADICATING / RECOVERING | `remediating` | | low, informational | **SEV4** |
| MONITORING | `monitoring` | | | |
| CLOSED | `closed` (reason required; `reopened` if it returns) | | | |

Move an incident with `/super-admin/security/incidents/:id/transition`. Invalid moves are refused; closing needs a reason.

## Rules for every incident (§198–199, §312)

- **Preserve evidence before you change anything.** The audit log and security events are append-only by
  design (H3) — nothing you do in response can erase them. For customer data under dispute, place a legal hold at
  `customer-data-oversight/legal-holds`; audit data is protected from any purge by active holds at the database.
- **Notification (§312):** whether, whom and how fast you must notify depends on the law and your contracts —
  **ask counsel.** These runbooks never promise a deadline.
- **Emergency lockdowns** (`/super-admin/security/lockdowns`: propose → confirm → execute → lift) take three scopes:
  *account* and *tenant* revoke every session in scope; *platform* revokes every non-Super-Admin session and refuses
  every non-Super-Admin request until lifted (M13 — before Constitution 12 it was recorded and enforced nowhere).

Each runbook: **Detection · Containment · Evidence · Credential rotation · Recovery · Verification · Notification · Postmortem.**

---

### 1. Account takeover (a salon user's account)
- **Detection:** `LOGIN_FAILED_BURST` / `MFA_*` security events; the owner reports it; logins from an unfamiliar device (sessions now name their device).
- **Containment:** revoke the user's sessions at `/super-admin/security/sessions/revoke` (scope `user`) — or an *account* lockdown.
- **Evidence:** the user's `login_attempts`, their sessions (device, IP, last seen), their audit trail.
- **Credential rotation:** force a password reset; reset MFA.
- **Recovery:** restore anything changed, using the audit trail as the record.
- **Verification:** no active session for that user you did not expect.
- **Notification:** the salon owner; others per counsel.
- **Postmortem:** how were the credentials obtained?

### 2. Super Admin compromise (SEV1, §201)
- **Detection:** unexpected Super Admin activity in the audit feed; `PRIVILEGE_ESCALATION_ATTEMPT`.
- **Containment:** from another Super Admin account, revoke that admin's sessions (scope `user`); if you cannot tell which admin, a *platform* lockdown — Super Admins keep access to investigate.
- **Evidence:** review support sessions, tenant access, exports, and role changes in the audit feed for the whole period.
- **Credential rotation:** the admin's password and MFA; then `AUTH_SESSION_SECRET` if tokens may have been minted (this signs **everyone** out).
- **Recovery:** revert role changes; revoke any privileged-access grant at `/super-admin/security/privileged-access/:id/revoke`.
- **Verification:** the Security Center shows no unexpected privileged grants or sessions.
- **Notification:** per counsel — tenant data may have been viewed.
- **Postmortem:** mandatory.

### 3. Cross-tenant incident (SEV1, §202)
- **Detection:** `CROSS_TENANT_ACCESS_ATTEMPT` events and the cross-tenant signal's incidents; an integrity-check violation; a salon reporting another salon's data.
- **Containment:** disable the affected path — suspend the feature, or lock down the tenant(s) involved. Treat as highest priority.
- **Evidence:** preserve logs and traces; identify every tenant touched; run the integrity checks.
- **Credential rotation:** only if credentials were exposed.
- **Recovery:** fix the path. Add a permanent regression test to `cross-tenant-suite.pgtest.vitest.spec.ts` (§300).
- **Verification:** the cross-tenant suite and the tenant-consistency triggers pass; review event, realtime and cache isolation (`realtime-isolation.vitest.spec.ts`).
- **Notification:** every affected tenant, per counsel.
- **Postmortem:** mandatory.

### 4. API key compromise
- **Detection:** unexpected calls on a key; a key found in public.
- **Containment:** revoke it — tenant API keys at `/pos/api-keys/:id/revoke`, voice integration keys at `/super-admin/voice/keys/:id/revoke`.
- **Evidence:** the key's usage in logs (keys are rate-limited per key since M3).
- **Credential rotation:** issue a new key (`/pos/api-keys/:id/rotate`); update the integration.
- **Recovery / Verification:** the old key is refused; the new one works.
- **Notification:** the salon that owned it. **Postmortem:** where did it leak?

### 5. Payment credential compromise (SEV1)
- **Detection:** processor alerts; unexpected refunds or payouts; `FRAUD_PATTERN_DETECTED`.
- **Containment:** suspend the affected salon (`/super-admin/tenants/:id/suspend`) or lock it down; contact the processor.
- **Evidence:** payments, refunds (who, when), webhook history.
- **Credential rotation:** the salon re-enters processor credentials; rotate `PAYMENT_ENC_KEY` if the key itself is suspect (keep the old value in `PAYMENT_ENC_KEY_PREVIOUS` until everything is re-saved).
- **Recovery / Verification:** a test transaction; the fraud detector quiet.
- **Notification:** the processor and the salon; card-brand rules via the processor; per counsel.
- **Postmortem:** mandatory.

### 6. Twilio compromise
- **Detection:** SMS spend spike; `SMS_ABUSE_DETECTED`; the fraud detector's `sms_wave`.
- **Containment:** rotate the token in Twilio's console first.
- **Evidence:** Twilio's message logs; SMS-abuse security events.
- **Credential rotation:** `TWILIO_AUTH_TOKEN` in Railway; tenant sub-account tokens are re-saved (encrypted under `PROVIDER_VAULT_KEK`).
- **Recovery / Verification:** a test message; spend back to normal.
- **Notification:** per counsel if messages were sent in your name. **Postmortem:** how was it obtained?

### 7. AI provider compromise
- **Containment / rotation:** rotate `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` or `RETELL_API_KEY` at the provider, then in Railway; stored provider keys are encrypted under `AI_PROVIDER_KEK`.
- **Evidence:** the provider's usage dashboard. **Verification:** spend returns to normal. **Postmortem:** where was it exposed?

### 8. Database breach (SEV1)
- **Containment:** rotate the database password in Railway (updates `DATABASE_URL`); consider a *platform* lockdown.
- **Evidence:** Railway's access logs; what the attacker could read. Encrypted columns are unreadable without the seven keys, which are **never** stored in the database.
- **Credential rotation:** rotate every encryption key (each with its `_PREVIOUS`) and `AUTH_SESSION_SECRET`.
- **Recovery / Verification:** `scripts/restore-verify.ts` against a scratch copy confirms every encrypted column opens with the new keys.
- **Notification:** per counsel — likely required. **Postmortem:** mandatory.

### 9. Ransomware / destroyed data
- **Recovery:** restore the latest good backup to a scratch database; run `scripts/restore-verify.ts`; then restore production. See `SECURITY_DR.md`.
- **Credential rotation:** everything the attacker could have seen. **Notification:** per counsel.

### 10. Lost mobile device
- **Detection:** the owner or technician reports it.
- **Containment:** in their profile's session list the device appears **by name** and last-used time (M11) — revoke that one session; a Super Admin can use `/super-admin/security/sessions/:id/revoke`.
- **Verification:** that device's session shows revoked. The token lives in the phone's Keychain/Keystore, never plain storage.

### 11. Backup restore (authorized workflow only, §295)
- Restore into a **scratch** database; run `scripts/restore-verify.ts` (it refuses production's URL); report the drill with `scripts/report-backup.mjs`. Never restore over production to "test".

### 12. DDoS
- **Containment:** Railway's edge absorbs volumetric attacks. For a targeted flood, block the source at `/super-admin/security/ip-blocks` (per-IP limits work correctly since H7).
- **Verification:** `/health/ready` healthy; latency normal.

### 13. SMS abuse / pumping
- **Detection:** `SMS_ABUSE_DETECTED` events; the fraud detector's `sms_wave` incident.
- **Containment:** premium-rate destinations are already refused (M10); for a wave, block the source IPs at `/super-admin/security/ip-blocks`.
- **Evidence:** security events show the masked destinations and IPs. **Verification:** the wave stops. **Postmortem:** tune the thresholds in `fraud-detector.ts`.
