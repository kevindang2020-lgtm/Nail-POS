# K12_RUNBOOK.md — the 8 PRODUCTION-READY POS 5 rows, step by step (Nov 13 2026)

These are the rows of `docs/handoff/EXTRAS_BACKLOG.md` → "PRODUCTION-READY POS 5" that no code change can finish: they are
actions in your accounts, on your machine and on real devices. Do them **in this order** — step 8 (pushing the rewritten
history) must come last, because until the old credentials are dead, history that still contains them is dangerous.

Never paste a password, key or connection string into a chat, a ticket or this repository. Use your password manager and
the hosting provider's variables screen only. `node tooling/k12/verify-k12.mjs` checks steps 5–8 and never prints a secret.

Rows 02 and 03 (the backend items in the same PDF) are already done in code; see "Rows 02–04" at the end.

---

## Step 1 — Rebuild the machine
The old machine held the exposed credentials. Treat it as compromised.
1. Back up only your documents. Do not copy the old `.env` files, SSH keys, keystores or browser profiles.
2. Wipe the disk and reinstall the operating system. Install updates, turn on full-disk encryption (FileVault / BitLocker).
3. Install Node 22, git, and a password manager. Create a **new** SSH key (`ssh-keygen -t ed25519`) and add it to GitHub;
   delete the old key in GitHub → Settings → SSH keys.
4. Clone the repository fresh from GitHub.

**Done when:** the new machine has no file from the old one except documents, and GitHub lists only the new SSH key.

## Step 2 — Rotate every credential
Every secret named in `SECRETS_REQUIRED.md` / `apps/api/src/common/secrets-inventory.ts` gets a new value. Generate each
random secret with `openssl rand -base64 48`, put it straight into Railway → Variables, and save it in the password manager.
- App secrets: `AUTH_SESSION_SECRET`, `SERVICE_TOKEN_SECRET`.
- Encryption keys: `PAYMENT_ENC_KEY`, `APP_DATA_ENCRYPTION_KEY`, `MFA_ENC_KEY`, `TICKET_DELETION_ENC_KEY`, `PROVIDER_VAULT_KEK`,
  `FUNDING_VAULT_KEK`, `WEBHOOK_SIGNING_KEK`, `AI_PROVIDER_KEK`. **Keep the old value as `<NAME>_PREVIOUS`** so data sealed
  with it can still be read; the app re-seals on next write. Remove `_PREVIOUS` only after the re-seal job reports done.
- Provider keys (rotate in each console, then update Railway): Twilio auth token, SendGrid API key, CardPointe / Fiserv
  credentials, CommerceHub keys, Google API keys, OpenAI / Anthropic keys, AWS access keys, APNs key.
- `DATABASE_URL` is step 5.

**Done when:** every variable in Railway has a value created after the machine rebuild, and each old provider key shows
as revoked/deleted in its console. Signing in to the POS still works (sessions issued before rotation are logged out —
expected).

## Step 3 — Revoke the old Firebase key
1. Google Cloud console → IAM & Admin → Service Accounts → the Firebase Admin service account → Keys.
2. Delete the old key (the one created before the rebuild). Create a new JSON key.
3. Put it into Railway as `FCM_SERVICE_ACCOUNT_B64` (`base64 -i key.json`), then delete the JSON file from disk.
4. Also restrict or regenerate any Firebase **web API key** that was exposed (Google Cloud → APIs & Services → Credentials).

**Done when:** the key list shows only the new key, and a test push reaches a real phone.

## Step 4 — New Play upload key
1. Generate a new upload keystore on the new machine (`ANDROID_SUBMISSION_RUNBOOK.md` → "One-time signing keystore").
   Save the file and both passwords in the password manager — never in the repository.
2. Play Console → the app → Setup → App integrity → **Request upload key reset**, upload the new certificate
   (`keytool -export -rfc -keystore <file> -alias <alias> -file upload_certificate.pem`). Google takes 1–2 days.
3. After approval, sign the next build with the new key.

**Done when:** Play Console shows the new upload certificate fingerprint.

