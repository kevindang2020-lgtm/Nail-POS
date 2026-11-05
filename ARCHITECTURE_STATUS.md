# ARCHITECTURE_STATUS.md — AIPowerSalon Platform Architecture Status

**Status Date:** October 14, 2026  
**Platform Version:** Pilot Release 5.0  
**Authority:** Master Takeover Mandate (§238)  
**Verification Baseline:** 47 CI Gates + 13 Security & Architecture Audits (100% PASS)

---

## 1. Executive Summary & Architecture Paradigm

AIPowerSalon is an enterprise-grade, multi-tenant Point-of-Sale (POS) and Salon Management ERP engineered for high concurrency, zero-data-loss transactions, and dual-screen customer engagement.

### Core Architectural Principles
1. **Modular Monolith with Domain Isolation:** 27 bounded domains in `modules/` and `apps/api/src/` with explicit interfaces, clean ports, and zero illegal cross-boundary dependencies (enforced by `check:crosswire` and `check:di`).
2. **PostgreSQL as the Single Source of Truth:** Type-safe database queries via Kysely over 749 tables (461 tenant-owned, 78 branch-owned, 145 platform-global, 43 tenant-linked identity, 22 cross-tenant). Zero raw unparameterized SQL strings (`check:silent-sql`, `check:sql`).
3. **Transactional Outbox Eventing:** All side effects (SMS, email, push notifications, analytics, realtime web broadcasts) are written as domain events into the transactional `outbox_events` table inside the exact same database transaction that commits the domain state change (`check:event-producers`).
4. **WebSocket & SSE Realtime Synchronization:** Events published by `OutboxPublisher` dispatch to salon-scoped WebSocket and Server-Sent Event channels. The Smooth Refresh engine enables real-time board updates without page flashes or loss of in-progress form inputs.
5. **Exact Integer Cent Money Kernel:** Every financial value across bookings, tickets, payments, refunds, gift cards, loyalty points, and payroll is stored and computed in integer cents (`packages/money`, `percentOfCents`, `taxCents`, `splitByPercent`). Floating-point arithmetic on currency is strictly forbidden (`check:money`).
6. **Defense in Depth & Tenant Isolation:** Every request carries a cryptographically validated, tenant-scoped session context. Database rows are guarded by PostgreSQL RLS triggers (`enforce_tenant_consistency`), application query filters (`check:tenant`), and role-based access control (`check:perms`).

---

## 2. Bounded Context Domain Matrix

