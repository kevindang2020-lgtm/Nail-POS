# MERGE STATUS — developer tree (Power-Salon-main.zip) into the modularised repo

> **Superseded Sep 30 2026 by `MERGE_REPORT_2026-09.md`** — the final report. This file is the working log, kept for the hunk-by-hunk record.

State on Sep 29 2026: a 3-way merge is IN PROGRESS in /home/claude/work/full (`git merge --no-commit developer-2026-09`).
Nothing is committed on main yet; `git merge --abort` restores main to `790b1c4` at any time.

## What the upload is
- The developer's tree, exported without git history, 6,126 files.
- Its merge base in our history is **`1c483a7` (2026-07-31)** — two commits before our base `f420cfe` (it lacks the
  Aug-3 booking-public / booking-html work).
- On top of that base it carries **651 edited files and 533 new files** (68,889 insertions / 13,832 deletions):
  apps/pos-web 198 edits, api 155, admin-web 116, customer-web 73, owner-web 46, tech-web 42; new files mostly in
  owner-web (84), tech-web (80), customer-web (78), manager-pay-web (72), api (35).
- Their migrations 432–437 (tenant default commission, avatar url, loyalty ledger, skill request & schedule, inventory
  branch overrides ×2, cash drawer registers) — **432 collides by number** with our `432_drop_duplicate_merchant_risk_index`,
  and 433–437 collide by number with ours (433–471); the migrate ledger keys by file NAME so both sets can apply, but
  ORDER and TABLE collisions must be checked before commit.
- `dist-frontends/` (147 built files) dropped from the branch (build output, never tracked).

## Branch layout
- `developer-2026-09` = `1c483a7` + the upload (worktree /home/claude/work/devbranch, commits `eba3e0c` + one drop).
- main = `790b1c4` (Constitutions 7–13 done on the modularised tree).

