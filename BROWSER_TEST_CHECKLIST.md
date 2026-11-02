# Browser Test Checklist — AIPowerSalon

Manual click-through to confirm the platform works locally. Prereq: `npm run setup:local` then `npm run dev:all` running
(see LOCAL_BROWSER_TESTING_GUIDE.md). Salon code for all tenant logins: **`LUXE`**.

## A. Sign in

- [ ] Open POS http://localhost:5173 → sign in: `LUXE` / `frontdesk@luxenails.test` / `FrontDesk123!` → POS shell loads
- [ ] Open Super Admin http://localhost:5174 → `admin@aipowersalon.test` / `Admin123!` / any 6-digit code → console loads
- [ ] Open Owner http://localhost:5177 → `LUXE` / `owner@luxenails.test` / `Owner123!`
- [ ] Open Tech http://localhost:5175 → `LUXE` / `tech@luxenails.test` / `Tech123!`
- [ ] Open Customer http://localhost:5176 → `LUXE` / `customer@test.com` / `Customer123!`

## B. POS — click every sidebar item (5173)

For each: route opens, data loads, no console errors, buttons/modals/search/filters respond.

- [ ] Overview — KPIs render (revenue, waiting, serving, etc.)
- [ ] Dashboard
- [ ] Check-In
- [ ] Booking
- [ ] Tech Appointments
- [ ] Live Technician Schedule
- [ ] Tech Queue
- [ ] Queue
- [ ] Serving
- [ ] Service Done
- [ ] Checkout (ticket list + totals)
- [ ] Customers (search + open a customer)
- [ ] Technicians
- [ ] Services
- [ ] Reports
- [ ] Settings

## C. Full workflow (POS + Tech + Customer Display)

- [ ] POS → Check-In a walk-in customer
- [ ] Send to Queue
- [ ] Assign a technician
- [ ] Tech app (5175) → accept the ticket
- [ ] Tech → Start service
- [ ] Tech → add/change a service on the live ticket; add a note
- [ ] Tech → Mark service done
- [ ] POS → ticket appears in Checkout
- [ ] POS → open Checkout, add a tip
- [ ] Customer Display (5180) → pair to the POS station; it shows the ticket + total + tip
- [ ] POS → take a **cash** payment (or mark paid); card needs a Fiserv MID
- [ ] POS → send a receipt
- [ ] Customer Display follows to receipt/idle
- [ ] POS → Reports reflect the sale
- [ ] Tech → Earnings reflect the completed service

## D. Super Admin (5174)

- [ ] Overview
- [ ] Tenants → list shows Luxe Nails
- [ ] Tenant detail → opens Luxe Nails
- [ ] Tenant Applications
- [ ] Hardware Packages
- [ ] Payment Gateways
- [ ] Subscriptions
- [ ] System Health
- [ ] Audit Logs
- [ ] Settings
- [ ] Confirm Super Admin login does NOT work on the POS staff login (separate surfaces)

## E. Owner (5177) & Customer (5176)

- [ ] Owner: Dashboard, Branch Performance, Booking Overview, Staff Performance, Finance/Reports, Alerts/More
- [ ] Customer: Home, Find Salons (partner/seeded salons if no Google key), Book Appointment, My Appointments, Active
      Visit, Receipts, Profile

## F. Layout / fit

- [ ] POS fits a 24-inch iMac in Safari/Chrome at 100% zoom — no important content cut off, no horizontal scroll
- [ ] Large tables scroll internally (page doesn't push the bottom bar off-screen)
- [ ] Check on a MacBook and iPad-width for Super Admin

## Notes
Card capture, Google Places salon search, and real TOTP are environment inputs (see REMAINING_BLOCKERS.md). Everything
else should be fully clickable on seeded data.