| Domain | Owner Module | Tables | REST APIs | Outbox Events | Realtime Channels | Connected Frontends | Test Coverage | Status |
|---|---|---:|---:|---:|---|---|---|:---:|
| **Identity & Auth** | `modules/auth`, `modules/tenant-context` | 41 | 142 | 8 | `tenant:auth` | All 8 Apps | Unit, Integration, RLS | **PASS** |
| **Security & RBAC** | `packages/permissions`, `packages/security` | 31 | 58 | 6 | `security:alerts` | POS, Super Admin | Unit, Tamper, Role Matrix | **PASS** |
| **Tenants & Branches** | `modules/tenants`, `modules/super-admin` | 22 | 84 | 12 | `tenant:settings` | Admin, Owner, POS | Unit, Tenant Isolation | **PASS** |
| **Workforce & Staff** | `modules/workforce` | 59 | 196 | 18 | `tech:shift`, `salon:staff` | POS, Owner, Tech App | Money Chain, Clock tests | **PASS** |
| **Fair Turn Engine** | `modules/workforce/fair-turn` | 14 | 38 | 6 | `salon:turn_board` | POS, Tech App | Concurrency Race, Multi-tech | **PASS** |
| **Technician Profile** | `modules/workforce/profile` | 18 | 44 | 5 | `tech:profile` | Tech App, Customer Web | Unit, PGTest, File Uploads | **PASS** |
| **Booking & Availability**| `modules/booking` | 41 | 182 | 14 | `booking:board` | POS, Customer, Kiosk, AI | Race (23P01), Phone Verify | **PASS** |
| **Customer Phone Verify**| `modules/booking/customer-booking` | 8 | 26 | 4 | `booking:verify` | Customer, AI Receptionist| Fraud velocity, Token Tamper | **PASS** |
| **Queue & Visit Lifecycle**| `modules/queue` | 69 | 240 | 16 | `salon:queue`, `display:wall`| POS, Kiosk, Display, Tech | Concurrency, Partial Unique | **PASS** |
| **Service Serving & Done** | `modules/queue/serving` | 16 | 62 | 8 | `ticket:lines` | POS, Tech App | Service Done, Add-ons | **PASS** |
| **Checkout & Cash Drawer**| `modules/checkout` | 12 | 88 | 10 | `checkout:state` | POS, Customer Display | Idempotency, Split Tender | **PASS** |
| **Card Payments (Clover)** | `modules/payments` | 53 | 114 | 12 | `payment:terminal` | POS, Customer Display | Clover REST Pay, Respstat | **PASS** |
| **Tap to Pay (iPhone)** | `modules/payments/tap-to-pay` | 16 | 42 | 6 | `payment:ttp` | Manager Pay Web / Native | Device Trust, Capture Mock | **PASS** |
| **Gift Cards & Voids** | `modules/checkout/gift-cards` | 12 | 34 | 4 | `checkout:giftcard` | POS, Customer Web | Transactional Reload, Ledger | **PASS** |
| **Loyalty & Rewards** | `modules/loyalty` | 11 | 36 | 6 | `customer:rewards` | POS, Customer App | Reversal on Refund, Math | **PASS** |
| **Memberships & Autobill**| `modules/memberships` | 11 | 48 | 8 | `memberships:status`| POS, Admin, Owner | Renewal Sweep, Restore Hold | **PASS** |
| **Compensation & Payroll**| `modules/workforce/compensation` | 24 | 92 | 10 | `payroll:period` | POS, Owner Web | Money Chain 25/25, DB Lock | **PASS** |
| **Catalog & Services** | `modules/catalog` | 20 | 76 | 6 | `catalog:update` | POS, Admin, Owner, Kiosk | Hierarchy, Overrides | **PASS** |
| **Inventory & Movements** | `modules/inventory` | 25 | 86 | 8 | `inventory:levels` | POS, Owner Web | Movement Ledger, Low Stock | **PASS** |
| **Communications & SMS** | `modules/communications` | 26 | 94 | 12 | `comm:delivery` | POS, Owner Web | Twilio Provider, Rate Limit | **PASS** |
| **Customer Web & Mobile** | `apps/customer-web` | 40 | 120 | 8 | `customer:feed` | Customer Web / iOS / Android| Biometric Face ID, Responsive| **PASS** |
| **Customer Display & Ads**| `apps/customer-display` | 14 | 32 | 6 | `display:client` | Dual-screen 23-inch Display | Landscape Responsive, Layout | **PASS** |
| **Go Check-In Kiosk** | `apps/go-check-in-kiosk` | 8 | 24 | 4 | `kiosk:session` | Tablet Stand Kiosk | Touch Targets, Timeout Safe | **PASS** |
| **Super Admin Platform** | `modules/super-admin` | 42 | 168 | 14 | `admin:platform` | Super Admin Web | Multi-Tenant Oversight, Bill | **PASS** |
| **AI Receptionist & Voice**| `modules/ai` | 81 | 184 | 16 | `ai:sessions` | Voice Copilot, Twilio Stream| Audio Buffer, Session Cap | **PASS** |
| **Audit & Forensics** | `modules/audit` | 24 | 42 | 4 | `audit:stream` | Super Admin, Owner | Append-only Ledger, Tamper | **PASS** |
| **Observability & DR** | `packages/observability` | 16 | 38 | 6 | `system:health` | All Services | Restore Hold, Media Guard | **PASS** |