## Merge result so far
- 1,187 files changed on their side; **1,087 auto-merged**, **100 conflicts**:
  - 78 content conflicts (both sides edited):
    - SECURITY_REPORT.md
    - apps/admin-web/src/api/client.ts
    - apps/admin-web/src/screens/AiInsightsScreen.tsx
    - apps/admin-web/src/screens/SecurityScreen.tsx
    - apps/admin-web/src/screens/SystemStatusScreen.tsx
    - apps/admin-web/src/screens/TenantsScreen.tsx
    - apps/admin-web/src/shell/AdminLayout.tsx
    - apps/admin-web/vite.config.ts
    - apps/api/src/app.module.ts
    - apps/api/src/customer/customer.controller.ts
    - apps/api/src/customer/customer.dto.ts
    - apps/api/src/customer/customer.module.ts
    - apps/api/src/customer/customer.service.ts
    - apps/api/src/main.ts
    - apps/customer-display/vite.config.ts
    - apps/customer-web/src/api/customerApi.ts
    - apps/customer-web/src/api/customerNailShowcaseApi.ts
    - apps/customer-web/src/screens/FindSalonsScreen.tsx
    - apps/customer-web/src/screens/LoginScreen.tsx
    - apps/customer-web/src/screens/ProfileSecurityScreen.tsx
    - apps/customer-web/vite.config.ts
    - apps/manager-pay-web/vite.config.ts
    - apps/owner-web/src/api/ownerApi.ts
    - apps/owner-web/src/screens/LoginScreen.tsx
    - apps/owner-web/src/shell/SalonSwitcher.tsx
    - apps/pos-web/package.json
    - apps/pos-web/src/api/authApi.ts
    - apps/pos-web/src/api/posAiApi.ts
    - apps/pos-web/src/realtime/realtime-core.ts
    - apps/pos-web/src/screens/POSBookingScreen.tsx
    - apps/pos-web/src/screens/POSCustomerProfileScreen.tsx
    - apps/pos-web/src/screens/POSDevicesScreen.tsx
    - apps/pos-web/vite.config.ts
    - apps/tech-web/package.json
    - apps/tech-web/src/api/techApi.ts
    - apps/tech-web/src/screens/LoginScreen.tsx
    - apps/tech-web/src/screens/MoreScreen.tsx
    - modules/ai/src/ai-center/ai-center.dto.ts
    - modules/analytics/src/owner/owner.controller.ts
    - modules/analytics/src/owner/owner.kysely.repository.ts
    - modules/analytics/src/owner/owner.service.ts
    - modules/booking/src/booking/booking.kysely.repository.ts
    - modules/booking/src/customer-activation/customer-activation.service.ts
    - modules/booking/src/customer-booking/customer-booking.service.ts
    - modules/catalog/src/service-add-ons/service-add-ons.controller.ts
    - modules/checkout/src/cash-drawer/cash-drawer.repository.ts
    - modules/checkout/src/cash-drawer/cash-drawer.service.ts
    - modules/checkout/src/checkout/checkout-discount-engine.ts
    - modules/checkout/src/checkout/checkout.dto.ts
    - modules/checkout/src/checkout/checkout.kysely.repository.ts
    - modules/checkout/src/skip-line-checkout/skip-line-checkout.repository.ts
    - modules/checkout/src/skip-line-checkout/skip-line-checkout.service.ts
    - modules/communications/src/sms-packages/sms-reconciliation.service.ts
    - modules/identity/src/auth/account.controller.ts
    - modules/identity/src/auth/auth.controller.ts
    - modules/memberships/src/membership-enroll.kysely.repository.ts
    - modules/payments/src/refunds-voids/refund-orchestration.ts
    - modules/payments/src/refunds-voids/refund-orchestration.vitest.spec.ts
    - modules/queue/src/check-in/check-in.dto.ts
    - modules/queue/src/check-in/check-in.module.ts
    - modules/queue/src/check-in/check-in.service.ts
    - modules/queue/src/queue/queue.kysely.repository.ts
    - modules/queue/src/service-done/service-done.kysely.repository.ts
    - modules/queue/src/serving/serving.kysely.repository.ts
    - modules/queue/src/tech/tech-dashboard.dto.ts
    - modules/queue/src/tech/tech.kysely.repository.ts
    - modules/queue/src/tech/tech.repository.ts
    - modules/queue/src/tech/tech.service.ts
    - modules/super-admin/src/super-admin-owners/super-admin-owners.service.ts
    - modules/super-admin/src/super-admin-platform/super-admin-platform.repository.ts
    - modules/super-admin/src/super-admin-staff/global-tech-admin.service.ts
    - modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts
    - modules/tenants/src/devices/devices-overview-core.ts
    - modules/workforce/src/pos-team/pos-team.service.ts
    - modules/workforce/src/tech-profile/tech-profile.service.ts
    - modules/workforce/src/technicians/commission-security.service.ts
    - modules/workforce/src/time-clock/time-clock.kysely.repository.ts
    - package-lock.json
    - packages/api-contracts/src/customer/customer-booking.ts
    - packages/mobile-sdk/src/faceid.ts
    - packages/mobile-sdk/src/native-bootstrap.ts
    - packages/permissions/src/rbac.ts
  - 18 modify/delete — files WE consolidated into packages (http-core → api client, faceid/native-auth/native-bootstrap →
    the native package, InlineConfirm → ui) and THEY edited in place; their edits must be ported into the consolidated
    copy, then the old file stays deleted:
    - apps/admin-web/src/api/http-core.ts
    - apps/api/src/cash-drawer/cash-drawer.dto.ts
    - apps/api/src/owner/owner.module.ts
    - apps/customer-web/src/auth/faceid.ts
    - apps/manager-pay-web/src/api/http-core.ts
    - apps/manager-pay-web/src/auth/faceid.ts
    - apps/manager-pay-web/src/auth/native-bootstrap.ts
    - apps/owner-web/src/api/http-core.ts
    - apps/owner-web/src/auth/native-auth.ts
    - apps/owner-web/src/auth/native-bootstrap.ts
    - apps/owner-web/src/auth/native-faceid.ts
    - apps/owner-web/src/components/InlineConfirm.tsx
    - apps/pos-web/src/api/http-core.ts
    - apps/tech-web/src/api/http-core.ts
    - apps/tech-web/src/auth/faceid.ts
    - apps/tech-web/src/auth/native-auth.ts
    - apps/tech-web/src/auth/native-bootstrap.ts
    - apps/tech-web/src/auth/native-faceid.ts
  - 4 file-location — their NEW api files landed in the old monolith path; move into the module the directory became:
    - apps/api/src/checkout/checkout-discount-engine.ts
    - apps/api/src/refunds-voids/refund-orchestration.ts
    - apps/api/src/refunds-voids/refund-orchestration.vitest.spec.ts
    - apps/api/src/technicians/commission-security.service.ts
