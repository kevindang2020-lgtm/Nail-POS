# Runbook — Clover terminal offline / not answering

**Symptom**: POS Devices → Payment Terminals shows **Offline** / **Not heard from recently** / **Not tested yet**; charges
return `TERMINAL_OFFLINE` ("The payment terminal is not responding…"); the customer display stays on "processing".

**Diagnosis ladder (salon staff, then support)**
1. Device: powered on, idle screen visible, Wi-Fi/Ethernet connected? Reboot the Clover (hold power → Reboot).
2. POS → Devices → Payment Terminals → **Test connection** (a Bolt `connect` + `ping` for the HSN, no charge):
   * *"the terminal answered the ping"* → it is back; status Online.
   * *"did not answer — check that it is powered on, online and registered"* → Bolt knows the MID but the device has no
     request queue: still booting, offline, or **registered to a different MID** (Fiserv order id) — compare the HSN on
     the device sticker with the registry row (Rename → serial / HSN).
   * *"TERMINAL_NOT_CONFIGURED"* → the branch's merchant has no Bolt base/key: Super Admin → Configure Gateway (or the
     Branch merchant account) → Terminal API base + Authorization key.
   * *"MERCHANT_SUSPENDED"* → the merchant account is paused/disabled (Super Admin) — intended; resume there.
   * *"could not be opened"* → the sealed Bolt key cannot be decrypted (key ring changed?) — Super Admin re-enters the key.
3. Status **Taking a payment** (PROCESSING) that never clears: a lease is held — it expires on its own (485); if a charge
   is stranded see payment-status-unknown.md.
4. Support (no secrets): Super Admin → tenant → Devices (terminal count, last transaction), provider health for
   `cardpointe` (a Bolt-wide incident shows there), webhook events.

**Workarounds while offline**: take cash / gift card; a second paired terminal at the branch (or the register's
assignment changed to it under Devices → the terminal's register); the Owner & Manager Pay app (Tap to Pay) if enabled.

**Never**: re-run a card "to see if it works" while a previous attempt is being verified; delete the terminal (disable
it instead — history keeps its device).
