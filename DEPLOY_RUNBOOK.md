> **SUPERSEDED (Jul 30 2026).** Canonical doc: **DEPLOYMENT.md**. This file is preserved history — do not follow it for current commands.

# AIPowerSalon — Production Deploy Runbook

End-to-end go-live. Items marked **[you]** require your accounts/identity/credentials (I can't do these from a
sandbox). Everything else is automated by the scripts/IaC in this repo. Run `node apps/api/scripts/preflight.mjs`
before starting the API in any environment.

> **Verified baseline (clean checkout):** backend `bash scripts/run-core-specs.sh` → 632 tests, RESULT: PASS; admin-web
> `npx vitest run` → 168 tests. Latest migration is `100_go_checkin_allowed_branches.sql` — the Dockerfile applies all
> migrations on container start, so chargebacks, gateway onboarding/paused status, check-in token expiry, and multi-branch
> devices are all provisioned automatically.

## 0. Prereqs **[you]**
- AWS account + IAM user with admin (for `terraform apply`); an EC2 key pair; a registered domain (`aipowersalon.com`).
- Decide subdomains: `api.` (backend), `pos.` + `admin.` (web apps).

## 1. Provision AWS (Terraform)
```bash
cd deploy/terraform
cat > terraform.tfvars <<TF
ssh_admin_cidr = "YOUR.IP.ADDR/32"
key_name       = "your-ec2-keypair"
db_password    = "a-long-strong-password"
TF
terraform init && terraform plan      # review!
terraform apply
```
Outputs: `api_elastic_ip` (the dedicated IP), `rds_endpoint`, `pos_cloudfront_url`, `admin_cloudfront_url`.
> I wrote this IaC but cannot `terraform apply` it (no AWS account here) — review the plan before applying.

## 2. DNS **[you]**
- `api.aipowersalon.com` A → **api_elastic_ip**.
- `pos.` / `admin.` CNAME → the CloudFront domains (or add an ACM cert in the distribution for the custom names).

## 3. Build + push the API image, run on EC2
```bash
# Build + push to ECR (the Dockerfile already runs migrations on container start):
aws ecr create-repository --repository-name aipowersalon-api
docker build -t aipowersalon-api .
docker tag aipowersalon-api:latest <ACCT>.dkr.ecr.<region>.amazonaws.com/aipowersalon-api:latest
docker push <ACCT>.dkr.ecr.<region>.amazonaws.com/aipowersalon-api:latest
```
On the EC2 host: create `/etc/aipowersalon.env` from `.env.production.example` (set `DATABASE_URL` to the RDS endpoint,
`AUTH_SESSION_SECRET`, `MFA_ENC_KEY`, `WEB_CORS_ORIGINS=https://pos.aipowersalon.com,https://admin.aipowersalon.com`,
`PAYMENTS_WEBHOOK_RAW_BODY=1` (so processor webhook signatures can be verified), and Redis if multi-node), then:
```bash
node /path/preflight.mjs                     # gate: refuses if required vars missing
docker run -d --restart always -p 127.0.0.1:3000:3000 --env-file /etc/aipowersalon.env <ECR_IMAGE>
sudo certbot --nginx -d api.aipowersalon.com # TLS; nginx proxies 443 -> 127.0.0.1:3000
```

## 4. Deploy the web apps (pos-web, admin-web)
```bash
# Build each pointing at the live API, then sync to its S3 bucket + invalidate CloudFront:
( cd apps/pos-web   && VITE_API_BASE=https://api.aipowersalon.com npm run build && aws s3 sync dist/ s3://aipowersalon-pos-web --delete )
( cd apps/admin-web && VITE_API_BASE=https://api.aipowersalon.com npm run build && aws s3 sync dist/ s3://aipowersalon-admin-web --delete )
aws cloudfront create-invalidation --distribution-id <ID> --paths '/*'
```

