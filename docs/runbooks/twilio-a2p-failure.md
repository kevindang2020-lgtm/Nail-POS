# Runbook — A2P 10DLC registration failed / rejected / stuck

**Symptom**: POS Settings → Notifications shows Brand or Campaign **REJECTED** / **FAILED**, or `TWILIO_A2P_NOT_READY`
on sends; Super Admin → tenant → A2P shows `brand_status` / `campaign_status` not VERIFIED after days.

**Steps**
1. Super Admin → tenant → A2P → **Refresh** (pulls the current statuses from Twilio). Read `last_error`.
2. Secondary customer profile `twilio-rejected` → the business information is wrong/mismatched (legal name vs EIN,
   address, website). Owner fixes Business Information in POS Settings → Notifications → A2P; Super Admin → **Provision
   profile** again.
3. Brand FAILED → EIN/legal name mismatch or a sole proprietor needing the sole-prop path; see
   `A2P_10DLC_REGISTRATION_KIT.md` for the data Twilio/TCR checks. Resubmit (**Submit brand**).
4. Campaign FAILED/REJECTED → use case, sample messages, opt-in description or the STOP/HELP language. Our samples carry
   "Reply STOP to opt out"; make sure the website shows the consent language and privacy/terms URLs resolve. Resubmit.
5. Number not attached → **Attach number** (the salon's registered number) after the campaign is created.
6. Until VERIFIED the salon's sender stays its plain number (carrier filtering risk) or, if the platform policy says so,
   SMS stays "Messaging setup required" — no fake ACTIVE (§73).

Carrier review time is external (BLOCKED_EXTERNAL). Every status change is audited (`a2p.*`); nothing here needs the
Twilio auth token.