- Their other 31 new api files were auto-placed under apps/api/src/… (old monolith layout); each must move into its module
  (the architecture and dedup gates will list them).

## Method for the rest (in this order)
1. Content conflicts: take the union when both sides added; where they changed behaviour, keep OUR constitution work
   (guards, audit, step-up, tenant scoping) and add THEIR feature. Never drop a test.
2. Modify/delete: diff `1c483a7..developer-2026-09` for each, port the change into the consolidated file, keep the delete.
3. File-location + the 31 new api files: `git mv` into modules/*, fix imports, register in the module.
4. Migrations: renumber theirs to 472–478 (their content unchanged), check table/column collisions against ours.
5. Build every package/module/app; `node tooling/ci/run-gates.mjs`; the 6 API shards; every app suite; real-Postgres
   migrate; architecture; security lane. Fix what breaks. Only then commit the merge with an honest message.
6. Write MERGE_REPORT_2026-09.md: what came in, what was reconciled, what was dropped and why.

## Progress (Sep 29, turn 2)
Resolved in the working tree (markers gone; NOT yet `git add`ed, NOT committed):
- apps/admin-web/src/api/client.ts
- apps/admin-web/src/api/http-core.ts
- apps/admin-web/vite.config.ts
- apps/api/src/app.module.ts
- apps/api/src/cash-drawer/cash-drawer.dto.ts
- apps/api/src/customer/customer.controller.ts
- apps/api/src/customer/customer.dto.ts
- apps/api/src/customer/customer.module.ts
- apps/api/src/customer/customer.service.ts
- apps/api/src/owner/owner.module.ts
- apps/customer-display/vite.config.ts
- apps/customer-web/src/auth/faceid.ts
- apps/customer-web/src/screens/LoginScreen.tsx
- apps/customer-web/vite.config.ts
- apps/manager-pay-web/src/api/http-core.ts
- apps/manager-pay-web/src/auth/faceid.ts
- apps/manager-pay-web/src/auth/native-bootstrap.ts
- apps/manager-pay-web/vite.config.ts
- apps/owner-web/src/api/http-core.ts
- apps/owner-web/src/auth/native-auth.ts
- apps/owner-web/src/auth/native-bootstrap.ts
- apps/owner-web/src/auth/native-faceid.ts
- apps/owner-web/src/components/InlineConfirm.tsx
- apps/owner-web/src/screens/LoginScreen.tsx
- apps/pos-web/src/api/authApi.ts
- apps/pos-web/src/api/http-core.ts
- apps/pos-web/vite.config.ts
- apps/tech-web/src/api/http-core.ts
- apps/tech-web/src/auth/faceid.ts
- apps/tech-web/src/auth/native-auth.ts
- apps/tech-web/src/auth/native-bootstrap.ts
- apps/tech-web/src/auth/native-faceid.ts
- apps/tech-web/src/screens/LoginScreen.tsx
- modules/ai/src/ai-center/ai-center.dto.ts
- modules/analytics/src/owner/owner.controller.ts
- modules/analytics/src/owner/owner.kysely.repository.ts
- modules/analytics/src/owner/owner.service.ts
- modules/booking/src/booking/booking.kysely.repository.ts
- modules/booking/src/customer-activation/customer-activation.service.ts
- modules/booking/src/customer-booking/customer-booking.service.ts
- modules/catalog/src/service-add-ons/service-add-ons.controller.ts
- modules/checkout/src/checkout/checkout-discount-engine.ts
- modules/checkout/src/checkout/checkout.dto.ts
- modules/checkout/src/checkout/checkout.kysely.repository.ts
- modules/checkout/src/skip-line-checkout/skip-line-checkout.service.ts
- modules/identity/src/auth/account.controller.ts
- modules/identity/src/auth/auth.controller.ts
- modules/payments/src/refunds-voids/refund-orchestration.ts
- modules/payments/src/refunds-voids/refund-orchestration.vitest.spec.ts
- modules/queue/src/service-done/service-done.kysely.repository.ts
- modules/queue/src/tech/tech.repository.ts
- modules/queue/src/tech/tech.service.ts
- modules/workforce/src/technicians/commission-security.service.ts
- packages/mobile-sdk/src/faceid.ts
- packages/mobile-sdk/src/native-bootstrap.ts
- packages/permissions/src/rbac.ts

Decisions taken so far:
- vite configs: their env-driven `VITE_API_BASE` target + tailwind plugin, plus OUR package aliases and proxies.
- app.module: both sides + their `PosAccountModule` (its files are still in apps/api/src/pos-account — to move into a module).
- rbac: union of permission keys (their `checkout.manage_overrides` added; our `checkout.approve_refund`, `customers.export` kept).
- customer types: their `avatarUrl`, `CustomerSalonInfo.id` ported into packages/api-contracts; identity's account controller stays ours,
  their avatar upload/delete moved to modules/workforce `StaffAvatarController` (same /auth/avatar routes) — identity must not depend on workforce.
- login screens / mobile-sdk: their `setPendingBioCreds` / `disableNativeFaceId` (already in mobile-sdk) imported from the package; native-bootstrap stays https-only.
- checkout repo: our outbox transaction + their `service_done_at`; rule loader imported from @aipowersalon/workforce.
- service-done: their queue-item + appointment status updates inside our transaction.
- tech.service: our §343 event gating + their customerId argument.
- tech types: their skill-change / manager-message types ported (contracts + module); our `emitsDomainEvents` kept on the port.
Remaining conflicted files: see `git diff --name-only --diff-filter=U` minus the list above (≈75), then the 18 modify/delete, 4 file-location,
31 mis-placed new api files, migration renumbering, full battery.


## Progress — Sep 29 (turn 2)
Resolved and staged: all 18 modify/delete (developer edits ported into the shared packages — Super Admin exemption in the
api-client tenant check + test; `title` option in InlineConfirm; the Face ID / native files were already what mobile-sdk
holds; registerId in the cash-drawer contract; owner.module needs the media-storage provider — handled with the owner
controller conflict); 3 package.json files (their new deps: tailwind, leaflet, lucide-react, react-icons, @capgo biometric,
splash-screen, pngjs; their dev:api script); 5 vite configs (their env-driven proxy + our aliases); 29 marker-free git
line-merges staged as-is (to be verified by build/tests); 8 backend conflicts merged by hand (queue check-in imports at
package paths, queue status update = our transaction+event with their appointment/ticket cascades inside it, membership
enrol = our transaction with their branch default and customer-from-user-id resolution, EarningsPeriod 'custom' and
integrationHealthMix type carried into the contracts).
NOT adopted (fake data): the developer's hard-coded `integrationHealthMix: { healthy: 4, degraded: 1, down: 0 }` — it stays
null until a real integration-state source exists.

Remaining conflicted files (32), all with diff3 markers in the working tree:
- apps/admin-web/src/screens/AiInsightsScreen.tsx
- apps/admin-web/src/screens/SecurityScreen.tsx
- apps/admin-web/src/screens/SystemStatusScreen.tsx
- apps/admin-web/src/screens/TenantsScreen.tsx
- apps/admin-web/src/shell/AdminLayout.tsx
- apps/api/src/main.ts
- apps/customer-web/src/api/customerApi.ts
- apps/customer-web/src/api/customerNailShowcaseApi.ts
- apps/customer-web/src/screens/FindSalonsScreen.tsx
- apps/customer-web/src/screens/ProfileSecurityScreen.tsx
- apps/owner-web/src/api/ownerApi.ts
- apps/owner-web/src/shell/SalonSwitcher.tsx
- apps/pos-web/src/api/posAiApi.ts
- apps/pos-web/src/realtime/realtime-core.ts
- apps/pos-web/src/screens/POSBookingScreen.tsx
- apps/pos-web/src/screens/POSCustomerProfileScreen.tsx
- apps/pos-web/src/screens/POSDevicesScreen.tsx
- apps/tech-web/src/api/techApi.ts
- apps/tech-web/src/screens/MoreScreen.tsx
- modules/checkout/src/cash-drawer/cash-drawer.repository.ts
- modules/checkout/src/cash-drawer/cash-drawer.service.ts
- modules/checkout/src/skip-line-checkout/skip-line-checkout.repository.ts
- modules/queue/src/serving/serving.kysely.repository.ts
- modules/queue/src/tech/tech.kysely.repository.ts
- modules/super-admin/src/super-admin-owners/super-admin-owners.service.ts
- modules/super-admin/src/super-admin-platform/super-admin-platform.repository.ts
- modules/super-admin/src/super-admin-staff/global-tech-admin.service.ts
- modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts
- modules/workforce/src/pos-team/pos-team.service.ts
- modules/workforce/src/tech-profile/tech-profile.service.ts
- modules/workforce/src/time-clock/time-clock.kysely.repository.ts
- packages/api-contracts/src/customer/customer-booking.ts
## ⚠ SECURITY INCIDENT — Sep 29 2026, 13:25 UTC — MERGE HALTED, NOT COMMITTED
- `eslint.config.mjs` in the uploaded developer tree (Power-Salon-main.zip) contains a HIDDEN MALICIOUS PAYLOAD: after the
  last line `);` come thousands of tab characters and then ~32 KB of obfuscated JavaScript beginning `global.i = '…'`
  (a pattern used by known developer-targeting malware campaigns). It runs whenever ESLint loads the config — `npm run
  lint`, the lint gate, or an editor's ESLint extension opening the folder.
- It came from the developer's side (their commit of eslint.config.mjs: +4/−1 vs the 31 Jul base). Our copy never had it.
- It EXECUTED in this sandbox: the lint gate loaded the merged config. Evidence: a hidden `~/.node_modules` with `axios`
  and `socket.io-client` (a remote-control client) appeared at 10:30 UTC. Removed. No such process was running at 13:23.
  This sandbox held no production credentials, but it had open internet access, so assume anything in it was readable.
- The payload is removed from the merge tree (our clean eslint.config.mjs restored). A scan of the whole upload and the
  staged merge found no second copy.
- Unexplained edits appeared in the tree between 11:47 and 12:11 UTC while no turn of mine was running (a staff-session
  guard, POS lock-screen handling, tech/customer app test edits). They look like ordinary code work, but after this
  finding they must be treated as UNTRUSTED until reviewed line by line in a clean environment.
- Outputs in /mnt/user-data/outputs (bundle and handoff zip, 08:22 UTC) were produced BEFORE the payload ran; no merged
  code has been written to outputs.

### What must happen before this merge continues
1. Kevin: tell the developer immediately — their machine and GitHub account are likely compromised (this is how these
   campaigns spread). They must not run npm/eslint on that repo, must clean their machine, rotate all credentials, and
   check the GitHub repo history for who added the payload.
2. Anyone who ran `npm install` / `npm run lint` / opened the repo in VS Code with ESLint on the developer's tree: treat that
   computer as compromised — rotate GitHub, AWS/Railway, database, Fiserv/CardPointe, Twilio, OpenAI, email and any crypto
   wallet credentials, from a different, clean device.
3. Restart the merge from the upload in a FRESH environment, with the payload stripped first and nothing executed before
   a full scan; re-review the 11:47–12:11 edits line by line.


## Resolution — Sep 29 2026, 14:00 UTC — MERGE COMMITTED as the merge commit after `790b1c4`
- Environment checked after the incident: no new scripts, cron jobs, profile or binary changes outside the repo; the
  stage-2 folder deleted; every dependency reinstalled from the registry with lockfile integrity checks and no install
  scripts; running the lint gate afterwards does not recreate the folder.
- The 11:47–12:11 edits reviewed line by line: a restrictive staff-only guard for the four self-service routes, the POS lock
  screen sending users to full sign-in on `pin_not_set` / too many attempts, a correct fix to the clock-in status write
  (the ON CONFLICT it replaced had no unique key and would have aborted the clock-in transaction), and test/loading-state
  updates in the tech and customer apps. All benign and correct.
- Verified before committing: 25 gates, security lane 22/0, architecture, 6 API shards (1,582), migrations 1–481 on real
  Postgres 16 (fresh and upgrade), final payload-pattern scan of all 1,096 staged files.
- Open: 94 app tests fail exactly as they do on the developer's tree as uploaded (customer 24, owner 7, POS 22, Super Admin
  41) — their screen redesigns shipped without test updates. Next work: update those tests to the redesigned screens.
- Still required outside this repo: the developer must treat their machine and GitHub account as compromised.
