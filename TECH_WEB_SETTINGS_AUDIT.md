# tech-web hardening — SettingsScreen (verified clean)

Audited technician settings: a read-only view of the salon's capability set, change-password, and sign out. Two wiring
contracts to verify (the cap keys and the password payload) — both line up.

## Verified clean
- **The 7 capability keys match the backend exactly.** The screen renders On/Off for `liveEditEnabled`,
  `allowServiceEditDuringServing`, `techCanAddService`, `techCanChangeService`, `techCanRemoveLine`,
  `requireApprovalForChangeService`, `requireApprovalForRemoveLine`. `techApi.settings()` → `/tech/settings` →
  `techWorkflowSettings()` returns precisely those seven keys (serving.service.ts 216–224). A mismatch here would have silently
  shown a capability as "Off" — but the names are identical, so each row reflects the real salon setting. (Correctly read-only:
  these are governed by POS settings + Super Admin, not editable by the tech.)
- **Change-password posts the exact shape the server validates.** The form sends `{ currentPassword, newPassword,
  confirmPassword }` to `/auth/change-password`, matching the backend `ChangePasswordInput` (account-core.ts 25). The button is
  gated client-side on non-empty current/new and `new === confirm`; on success it clears the fields and confirms; failures
  surface the server message.

No bug. **5 tests** added: caps rendering (4 On / 3 Off + labels); the password-match gate (mismatch stays disabled, match
enables); a successful change posting the right payload and clearing the inputs; the failure path; and sign out.

## Verification
tech-web `tsc` clean, **68 tests pass** (13 files), `vite build` clean. (admin-web 151, pos-web 75, owner-web 69,
customer-web 113, backend 603 / PASS — all unchanged; read-only caps + existing auth endpoint, only new tests added.)

## Sweep status
**10 fixes** to date (admin-web 6, owner-web 3, pos-web 1, tech-web 1). tech-web now covers earnings, queue, profile, ticket
detail, follow-ups, notifications, and settings. Remaining tech-web: Schedule, More, Login, TechFollowUps actions, and static
legal/delete screens.
