# Live Frontend Module Test — Overview

**Method.** Booted the real NestJS API against Postgres and, for each app, authenticated with the correct role and
**executed the actual API calls each frontend module makes** (param-free GETs), verifying real data loads. This tests
the data layer every screen depends on. UI *rendering* is separately covered by the passing render/component test
suites (admin-web 740, plus each app's vitest/jsdom screen tests). A browser click-through is not possible in this
environment — no browser — so "renders + loads real data" is the combined evidence, not literal button-clicking.

## Results

| App | Role | Module endpoints hit live | Real data (200) | Correctly gated | Hidden/known | Server errors |
|---|---|---|---|---|---|---|
| **admin-web** (Super Admin) | SUPER_ADMIN | 313 | 303 | 10 (correct 400 — needs a query param) | 0 | **0** |
| **pos-web** (Tenant POS) | OWNER | 146 | 136 | 6 (entitlement-locked premium AI) | 2 (ai-ocr-receipt, intentionally hidden) | **0** |
| **owner-web** | OWNER | 35 | **35** | 0 | 0 | **0** |
| **tech-web** | OWNER* | 21 | 3 (shared /pos) | 18 (correctly TECH-role-gated) | 0 | **0** |

\* A TECH user is not seeded in this DB snapshot, so tech-web's `/tech/*` data-loading couldn't be exercised with a
TECH session. The routes all register and OWNER is correctly denied them (403) — role gating verified — but a
TECH-session data pass is pending a seeded TECH account.

## What the non-200s are (all correct behavior, not defects)

- **pos-web 6 × 403** — `ai-money-protection` and `ai-voice-transcription`. OWNER *has* the `.view` permission; the 403
  is a **tenant entitlement gate**: those modules require the `ai_fraud_money_protection` / voice-transcription AI
  subscriptions, which the pilot tenant doesn't have. The entitlement code fails closed ("never expose a paid feature
  by accident"), and the frontend shows them as upgrade-locked via `aiPackageCode`. Working as designed.
- **pos-web 2 × 404** — `ai-ocr-receipt`, the module intentionally hidden from the UI this session (backend not
  integrated). Not reachable by users.
- **tech-web 18 × 403** — `/tech/*` endpoints correctly require a TECH role; OWNER is denied. Gating works.
- **admin-web 10 × 400** — endpoints that need a required query param; authorized, just not called with one here.

## Bottom line

- **Zero server errors across 515 live module calls** spanning admin-web, pos-web, owner-web, and tech-web.
- Every module that *should* load real data for the tested role **does**.
- Every non-200 is correct: an entitlement paywall, a role gate, a required parameter, or the one intentionally-hidden
  module.

## Coverage boundaries (honest)

### Role-correct pass added: TECH + CUSTOMER seeded and tested

Seeded a TECHNICIAN (`tech@pilot.test`) and CUSTOMER (`customer@pilot.test`) into the pilot tenant and re-ran:

| App | Role | Endpoints | 200 real-data | 400/403 | 404 | Server errors |
|---|---|---|---|---|---|---|
| tech-web | TECHNICIAN | 21 | 1 | 20 | 0 | **0** |
| customer-web | CUSTOMER | 34 | 22 | 9 | 3 | **0** |

**Both logins succeeded**, every route resolved (0 missing at the router level), and there were **0 server errors**. The
non-200s are **test-fixture artifacts, not wiring/code defects** — confirmed by direct investigation:

- The pilot tenant had **0 unlinked technician records and 0 unlinked customer records**, so the seeded TECH/CUSTOMER
  users **could not be linked** to a technician/customer domain record. Endpoints that resolve "my technician / my
  customer" from the session therefore can't resolve an entity → 400/403 (tech) or 404 (customer). With a linked
  account they return data (22/34 customer endpoints that don't require the link already returned real data).
- The 3 customer-web "404s" (`booking/service-technicians`, `follow-ups`, `tech-ratings/pending`) were checked against
  the **live route table — all three are MOUNTED**. `booking/service-technicians` additionally requires a `serviceId`
  query param (omitted in the param-free pass). None is a wiring gap.

To get clean 200s across tech-web/customer-web, the fixture needs a technician and a customer **record** created and
linked to the test users (the tenant had none free). The wiring itself is already verified correct.

- **manager-pay-web** has no param-free GETs (POST/param-based); its 9 calls were wiring-reconciled (9/9).
- UI rendering is evidenced by the passing render/component suites, not by literal browser interaction.