## 5. Live integrations **[you — account/credential acquisition]**
Set these in `/etc/aipowersalon.env`, re-run preflight, restart the container.
- **CardPointe MID**: apply for a Fiserv/CardConnect merchant account; once approved set `FISERV_MERCHANT_ID` +
  `FISERV_SECRET` (and **allowlist api_elastic_ip with Fiserv** — that's why we use an Elastic IP). Leave
  `PAYMENTS_SANDBOX` unset for live charges.
  - **Webhook signatures**: incoming processor webhooks are signature-verified before any money is applied (invalid →
    401, nothing posted). Fiserv/CardPointe/Clover use the generic HMAC-SHA256 hex scheme by default — **confirm the exact
    signature header against the Fiserv sandbox** and adjust if needed; this is the one payment detail that needs a live
    sandbox round-trip. Fiserv/CardPointe and Clover both verify with a generic HMAC-SHA256 (hex) signature
    over the raw body.
- **Twilio + A2P 10DLC**: buy a number, register a Brand + Campaign (10DLC) — carrier approval takes days. Then set
  `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`.
- **SendGrid**: verify a sender domain, create an API key → `SENDGRID_API_KEY`, `SENDGRID_FROM`.
- **FCM**: create a Firebase project, get the server key → `FCM_SERVER_KEY`.
- **Go Check-In tokens** (optional): `GO_CHECKIN_TOKEN_TTL_DAYS` controls kiosk pairing-token expiry (default 90; 0 =
  never). Regenerating a token re-issues it and re-activates an expired device.
Preflight will show each as LIVE vs MOCK so you can confirm before launch.

## 5f. The tenant portal URL — derived, not configured

`WEB_CORS_ORIGINS` is the single source of truth. Invite links and branded-email logos take the portal URL from
it, so **there is no `pos.` vs `app.` decision to make**: whichever host you put in the allowlist *is* the portal.

```bash
WEB_CORS_ORIGINS=https://pos.aipowersalon.com,https://admin.aipowersalon.com,https://aipowersalon.com
```

The first entry that is not the Super Admin console (`admin.*`) and not the public marketing site
(`aipowersalon.com`) is the tenant portal. `APP_BASE_URL` still overrides if you ever need it.

**Why this changed.** The URL used to be hard-coded in two places, behind three different env vars, each falling
back to a guess — and earlier those guesses pointed at **`app.aipowersalon.com`, a host provisioned nowhere.**
Invite links and email logos pointed at a domain that did not exist. Nothing failed and nothing logged; the only
person who would ever have found out was a customer clicking a dead link.

If the portal cannot be derived at all, it now **warns** rather than silently guessing.

## 5a. Enroll Super Admin MFA — **DO THIS BEFORE YOUR FIRST LOGIN** ⚠️

SUPER_ADMIN has MFA **required** (`ROLE_MFA` in `apps/api/src/auth/security.ts`), and in production
(`NODE_ENV=production`, or `MFA_REQUIRE_TOTP=1`) the API accepts **only a real enrolled TOTP factor** — the
permissive any-6-digit dev fallback is off.

That creates a chicken-and-egg on a fresh deploy: the in-app MFA enrollment endpoint needs a session, but you
can't get a session until MFA is satisfied. **If you skip this step you will be locked out of your own admin
console**, and step 5b below (which assumes you're already signed in) is unreachable.

Run the operator bootstrap once per admin, **with the same secret-encryption key the API uses**
(`MFA_ENC_KEY`, or `AUTH_SESSION_SECRET` when `MFA_ENC_KEY` is unset) — otherwise the stored secret cannot be
decrypted at login:

```bash
# platform Super Admin (tenant_id NULL)
DATABASE_URL=postgres://…  AUTH_SESSION_SECRET='<same as the API>' \
  npx tsx apps/api/scripts/enroll-mfa.ts --email admin@company.com --super-admin

# a tenant user (e.g. a salon owner), if you force MFA for them
DATABASE_URL=postgres://…  AUTH_SESSION_SECRET='<same as the API>' \
  npx tsx apps/api/scripts/enroll-mfa.ts --email owner@salon.com --salon LUXE
```

It prints the secret + `otpauth://` URI — scan it into an authenticator app (Google Authenticator, 1Password,
Authy). Verify you can sign in to `admin.` **before** moving on.

## 5d. Cross-app routing (optional) **[you — only if you want it]**

By default every authenticated tenant user lands in the **POS** shell, and the backend's RBAC denies whatever
they may not do. That is safe, and it is what happens today.

If you want a technician who signs in at the POS to be sent to the **technician app** instead (and an owner to
the owner app), set these when building `pos-web`:

```bash
VITE_TECH_WEB_URL=https://tech.aipowersalon.com
VITE_OWNER_WEB_URL=https://owner.aipowersalon.com
```

**Leave them unset and nothing changes** — no redirect, everyone stays in the POS. There is no default
destination, so an unknown role can never produce one.

**Open-redirect safety.** A post-login redirect is a classic hole: influence the destination and you send a
freshly-authenticated user, cookie in hand, to a site you control. So the destination comes **only** from the
server-issued role — never a query param, a `returnTo`, or anything a page can supply. Every URL must be
absolute, `https:` (localhost excepted for dev), and free of embedded credentials; anything else is discarded
and the user simply stays put. A portal pointing at the POS host itself is ignored rather than looping forever.

## 5e. Native iOS / Android apps **[you — if you ship native]**

The web apps authenticate with an **httpOnly cookie**. A native shell cannot: inside Capacitor/WebView the page
origin is `capacitor://localhost`, so a call to `api.aipowersalon.com` is **cross-site** and a `SameSite=Lax`
cookie is **never sent**. Native therefore uses a **bearer token**.

**Server side.** The token is returned in the login body **only to native clients**. The API decides from the
**`Origin` header — which a browser sets and page script cannot change**. So the web app (and any XSS in it)
**can never obtain a token**; it keeps the httpOnly cookie, and the token stays out of JavaScript.

Recognised native origins: `capacitor://localhost`, `ionic://localhost`, `http://localhost`, `https://localhost`,
plus anything in `NATIVE_APP_ORIGINS` (comma-separated). A request with **no `Origin` at all** (React Native
`fetch`, `URLSession`) is treated as native — browsers always send `Origin` on a POST.

```bash
# only if your shell reports a different origin
NATIVE_APP_ORIGINS=app://aipowersalon
```

**CORS is automatic.** The native origins are added to the CORS allowlist from the **same list** the auth layer
uses to decide who may receive a bearer token (`auth/native-client.ts`), so the two cannot drift apart or be
forgotten separately. You only need `NATIVE_APP_ORIGINS` if your shell reports something unusual.

This matters because the failure mode is invisible: if `capacitor://localhost` were missing from the allowlist,
the WebView would block **every** request *before it left the phone*. The API would log nothing (it never sees
them), the app would show a generic network error, and **no test anywhere would fail** — because in a browser it
all works. A test now pins it.

**Which apps.** Native auth is wired in **`customer-web`, `tech-web`, `owner-web` and `manager-pay-web`** — the
four that ship as iOS/Android builds. **`pos-web` (iMac + Safari) and `admin-web` (desktop) deliberately do NOT
use it**: they are same-origin with the API, where the httpOnly cookie is both correct and stronger (the token
never enters JavaScript, so XSS cannot steal it).

A guard (`native-auth-coverage.vitest.spec.ts`) asserts every native-shipped app attaches the bearer token, keeps
it out of `localStorage`, and clears it on sign-out — so the next app cannot ship unable to log in on a phone.

**App side.** At start-up, hand the app's **Keychain / Keystore** plugin to `useSecureStore(...)`. After login the
token is written there (never `localStorage`) and sent as `Authorization: Bearer`. **Sign-out removes it** — a
token left in the Keychain outlives the sign-out, which is exactly what someone holding the device would look for.

Native sessions carry a **`sid`**, so "sign out other devices" and admin session-kill work on the phone too.

### ⚠️ Face ID ships DISABLED

The verifier is real and provably **rejects** forged ceremonies (8 tests). What could not be proven without a
physical device is that it **accepts** a genuine one. An auth path whose success case has never been executed is
not reachable in production by default.

```bash
FACE_ID_ENABLED=1     # the whole configuration — only after the staging check
```

**No `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` to get wrong.** The server derives both from the browser's own `Origin`
header (unforgeable by page script, and it cannot disagree with the browser), accepting it only if it is already
on your `WEB_CORS_ORIGINS` allowlist. If it isn't, the API log names the origin and lists the trusted ones. The
env overrides still exist if you want them.

Run **`FACEID_STAGING_CHECK.md`** first — ten minutes, one device. While disabled, the ceremony routes 404 and the
app hides the button (a button that cannot work is worse than none). Only an explicit `1`/`true` enables it.

### Face ID on native

The web app uses **WebAuthn**. That is a *browser* API — inside an iOS WKWebView it is unavailable or unreliable,
so a native build cannot use it. Native uses Apple's/Android's own biometrics + **Keychain/Keystore**, which is
what the spec asks for:

- **Enrol** (after a *normal* sign-in — always opt-in, never silent): the **session token** is stored behind
  biometric access control. **Never the password** — a password is a permanent credential; a session token can be
  revoked server-side, and revoking it kills Face ID with it.
- **Sign in**: Face ID releases the token — and then we **revalidate it against the backend**.

> **A successful Face ID scan is NOT authentication.** It proves who is holding the phone. It proves nothing about
> whether the *session* is still valid — the token may have been revoked ("sign out other devices"), expired, or
> belong to an account since disabled. So the server is always asked, and if it refuses, the Keychain item is
> **wiped**. A revoked session can never be resurrected by a face.

### Native plugins

**Already declared in `package.json` — a normal `npm install` gets them.** Nothing extra to remember:

```bash
npm install                       # from the repo root
(cd apps/customer-web && npx cap sync)   # …and the same for tech-web / owner-web / manager-pay-web
```

- `capacitor-secure-storage-plugin` — Keychain (iOS) / EncryptedSharedPreferences (Android). In **all four**
  native apps; without it the bearer token lives in memory only and the user re-signs-in on every launch.
- `capacitor-native-biometric` — Face ID / Touch ID. In **customer-web only**, the one app with Face ID. The other
  three do not ship a plugin they never use.

A guard asserts both, so a missing plugin fails a test rather than becoming a mystery on a phone.

`initNative()` (already called from `main.tsx`) installs them on native and is a **no-op on the web** — the web
build gains no token and no native code path, so its httpOnly-cookie protection is untouched.

**If a plugin is missing the app still runs**, and it says so honestly rather than pretending: without secure
storage the token lives in memory for the session only; without biometrics Face ID is simply unavailable. **It
never falls back to `localStorage`** — a bearer token in a plain file on a jailbroken device is precisely what
someone holding the handset would go looking for.

### ⚠️ The native build MUST set an absolute API base

```bash
VITE_API_BASE=https://api.aipowersalon.com npm run build   # then: npx cap sync
```

On the web an empty base means "same-origin", which is correct. **Inside the native shell the origin is
`capacitor://localhost`**, so an empty base makes every request resolve to `capacitor://localhost/customer/...` —
a path that does not exist. **Every API call fails.** On a phone it surfaces as a generic network error with no
clue why, and nothing in the build would have warned you.

`initNative()` now **throws at start-up** if a native build has no absolute `https://` base — loudly, on your
machine, rather than silently on a customer's phone.

**Do not change `iosScheme` / `androidScheme`** without adding the new origin to `NATIVE_APP_ORIGINS`. Those
schemes decide the `Origin` the API sees; if they drift, the app is hit twice at once — CORS blocks every request
*and* it is no longer recognised as native, so it never gets a token. Both failures are invisible from the server
(the requests never arrive). A test pins the link.
Cancelling the prompt is handled as a cancellation, not a failure; a biometric mismatch fails without wiping the
enrolment, so the real owner can retry or use their password.

## 5c. Evidence storage + malware scanning (Safety Community)

**This is now `terraform apply` — no console clicks.** The evidence bucket, GuardDuty malware scanning, and the
API's IAM access are all in `deploy/terraform`.

```bash
cd deploy/terraform
terraform apply          # creates the bucket, enables GuardDuty scanning, grants the API access
terraform output evidence_bucket
```

Then set that value on the API and restart:

```bash
EVIDENCE_S3_BUCKET=<the output above>
EVIDENCE_S3_REGION=us-east-1        # or reuse AWS_REGION
```

**What `apply` creates** (and why each matters):

- **A private, encrypted, versioned S3 bucket.** Public access is blocked at the bucket level — evidence in a
  safety report is precisely the kind of thing that must never be world-readable. Versioning means someone cannot
  destroy evidence mid-investigation.
- **GuardDuty Malware Protection for S3, with object tagging ENABLED.** It scans each upload and writes a
  `GuardDutyMalwareScanStatus` tag. **The API reads that tag** and will not release a file to a moderator until it
  says clean. (Tagging is the whole mechanism — without it nothing is ever released.)
- **An IAM instance role for the API.** It previously had **no instance profile at all**, so it could not have
  reached S3 even if the bucket existed. Scoped to the evidence bucket only, including
  `s3:GetObjectTagging` — the permission that lets it read the scan result.

**Fail-closed until then.** With no bucket configured, evidence stays **locked**: no tag, a failed scan, an
unrecognised value, or an S3 outage all read as `unscanned`, and no moderator can open the file. Nothing in the
code can report `clean` unless a scanner explicitly said so.

## 5b. Configure the new admin modules **[you — in-app, after the API + admin-web are live]**
No code needed; these are operated from the live admin console:
- **Go Check-In devices** — admin-web → **Check-In Devices** (Super Admin). Pick the tenant, master-enable check-in, then
  add a device per kiosk to get its check-in URL + token. For a shared front-desk kiosk serving multiple locations, set the
  **Default branch** and tick **"Also serves"** branches; the kiosk then shows a location picker and each check-in lands in
  the chosen branch's queue. Tokens show their expiry; "Regenerate" rotates them.
- **Payment Gateways** — admin-web → **Payment Gateways** (Super Admin) is the per-tenant command center: live status,
  today's volume (intraday) vs settled MTD, chargebacks, underwriting/onboarding status (advances from processor webhook
  events), branch footprint, and pause/resume/disable lifecycle.

## 6. Native apps **[you — enrollment + signing on your machines]**
- Enroll: **Apple Developer Program** + **Google Play Console**.
- Android: `scripts/make-android-keystore.sh` once, then `scripts/build-android.sh` (needs Android SDK + the keystore
  env vars) → 5 signed `.aab` → upload to Play Console.
- iOS: edit `deploy/ExportOptions.plist` (Team ID + profiles), then `scripts/build-ios.sh` on macOS+Xcode → 5 `.ipa`
  → App Store Connect. Both scripts bake `VITE_API_BASE` into the web layer so the apps call your live API.
> Binaries can't be built/signed in this Linux sandbox — they need macOS+Xcode / Android SDK and your certificates.

## 7. Smoke test
Sign in to each surface (the 5 native + pos/admin web), run one sandbox checkout, confirm `/health` 200, confirm SSE
updates (and that login lockout/realtime work across nodes if you scaled to 2+). Also exercise the recent modules:
- **Go Check-In**: open a device's check-in URL; on a multi-branch device pick a location, complete a walk-in, and confirm
  the queue ticket appears in **that** branch's POS queue (and live, via SSE). Let a token expire (or set a short TTL) and
  confirm the kiosk reports it and "Regenerate" restores access.
- **Payment Gateways** (admin-web, Super Admin): confirm a tenant's status, today's-volume, and onboarding fields render;
  fire a sandbox processor webhook and confirm a bad signature is rejected (401, nothing posted) while a valid one applies.
- **Customer display**: pair a display, push a ticket from POS, submit a tip, and confirm it reflects back on the POS.
