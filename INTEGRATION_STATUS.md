# INTEGRATION_STATUS.md — Platform External Gateways & Integrations

**Status Date:** October 14, 2026  
**Audited Baseline:** Commit `47fef2f5` (Branch `release/pilot-production-takeover`)  
**Standard Classifications:** `WORKING` · `SANDBOX READY` · `PARTIAL` · `BLOCKED_EXTERNAL` · `NOT CONFIGURED`

---

## 1. Provider Integration Matrix

| Integration | Category | Architecture & Adapters | Classification | External Requirement (Client / Kevin) |
|---|---|---|:---:|---|
| **Clover Compact** | Card Terminal | `modules/payments/src/payments/clover.client.ts`<br>REST Pay Display Cloud API (OAuth, Pair, Sale, Void, Refund) | **SANDBOX READY** | Salon Fiserv MID, Clover Device Serial & OAuth App Credentials on Clover Developer Portal. |
| **CardPointe / Bolt** | Gateway / Terminals | `modules/payments/src/payments/cardpointe.client.ts`<br>Bolt REST API, CardSecure Tokenization, Token Vault | **WORKING** | Production CardPointe Merchant ID (MID), API Username, Secret Key & Bolt Terminal ID. |
| **Fiserv Tap to Pay** | Mobile Payment | `modules/payments/src/payments/tap-to-pay/`<br>Device Attestation, Session Tokenization, Capture Port | **PARTIAL / BLOCKED_EXTERNAL** | Apple Tap to Pay on iPhone Developer Entitlement, Fiserv CommerceHub SDK license, App Store Review approval. |
| **Twilio SMS & Reminders**| Messaging | `modules/communications/src/`<br>Subaccount Provisioning, Messaging Services, Opt-out Handling | **WORKING** | Production Twilio Parent Account SID, Auth Token, A2P 10DLC Brand & Campaign Registration per tenant. |
| **Twilio Verify** | Phone Verification | `modules/booking/src/customer-booking/booking-verification-provider.ts`<br>SMS OTP, Risk Score Filter, Channel Fallback | **WORKING** | Twilio Verify Service SID configured per tenant. |
| **Firebase Cloud Messaging**| Web & App Push | `packages/web-push/`, `apps/api/src/push/`<br>VAPID Web Push, FCM HTTP v1 API, Native APNs Bridge | **WORKING** | Production `FCM_SERVICE_ACCOUNT_JSON` configured in Railway environment (file committed key revoked). |
| **SendGrid Email** | Email Delivery | `modules/notifications/src/sendgrid.sender.ts`<br>Dynamic Transactional Templates, Receipts, Onboarding | **WORKING** | Verified SendGrid API Key & Authenticated Domain Sender Records (DKIM/SPF). |
| **AWS S3 / Cloud Storage** | Media Storage | `packages/media/src/media-storage.ts`<br>S3 Client, Presigned Upload URLs, Multi-part Avatar Storage | **WORKING** | Production AWS S3 Bucket Name, Region, IAM Access Key ID & Secret Access Key (`MEDIA_STORE=s3`). |
| **OpenAI / Claude AI** | AI Receptionist | `modules/ai/src/`<br>Streaming Audio Transcription, Function Calling, Booking Intent | **WORKING** | OpenAI API Key & Anthropic API Key configured in production environment. |
| **External Payroll** | Payroll Export | `modules/workforce/src/payroll/payroll-export.service.ts`<br>Standardized CSV & JSON Payroll Ledger Export | **WORKING** | Client selection of specific third-party payroll provider (ADP, Gusto, QuickBooks). |

---

## 2. Integration Architecture Highlights

### 2.1 Clover REST Pay Display Cloud Architecture
- **Dual-Screen Workflow:** When the cashier presses "Charge Card" on the POS screen, the POS sends an HTTPS request to the backend NestJS API (`POST /pos/checkout/tickets/:id/pay-card`).
- **Device Cloud Dispatch:** The backend payments module communicates with Clover REST Pay Display API over TLS, creating an active transaction on the physical Clover Compact counter terminal.
- **Customer Interaction:** The customer views the exact transaction total, selects tip percentage (15%, 20%, 25%, Custom, None) on the Clover touchscreen, and inserts, taps, or swipes their card.
- **Instant Response Handling:** Upon customer authorization, Clover processes through First Data / Fiserv and returns approved transaction metadata (`paymentId`, `authCode`, `last4`, `cardBrand`) to the backend.
- **Fail-Soft Status Mapping (§232):** In accordance with mandate rule 2.5, non-terminal responses (Clover `pending`, CardPointe `respstat: 'B'`) are strictly classified as `provider_unavailable / processing`. They are never mislabeled as card declines, and cash/split tender options remain immediately available.

### 2.2 CardPointe / Bolt Integration
- **Card-on-File & Recurring Billing:** Membership monthly subscription charges utilize CardPointe's CardSecure vault tokens, eliminating PCI scope from salon servers.
- **Refund Duplicate Defense (§223/§228):** All refund requests transmit deterministic idempotency keys. On processor timeout, transaction state stays in review with reserved funds rather than issuing duplicate refunds upon cashier retry.

### 2.3 Twilio Multi-Tenant Subaccount Routing
- **Per-Salon Number Isolation:** Each salon branch can be provisioned with its own local phone number under a salon subaccount, maintaining distinct reputation and throughput.
- **Appointment Reminder Ladder (§54):** Reminders are scheduled at 24-hour, 2-hour, and 30-minute intervals before appointments, skipping obsolete intervals for appointments booked late. Carrier-compliant opt-out (`STOP` / `UNSTOP`) is automatically enforced at the engine level.

### 2.4 Cloud Storage Defense (§210)
- **Zero Ephemeral Uploads:** The media package refuses startup in production if `MEDIA_STORE` is not configured as `s3`, preventing container redeployment wipeouts of customer hair photos, inspiration boards, and technician portfolios.
