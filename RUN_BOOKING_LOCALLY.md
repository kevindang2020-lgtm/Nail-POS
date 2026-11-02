# Testing the REAL Booking module locally (frontend → API → Postgres)

The HTML preview is only for eyeballing layout/interaction. To test the actual Booking module — with live
open-gap recalculation, server-validated drag, blocked-time writes, tenant isolation, and audit — run the real
React app (`apps/pos-web`) against the NestJS API (`apps/api`) and a Postgres 16 database. Nothing here fabricates
data; every number comes from the database.

## Prerequisites
- Node 20+ (tested on 22), npm
- Postgres 16 — either Docker Desktop, or a local Postgres you control

## 1. Install
```sh
cd <the unzipped repo root>
npm install
```

## 2. Database + seed
If you have Docker, the repo's helper brings up Postgres, migrates, and seeds in one step:
```sh
bash scripts/local/setup.sh
```
Or, against your own Postgres 16:
```sh
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/aipowersalon
node apps/api/scripts/migrate.mjs      # applies all migrations, transactional + idempotent
npm run db:seed && npm run db:seed:demo # PILOT01 tenant + demo appointments/technicians/schedules
```

## 3. Run the API + web apps
```sh
bash scripts/local/dev.sh
```
This starts the API on **:3000** and the front-ends: **POS :5173**, Super Admin :5174, Technician :5175,
Customer :5176. Ctrl-C stops all.

If you only want POS + API:
```sh
# terminal 1
cd apps/api && npm run start:dev        # API on :3000
# terminal 2
cd apps/pos-web && npm run dev           # POS on :5173 (proxies /pos/* to the API)
```

## 4. Open the Booking screen
Go to **http://localhost:5173** and sign in as the owner:
- Salon code `PILOT01` · `owner@pilotsalon.com` · `ChangeMe!Owner1`

Then open **Booking** in the sidebar.

## What to test (the two fixes from this session)
**View All Techs — KPI cards gone.** Click **View All Techs ⤢**. The KPI cards (Appointments Today, Booked Revenue,
Walk-ins, No-Shows, Open Slots, Tech Utilization) are removed from the layout entirely — no empty band — and the
technician calendar fills the viewport. Date controls, technician search, status/source filters, Working Today, the
Booking Assistant toggle, and Close all remain. Press **Escape** or **✕ Close** to return; your date, filters, and
scroll position are preserved.

**Live open-gap recalculation.** Drag an appointment to a new time or another technician. On drop:
- the moved card repositions,
- the **Open Today** chips and the **N min open** gap labels recalculate immediately for **both** the source and
  destination technician (source gains the vacated time; destination's range shrinks/splits),
- the change is saved through `POST /pos/booking/appointments/:id/reschedule` and reconciled from
  `GET /pos/booking/day-grid`,
- if the server rejects it (overlap, off-schedule, blocked time, permission, or a concurrent edit), the appointment
  **and** the gap labels roll back together and the exact reason is shown.

Also try the single-technician full screen (click a technician's avatar/name) → **Block time** to add/remove a
blocked window and watch the open ranges update.

## 5. Verify the automated checks (optional)
```sh
cd apps/pos-web && npx tsc --noEmit -p . && npx vitest run   # 222 tests
cd ../api        && npx tsc --noEmit -p . && npx vitest run   # booking suite included
```

## Notes / honest limits
- With no SMS/email provider configured, reschedule/cancel notifications are honestly audited as `not_configured`
  rather than pretending to send.
- Live card-processor round-trips need real CardPointe/Clover MIDs; unrelated to Booking.
- Week view is not built — the calendar is a day view (the reference's primary mode).
