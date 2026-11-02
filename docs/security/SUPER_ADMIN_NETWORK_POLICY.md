# Super Admin network policy (Security Deep Scan §136 / §29)

**What it does.** The IP blocks and the allowlist managed on *Super Admin → Security → IP blocks* (`ip_block_rules`) are
now **enforced** for the platform, together with the `SUPER_ADMIN_IP_ALLOWLIST` environment variable.

| Where | When |
|---|---|
| `/super-admin/*` (and `/api/v1/platform/*`, rewritten to it) | before the session is read |
| `POST /auth/login` with `portal: "super-admin"` | before the password is checked |
| any request carried by a `SUPER_ADMIN` session, any path | after the session is read |

Salon, owner, technician, customer and public traffic is **never** evaluated — a tenant route is unaffected.

**Rules** (`modules/super-admin/src/super-admin-security/network-policy-core.ts`, in order):

1. Loopback / unspecified / link-local always pass (an operator on the host is the last-resort way in).
2. An address inside the allowlist (DB allowlist rows ∪ `SUPER_ADMIN_IP_ALLOWLIST`) passes — even if it is also blocked.
3. An address inside an active block (status `blocked`, not past `expires_at`) → **403 `NETWORK_POLICY_DENIED`**.
4. If the allowlist is **non-empty**, any other address → **403 `NETWORK_POLICY_DENIED`**. An empty allowlist means
   "no allowlist" — it never locks everyone out.

IPv4 and IPv6, exact addresses and CIDR ranges all match. The client address is `clientIp(req)` — Express's resolution
under `TRUST_PROXY_HOPS` (1 behind Railway's edge); a client-written `X-Forwarded-For` prefix is ignored.

**Every refusal** writes a `NETWORK_POLICY_DENIED` security event (HIGH) and a platform audit row
(`module=security, action=network_policy_denied`) — at most once per address + reason per minute per API process.

**Cache.** Rules are read from the database at most every 15 s per process (`NETWORK_POLICY_CACHE_MS`, 0–300000). A rule
change made on the IP-blocks screen takes effect at once on the process that served it and within one TTL elsewhere.
A database error keeps the last rules that loaded (fail open on the database — an outage never locks administrators out).

**Lockout guard.** Adding an allowlist entry is refused when the admin adding it would end up outside the allowlist
(add your own address or range first).

## Configuration

| Variable | Values | Default |
|---|---|---|
| `SUPER_ADMIN_IP_ALLOWLIST` | comma/space separated IPs or CIDRs (`203.0.113.0/24, 2001:db8::/32`) | empty (no env allowlist) |
| `SUPER_ADMIN_NETWORK_POLICY` | `enforce` · `report` (record refusals, refuse nothing) · `off` (break-glass) | `enforce` |
| `NETWORK_POLICY_CACHE_MS` | 0–300000 | 15000 |

**Before the first deploy with this code:** check what the database allowlist already contains — any row there now
restricts platform access to it:
`select target, reason from ip_block_rules where is_allowlist and status = 'whitelisted';`

## Break-glass (locked out of Super Admin)

Pick the least invasive that works:

1. **Report mode / off** — set `SUPER_ADMIN_NETWORK_POLICY=report` (or `off`) on the API service and redeploy/restart.
   Sign in, fix the rules on *Security → IP blocks*, then set it back to `enforce`.
2. **Env allowlist** — add your current address to `SUPER_ADMIN_IP_ALLOWLIST` and restart (it is unioned with the DB list).
3. **Database** — with the database credential: unblock (`update ip_block_rules set status = 'allowed' where id = …`) or
   remove the offending allowlist row's status (`update ip_block_rules set status = 'under_review' where is_allowlist and id = …`);
   the change is picked up within one cache TTL.
4. **Host** — a request from the API host itself (loopback) is always admitted.

Every break-glass use should be recorded in the incident log (`SECURITY_RUNBOOKS.md`, Super Admin compromise).

Tests: `modules/super-admin/src/super-admin-security/network-policy.vitest.spec.ts` (rules, cache, invalidation, DB
failure, lockout guard), `apps/api/src/common/platform-network-policy.vitest.spec.ts` (a real Nest app registered as
AppModule registers it: blocked IP → 403 on the realm and platform login, allowlist, tenant routes unaffected,
X-Forwarded-For spoofing ignored, audit + security event, report/off modes).

## Trusted device (S-A13, Oct 27 2026)

A platform (`SUPER_ADMIN`) account signs in **only from a device approved for platform use**. The device is the one the
sign-in already identifies (`auth_devices`: the native per-install id, or the httpOnly `aps_device` browser cookie).
The check runs **after** the password **and** the authenticator code succeeded and **before** a session exists
(`modules/identity/src/auth/auth.controller.ts` → `PlatformDeviceTrust`, `platform-device-trust.ts`).

| Situation | Result |
|---|---|
| Device approved | sign-in continues |
| Account has **no** approved device (a new platform account's first sign-in) | this device is approved (`first_device`), audited (`platform_device_approved`), sign-in continues |
| Device not approved | **403 `DEVICE_APPROVAL_REQUIRED`**, no session; a one-time link (30 min, single use, only its sha256 stored, at most 5 per account per hour) is emailed to the account holder; `PLATFORM_DEVICE_APPROVAL_REQUIRED` auth event + HIGH security event (`resource_type = platform_device`) |
| Device could not be identified / checked (enforce mode) | **503 `DEVICE_CHECK_UNAVAILABLE`** (fail closed) |
| Salon / owner / technician / customer sign-in | never evaluated |

**Ways to approve a device**

1. **Email** — open the link → the admin portal page `/approve-device` → press *Approve this device* (opening the page
   approves nothing, so a mail scanner pre-fetching the link cannot approve). `POST /public/security/approve-device {token}`.
2. **From an approved device** — *Settings → Devices → Approve* (`POST /auth/devices/{id}/approve-platform`, step-up:
   password + authenticator again; in the `check:critical-step-up` list).
3. **Deploy backfill** — migration 698 approved every non-revoked device Super Admin accounts already used, so the
   deploy locks nobody out.

Revoking or blocking a device (Settings → Devices, or *This wasn't me*) clears its approval.

A passkey (`/auth/webauthn/authenticate/*`) is itself a device-bound credential registered from a signed-in session; it is
not gated a second time.

| Variable | Values | Default |
|---|---|---|
| `SUPER_ADMIN_DEVICE_POLICY` | `enforce` · `report` (record, refuse nothing, mail nobody) · `off` (break-glass, no evaluation) | `enforce` when `NODE_ENV=production`, `report` otherwise |
| `ADMIN_BASE_URL` | the admin portal origin the approval link points at | the tenant portal URL (`APP_BASE_URL` …) |

**Break-glass (no approved device and no email delivery):** set `SUPER_ADMIN_DEVICE_POLICY=report` on the API service,
restart, sign in, approve the device under *Settings → Devices* (or sign in once and let the device be recorded), then set it
back to `enforce`. With database access only: `update auth_devices set platform_approved_at = now(), platform_approved_via = 'device'
where id = '<device id>' and user_id = '<user id>';` Record every break-glass use in the incident log.

Tests: `modules/identity/src/auth/platform-device-trust.pgtest.vitest.spec.ts` (10: bootstrap, refusal without a session,
email link single use / expiry / hash-only storage, approval from an approved device, revoke and not-me withdraw the approval,
throttle, salon sign-ins unaffected, report / off), `apps/admin-web/src/screens/ApproveDeviceScreen.test.tsx` (3),
`PlatformDevicesPanel.test.tsx` (2).
