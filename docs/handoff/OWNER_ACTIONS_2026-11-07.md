# Owner actions — what only Kevin (or a real device) can do, made as short as possible (Nov 7 2026)

Everything code-side is finished and verified. These steps need a person, a device or a provider. Each one below is
already prepared so it takes minutes, not a session.

## 1. Vietnamese DRAFT review — 166 strings

Open `docs/handoff/VI_DRAFT_REVIEW.md` (one table: # · key · English · Vietnamese · screen). Reply in chat with:

- `approve all`, or `approve 1-40, 52`, or `row 7: <your Vietnamese>`.

Claude applies it with `node tooling/i18n/vi-drafts.mjs --set <row> '<text>'` (corrections first) then
`--approve <rows|all>`, rebuilds the sheet, runs the gates and commits. Nothing else in the files changes.
The gate `vi draft review sheet` keeps the sheet current whenever new DRAFT text is added.

## 2. SUNMI FLEX 3 — what the real device reports (5 minutes)

The POS already measures the device it runs on.

1. On the SUNMI, open the POS in its normal browser (and again in kiosk / installed-app mode if you use it).
2. Sign in as owner or manager → profile menu (top right) → **Check this screen**.
3. Tap **Copy report** and paste it into chat (it holds sizes and module ids only — no customer, card or phone data).

The report has `innerW × innerH` (the CSS viewport), `vvW × vvH`, `dpr`, `screenW × screenH`, display mode and touch.
Claude then runs the full screen check at exactly that size:
`VIEWPORTS=<innerW>x<innerH> MODULE_SET=all node tooling/e2e/pos-vi-one-screen.mjs` and fixes anything that fails.
Already certified: 1920×945, 1920×952, 1920×1032 (330/330) and 1536×864 · 1440×900 · 1366×768 · 1280×720.
If the device reports DPR 1.5 (≈1280×720 CSS), that size is already covered.

## 3. Staging tests with real providers — needs your "go" per item

Staging only, never production. Set the secrets in the staging host's environment (names only here):

| Test | Env vars | Where in the POS | Pass = |
|---|---|---|---|
| Twilio account + Verify | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, Verify Service SID saved in Messaging Setup | Phone & Messaging → **Run health check**; Booking Phone Verification → **Check Verification System** | six checks show real states, no false green |
| Test SMS (one, to your own phone) | + `TWILIO_FROM` or the salon's assigned number | Messaging Setup → step **Send a test SMS** → **Send test** | delivered status arrives in Delivery history |
| Test email (one, to your own inbox) | `SENDGRID_API_KEY`, `SENDGRID_FROM` | Email Center → **Send a test email** → **Send test** | Delivered event in the email timeline |
| Token purchase (UAT money only) | flags `global_loyalty_engine_enabled` + `tenant_token_purchases_enabled` ON for ONE staging salon (Super Admin) | Loyalty → Rewards Network → **Buy Tokens** | purchase goes REQUESTED → settled; a retry does not double-charge |

Say e.g. "go SMS + email" and Claude walks it with you, records the evidence (ids and statuses only) and fixes any failure.
Card payments stay off until item 4.

## 4. Live payments — waiting on Fiserv and Apple

Send `docs/integrations/fiserv-uat/REQUESTS-ryan-and-apple.md` §1 to Ryan (Fiserv) and §2 to Apple (Tap to Pay
entitlement). When answers arrive, paste them; then `npm run uat:cardpointe` runs on UAT only and produces the
certification evidence. Production MID/keys go through Fiserv's secure channel only — never in chat.

## 5. Real-phone tests and two small decisions

| Item | What to do | Claude's recommendation |
|---|---|---|
| Android upgrade | Install the old build, sign in, install the new build over it | Expect one re-sign-in (http → https origin); mention in release notes |
| Face ID re-setup | On an iPhone: sign in with password once, turn Face ID on, sign out/in; then "sign out other devices" from a 2nd phone | Expect Face ID to end only on the other phone |
| Native API address | Default fallback is `https://app.aipowersalon.com:3000` when `VITE_API_BASE` is unset | Set `VITE_API_BASE` explicitly in every native release build (no port guessing) |
| Find Salons "Call" button | The redesign dropped it | Restore it — customers expect to call a salon before booking |

Reply "yes" to the recommendations (or change any) and Claude builds them.

## 6. Push

Local commits are ready. Say **push** and Claude pushes the branch.
