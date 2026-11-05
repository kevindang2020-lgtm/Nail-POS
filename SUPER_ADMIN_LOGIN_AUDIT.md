# Super Admin → Login — audit, fixes & coverage

Page: `apps/admin-web/src/screens/LoginScreen.tsx`. Posts to POST /auth/login (portal 'super-admin'); SUPER_ADMIN requires
MFA, so the flow is email+password → MFA_REQUIRED → 6-digit code → SUCCESS. Previously had no test; now covered.

## Wiring verified (correct)
- `authApi.login` ↔ POST /auth/login; the client returns 200-body outcomes (SUCCESS / MFA_REQUIRED / BRANCH_SELECTION_REQUIRED)
  and throws on 401/403 carrying the server message (caught and shown). On SUCCESS the principal is stored via AuthContext;
  the session itself is a cookie (`credentials: include`), so no token sits in JS. Password field is masked with
  `autoComplete="current-password"`; nothing is logged or placed in a URL.

## Two real UX/correctness fixes
1. **Empty MFA code could be submitted.** The verify button only required email+password, so a user could click
   "Verify & sign in" with a blank code (a pointless round-trip the backend bounces). Now disabled until a code is entered:
   `disabled = … || (mfaNeeded && !mfaCode)`.
2. **A wrong MFA code showed the first-prompt message.** The backend's decision function only sees a boolean `mfaSatisfied`,
   so it returns `MFA_REQUIRED` for both "no code yet" and "wrong code" with the same message — but the *screen* knows
   which it is (whether it was already prompting). It now shows "That code wasn't valid — please try again." on a re-prompt
   instead of repeating "Enter your 6-digit verification code…", so a bad code gives correct feedback.

(Noted, not changed: `BRANCH_SELECTION_REQUIRED` isn't special-cased, but a SUPER_ADMIN has no branches, so that outcome
doesn't occur on this portal; it would fall through to the server message.)

## Tests added (5, all pass)
`LoginScreen.test.tsx`: Sign in disabled until email+password; SUCCESS stores the principal with the exact request body;
the MFA flow prompts, **blocks an empty code**, then verifies with `mfaCode` included and stores the principal; a rejected
code shows the **"wasn't valid"** message and does not sign in; a thrown credential error is surfaced.

## Verification
admin-web `tsc` clean, **147 tests pass** (29 files), `vite build` clean. No backend change; backend remains 603 / PASS.

## Series status
Every active Super Admin dashboard page **plus the login screen** now has a dedicated test. The only remaining untested
screen is `ProjectStatusScreen` (an internal status page); the dead/unrouted `LeadsScreen` is already exercised by
`ApplicationsLeads.test.tsx`. Across the series: 6 real fixes (Applications pagination cap, Users & Roles pagination cap +
label, Usage Limits null→0 backend coercion, Billing status dropdown mis-render, Payment Gateways defensive null guard,
Login MFA UX) plus regression-locked money-path and audit-trail screens; admin-web ~96 → 147 tests; backend steady at 603.
