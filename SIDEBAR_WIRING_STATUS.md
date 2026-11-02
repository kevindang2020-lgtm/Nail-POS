# AIPowerSalon — Sidebar wiring status (tenant sidebar, 2026-07-06)

## Summary
- **157** sidebar items across **12** sections.
- **55** wired to real, dedicated screens (data-fetching, real endpoints).
- **102** resolve to the shared `FeaturePage` — a permission/availability-gated placeholder that
  shows the feature name and correct state (403 / feature-unavailable / AI-required / coming-soon).

## No wiring bugs
- Every one of the 157 items resolves — **none is a dead link or blank 404**.
- All 47 built screen components are routed in App.tsx and reachable from their sidebar item.
- No orphaned screen (a built screen not connected to the sidebar) was found.

So "wiring the rest" is **not bug-fixing** — it is **building 102 new features**, each needing a
backend slice (controller/service/repo/migration) and/or a dedicated frontend screen + tests.
A related backend controller existing for a module does NOT mean the screen exists — it doesn't.

## The 12 sections (real screen counts)
The 55 wired screens cover the operational core: Overview, Dashboard, Check-In, Queue, Serving,
Service Done, Checkout, Cash Drawer/Handoffs, Booking, Tech Queue, Tech Appointments, Technicians
(+ schedule, skill requests), Services, Customers (directory), Payments Overview, AI Command Center,
AI Reception Copilot, AI Receptionist (+ front-desk, follow-ups), Messaging Setup, Inventory,
Account (overview, security, users-roles), Settings, and more.

## The 102 placeholders — a build roadmap (by section)
- Account (3): billing, invoices, usage-limits
- Customers (7): profiles, notes, loyalty, gift-cards, saved-cards, appointment-history, retention
- Team (6): profiles, performance, commission, tips, time-clock, permissions
- Services (5): categories, pricing, add-ons, packages, discounts
- Payments (9): transactions, refunds-voids, tips, gift-cards, invoices, expenses, settlements, split-payments, terminals
- Reports (13): sales, services, technicians, customers, appointments, payments, commission, payroll, tax, inventory, marketing, ai, multi-location
- Inventory (2) + Products (1): alerts, purchase-orders, products
- Communications (6): reminders, templates, email, phone, notifications, ai-receptionist
- Marketing (12): promotions, coupons, referrals, birthdays, win-back, segments, email, sms, social, reviews, +
- Management (14): business-hours, salon-profile, booking-rules, checkout-rules, queue-rules, no-show-policy, cancellation-policy, tax-tip-rules, loyalty-rules, membership-rules, features, auto-logout, +
- Integrations (5): payment-gateway, sms, email, phone, apps
- Devices (7): tablets, payment-terminals, receipt-devices, check-in-kiosk, reception-pos, assignments, health
- AI Center (18): analytics, booking, business, checkout-upsell, customer-insights, fraud-protection, inventory, marketing, queue, receipt-scanner, reviews, scheduling, usage, voice-transcription, +

## Recommended build order (highest operational value first)
1. Reports (sales, services, technicians, payments) — owners need these daily; ticket_service_lines
   + payments data already exists (and its revenue bugs were just fixed).
2. Payments (transactions, refunds-voids, tips) — money visibility; checkout/payments data exists.
3. Team (performance, commission, tips) — payroll-adjacent; pos-team data exists.
4. Services (categories, pricing, packages) — catalog management; services data exists.
5. Management (business-hours, salon-profile, rules) — configuration surfaces.

Each is a real feature slice. I can build them one section at a time, fully wired to real
endpoints and tested — same standard as the 55 already done.