## Step 5 — Change the PostgreSQL password
1. Railway → Postgres service → Variables → regenerate the password (or `ALTER ROLE … PASSWORD …` on your provider).
2. Railway's reference variable updates `DATABASE_URL` on the API and worker; redeploy both.
3. Re-run `node apps/api/scripts/db-provision-roles.mjs` if you use the least-privilege worker role.

**Verify:** `OLD_DATABASE_URL='<the old string>' node tooling/k12/verify-k12.mjs` → `PASS step 5 old database login refused`.

## Step 6 — Close public port 5432
1. Railway → Postgres → Settings → Networking → **disable the TCP proxy** (public access). Services keep using private
   networking.
2. If the database is anywhere else, remove every firewall rule that allows 5432 from `0.0.0.0/0`.

**Verify (from your laptop, outside Railway):** `DB_PUBLIC_HOST=<old public host> node tooling/k12/verify-k12.mjs` →
`PASS step 6 port 5432 closed from outside`.

## Step 7 — Validate the new environment
1. API boots: `curl https://api.<domain>/health/ready` → 200. The boot check `network-posture.ts` logs no warning.
2. From inside the private network (Railway shell): `DATABASE_URL=… node tooling/k12/verify-k12.mjs` → step 7 PASS.
3. Sign in to the POS, open a ticket, check out with cash (sandbox only — production payments stay disabled until Fiserv
   certification), send one SMS test, open Super Admin → System Operations: every component HEALTHY.

**Done when:** all of the above pass and `verify-k12.mjs` shows no FAIL.

## Step 8 — Only then push the rewritten history
1. Install gitleaks; `node tooling/k12/verify-k12.mjs` → `PASS step 8 gitleaks full history clean`.
2. Push the rewritten history (`docs/COMMIT_MAP_K12_REWRITE.md` maps old commit ids to new ones).
3. In `.github/workflows/security.yml` remove `continue-on-error: true` from the gitleaks job so CI blocks any new leak;
   `verify-k12.mjs` then shows `PASS step 8 CI gitleaks job is blocking`.

---

## Rows 02–04 of the same PDF (code — already done)
Tests re-run on Nov 13 2026 in this session:
- **02 security containment / merchant configuration / durable financial recovery / split-payment guard / exact-service
  eligibility** — see `docs/mandates/status/REMAINING_PRODUCTION_STATUS.md` §9–26: merchant routing
  (`merchant-routing.pgtest` 15/15), app-payment recovery + split guard (`skip-line-recovery.pgtest` 8/8), exact-service
  eligibility (`technician-eligibility-batch` 63/63 + pgtests 4/4, legacy 8/8).
- **03 OCR infrastructure / Twilio ledger / expense allocation / 200-tech pilot / Customer Display privacy / lint** — OCR
  pipeline + Textract adapter (`ai-ocr-receipt-pipeline` + `.textract` 40/40; live run needs S3 + ClamAV/GuardDuty +
  Textract — `HOSTING_ACTIONS_FOR_KEVIN.md` A10/A11), SMS ledger (`sms-segments.pgtest` 5/5), shared-expense allocation
  (`expense-shared-costs.pgtest` 8/8), Customer Display 3-second release (`useDisplay.test` 13/13), 200-tech pilot (§40–46
  of the status report), lint cleared in round 10.
- **04 SUNMI responsive shell / 100 % zoom** — `apps/pos-web/src/shell/displayProfile.ts` + the Screen Check
  (`screenCheck.ts`, `ScreenCheckDialog`), all nine SUNMI batches (`docs/handoff/SUNMI_BATCH*`); the POS suite passed
  2,723/2,723 on Nov 13. Still needs a real SUNMI FLEX 3 at 100 % zoom: open each module and press Screen Check.

## Outside the code, still needed after K-12
- **Fiserv / CardPointe certification:** `npm run uat:cardpointe` with UAT credentials ($1 sale → void → reconcile), then
  the refund-recovery UAT (status report §32–33). Production card payments stay disabled until certified.
- **Real SUNMI device test:** row 04 above.
- **Textract / OCR live:** `HOSTING_ACTIONS_FOR_KEVIN.md` A10–A11, then set `EVIDENCE_S3_BUCKET`, `MEDIA_STORE=s3`,
  the Textract IAM role, `EVIDENCE_SCAN_ENABLED=1`, and upload one receipt in staging.
