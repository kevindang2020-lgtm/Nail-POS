# DATABASE_STATUS.md — Database Architecture, Schema Inventory & Migrations

**Status Date:** October 14, 2026  
**PostgreSQL Version:** 16.x (Relational Engine)  
**ORM / Query Builder:** Kysely Type-Safe SQL (zero unparameterized queries)  
**Total Tables:** 749 Relational Tables  
**Migrations:** 603 Migration Files (numbered up to `663`)

---

## 1. Schema Composition & Ownership Classes

Every table in the database is strictly cataloged by Ownership Class (Constitution 1 §3) and Domain (§7) in `apps/api/db/ownership/registry.generated.json`.

| Class | Name | Definition | Tables | Core Examples |
|:---:|---|---|---:|---|
| **B** | `tenant_owned` | Strictly isolated by `tenant_id NOT NULL` | **461** | `tickets`, `pos_queue_items`, `customers`, `inventory_items`, `gift_cards`, `loyalty_accounts` |
| **C** | `tenant_branch_owned` | Isolated by `tenant_id NOT NULL` and `branch_id NOT NULL` | **78** | `pos_tech_appointments`, `cash_drawers`, `terminals`, `branch_operating_hours`, `technician_shifts` |
| **A** | `platform_global` | Global system tables (no `tenant_id`) | **145** | `system_settings`, `platform_users`, `feature_flags`, `global_audit_logs`, `carrier_prefixes` |
| **D** | `platform_identity_tenant_rel` | User identity linked to multiple tenants | **43** | `user_tenant_memberships`, `customer_identities`, `technician_global_profiles` |
| **E** | `cross_tenant_platform_data` | Shared benchmark & aggregated reporting | **22** | `industry_service_benchmarks`, `platform_billing_invoices`, `tenant_usage_rollups` |

---

## 2. Domain Distribution

```
Domain                 Table Count    Primary Responsibilities
────────────────────────────────────────────────────────────────────────────────
AI                     81 tables      Voice sessions, transcription buffers, copilot logs
OPERATIONS             69 tables      Queue items, check-in records, stations, hardware
FINANCE                63 tables      Tickets, ledger entries, refunds, cash drawers
WORKFORCE              59 tables      Technicians, shifts, time-off, compensation rules
SUPPORT                57 tables      Dispute records, tickets, customer notes
PAYMENTS               53 tables      Clover terminal intents, card tokens, settlements
IDENTITY               41 tables      User credentials, MFA tokens, session records
BOOKING                41 tables      Appointments, holds, schedule constraints, windows
CUSTOMERS              40 tables      Customer profiles, notes, emergency contacts
SECURITY               31 tables      Permission roles, API keys, password reset nonces
COMMUNICATIONS         26 tables      Twilio delivery logs, reminder queue, SMS opt-outs
INVENTORY              25 tables      Products, stock movement ledger, suppliers, barcodes
AUDIT                  24 tables      Append-only audit events, actor stamps, change history
TENANTS                22 tables      Tenant records, branches, salon branding, domains
CATALOG                20 tables      Service categories, add-ons, pricing formulas
ANALYTICS              18 tables      Daily KPI snapshots, technician revenue rollups
DEALS                  17 tables      Marketplace campaigns, promo codes, deal holds
CHECKOUT               12 tables      Cart sessions, line items, tip distributions
MEMBERSHIPS            11 tables      Membership tiers, recurring renewals, billing logs
LOYALTY                11 tables      Point ledgers, reward tiers, redemption vouchers
PLATFORM               11 tables      Worker locks, migration tracking, database heartbeats
────────────────────────────────────────────────────────────────────────────────
TOTAL                 749 tables
```

---

## 3. High-Concurrency & Data Integrity Defenses

### 3.1 Advisory Locking Disciplines
- **Appointment Booking Serializer:** `select pg_advisory_xact_lock(hashtextextended('${tenant}|${technician}|${date}', 0))` ensures parallel bookings for the same technician on the same day serialize deterministically, preventing double-bookings.
- **Check-In Duplication Guard:** `select pg_advisory_xact_lock(hashtextextended('checkin:${appointmentId}', 0))` ensures double-taps on the kiosk or race conditions with staff POS check-ins produce exactly one active queue item.

### 3.2 Exclusion Constraints (PostgreSQL 23P01)
- Migration 426/482 introduces PostgreSQL temporal exclusion constraints (`EXCLUDE USING gist`) over appointment time ranges. If an advisory lock is bypassed (e.g., through connection pool switching), the database engine rejects overlapping appointments with SQLSTATE `23P01`, which the application catches and maps to a clean `APPOINTMENT_CONFLICT` (409) HTTP response with fresh availability slots.

### 3.3 Partial Unique Indexes
- `uq_pos_queue_active_appointment`: Ensures at most one active queue entry exists per appointment ID (`status IN ('waiting', 'serving', 'paused')`).
- `uq_ticket_paid_per_appointment`: Prevents double checkout creation for the same visit.
- `uq_api_idempotency_key`: Durable database-level idempotency store ensuring that retried requests replay the original response and never execute side effects twice.

---

## 4. Migration Architecture & History

- **Total Migrations:** 603 sequential migration files from `001_initial_schema.sql` to `663_notifications_simulated_status.sql`.
- **Transaction Safety:** Every migration runs inside an isolated database transaction with statement lock timeouts (`SET LOCAL lock_timeout = '5s'`) to prevent blocking production traffic.
- **Zero Raw Destructive Commands:** Destructive operations (`DROP TABLE`, `DROP COLUMN`) require expand-and-contract transition phases with prior deprecation cycles.
