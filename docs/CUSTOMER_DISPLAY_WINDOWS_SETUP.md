# Customer display on a Windows POS — setup (Dual-Screen mandate §2, §16, §87–§88)

One POS computer, two screens, one backend. **Display 1** (the large monitor) is the employee POS. **Display 2** (the
portable customer monitor, to the right) shows only the customer display: check-in, the salon's advertising, the
customer's checkout ticket, tip, payment status, receipt and thank-you. The two windows share nothing in the browser —
both talk to the AI PowerSalon backend, which is the only authority.

## 1. Windows: Extend, never Duplicate
1. Connect the portable monitor (USB-C or HDMI).
2. **Settings → System → Display**. In the multiple-displays list choose **Extend these displays**.
   (Shortcut: **Windows + P → Extend**.) Never *Duplicate these displays* — the customer would see the POS.
3. Click **Identify**. Drag the boxes so **2** sits to the **right** of **1**, top edges level.
4. Select display **1** and tick **Make this my main display**. The taskbar, the POS and every pop-up stay there.
5. Scale and resolution: any reasonable landscape resolution works (1920×1080, 1600×900, 1366×768, 1280×800 are
   measured in the layout proof, `tooling/e2e/customer-display-layout.mjs`); the display lays itself out from the window
   size, not from inches. Use Windows' **Recommended** scale on each monitor.
6. **Touch**: a touch monitor on an extended desktop must be told which screen it is. **Control Panel → Hardware and
   Sound → Tablet PC Settings → Setup… → Touch input**, then touch the customer monitor when Windows asks. (Without this,
   a tap on the customer monitor lands on the POS.)
7. **Taskbar**: Settings → Personalization → Taskbar → Taskbar behaviours → untick **Show my taskbar on all displays**.
8. **Never sleep**: Settings → System → Power → Screen and sleep → *Never* while plugged in. Turn on **Do not disturb**
   (Settings → System → Notifications) so no Windows notification appears over the customer's screen.

## 2. Open the customer display on Display 2 (kiosk)
The display's address is the one your POS was built with for **Open on second screen** (`VITE_CUSTOMER_DISPLAY_URL`,
e.g. `https://pos.yoursalon.com/customer-display/`). Two ways to put it on the customer monitor:

**A. The launcher (recommended for the salon's POS computer).** `apps/customer-display/kiosk/`:
```
launch-customer-display.cmd https://pos.yoursalon.com/customer-display/
```
It refuses to start in Duplicate mode, finds the non-main monitor, and opens Chrome (or Edge) in **kiosk mode** there —
no address bar, no tabs, no taskbar, no developer tools — with **its own browser profile** (no employee bookmarks,
logins, extensions or POS session in that window). To start it with Windows: set the environment variable
`APS_CUSTOMER_DISPLAY_URL` once, then press **Windows + R**, type `shell:startup`, and put a shortcut to
`launch-customer-display.cmd` there. Options: `-Display 2` (choose the monitor), `-Browser edge`, `-DryRun` (print the
command). To leave kiosk mode: **Alt + F4** on the customer monitor.

**B. From the POS.** Checkout → Customer Display card → **Open on second screen**. Chrome / Edge ask once for
permission to place windows on other screens (Window Management); allow it and the display opens on the customer
monitor. Other browsers open a window to drag there. Tap **Full screen** on it once; it returns to full screen after a
reload on the first touch.

## 3. Pair it (once)
The display shows an 8-digit code. On the POS: **Devices → Customer Displays → + Pair a display**, type the code, name
it (e.g. *Front Display #1*) and choose its register (*Front POS 1*). Checkout then uses that display with no selection
(a dedicated display); a display with no register is shared by the branch, one customer at a time (DISPLAY_BUSY).
No owner, manager or Super Admin login is ever entered on the customer display — it holds only its own device
credential, which reaches only the customer-display API.

## 4. Settings the owner controls
POS **Devices → Customer Displays → Customer display settings**: appointment and walk-in check-in, new guests, service
and technician choice, the estimated wait, and **languages** (English, Tiếng Việt — the default first; a guest can
switch for their own visit). Advertising on/off and the ad duration: **Marketing & Growth → Customer Display Advertising
→ Settings**. The salon's logo: **Receipts & Branding**.

## 5. If something goes wrong
| Symptom | What to do |
|---|---|
| The customer sees the POS | Windows is in Duplicate mode — Windows + P → Extend (section 1). |
| Taps on the customer monitor click the POS | Touch is mapped to the wrong screen — section 1, step 6. |
| The POS card says **● Offline** | Check the monitor's cable/power; press **Reconnect** on the card. Checkout, payment, booking and the queue carry on on the POS — the display is never needed to take a payment. |
| The display shows *“We’re temporarily offline. Please see the receptionist.”* | The display cannot reach the server; check-in waits for it (no offline check-in), the cached ads keep playing, a checkout already on screen stays. It reconnects by itself. |
| The display shows a pairing code again | It was revoked or its browser profile was cleared — pair it again (section 3). |
| The display opened on the wrong monitor | Run the launcher with `-Display 2` (or the number Windows' Identify shows). |