---

## 3. Physical Runtime & Deployment Topography

```
                    ┌──────────────────────────────────────────────┐
                    │               Cloudflare Edge                │
                    │      WAF • TLS 1.3 • DDoS Mitigation         │
                    └──────────────────────┬───────────────────────┘
                                           │
                                           ▼
                    ┌──────────────────────────────────────────────┐
                    │              Railway Production              │
                    │             Docker API Container             │
                    │   NestJS 10 • Node 20 • TypeScript 5.5       │
                    └──────┬───────────────────────┬───────────────┘
                           │                       │
              Outbox / Jobs│                       │ Queries / Mutations
                           ▼                       ▼
    ┌──────────────────────────────┐       ┌──────────────────────────────┐
    │       Worker Process         │       │    PostgreSQL 16 Engine      │
    │  - Outbox Dispatcher (100ms) │       │  - 749 Relational Tables     │
    │  - Realtime SSE / WS Server  │       │  - Partial Unique Indexes    │
    │  - Membership Autobill Cron  │       │  - Advisory Transaction Locks│
    │  - SMS Reminders Ladder      │       │  - Row-Level Security (RLS)  │
    └──────────────┬───────────────┘       └──────────────────────────────┘
                   │
                   ▼ Third-Party Gateways
    ┌────────────────────────────────────────────────────────────────────────┐
    │  • Clover REST Pay Display API (Compact Terminals)                     │
    │  • CardPointe / Bolt Gateway (Cloud Terminal & Card-on-File)           │
    │  • Twilio REST API & Verify (SMS Notifications & Phone Verification)  │
    │  • Firebase Cloud Messaging (Web Push & Native Mobile Push)           │
    │  • AWS S3 Compatible Object Store (Media, Avatars & Inspo Photos)      │
    └────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Frontend Application Map

All client applications are built with Vite + React + Vanilla CSS design systems, compiled to optimized static bundles (`dist-frontends/`), and wrapped with Capacitor 6 for native mobile distribution:

1. **POS Web (`apps/pos-web`):** Primary cashier, appointment calendar, Fair Turn queue management, ticket building, Clover terminal trigger, cash drawer, and report generation.
2. **Customer Web & Mobile (`apps/customer-web`):** Online booking, certified technician selection, Face ID / biometric login, service history, loyalty point redemption, and web-push notifications.
3. **Technician Web & Mobile (`apps/tech-web`):** Personal queue, service start/done transitions, earnings dashboard, skill request submissions, and tips tracker.
4. **Owner Web & Mobile (`apps/owner-web`):** Real-time salon analytics, payroll review & approval, staff commissions configuration, schedule management, and marketing campaigns.
5. **Customer Display (`apps/customer-display`):** 23-inch landscape customer-facing screen showing real-time itemized line items, tax, surcharge disclosures, tip selection keypad, and promotional video/image ads.
6. **Go Check-In Kiosk (`apps/go-check-in-kiosk`):** Self-service salon entrance kiosk for appointment check-in, walk-in queue registration, and phone lookup.
7. **Manager Pay Web (`apps/manager-pay-web`):** Dedicated mobile payment capture terminal for Tap to Pay on iPhone and handheld roving checkout.
8. **Super Admin Web (`apps/admin-web`):** Multi-tenant platform management, subscription billing, tenant lifecycle controls, and system-wide health observability.

---

## 5. Architectural Quality Gate Status

- **CI Gates (47/47):** All structural rules (tenant boundaries, permissions, openapi sync, raw-PAN refusal, dead client detection, supply-chain injection guard) are verified green on every commit.
- **Audits (13/13):** Type safety, spec imports, hidden code, database credentials, audit wiring, frontend dist artifacts, and inert controls strictly pass with 0 defects.
- **Race Lane:** 294 real-database concurrency tests verified under simultaneous execution (double booking prevention, kiosk queue join race, gift card balance race, refund idempotency).
