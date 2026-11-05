# App Review Test Accounts

Provide these in App Store Connect → App Review Information. **Create dedicated reviewer accounts on a TEST tenant** and
fill in real passwords here before submission — do NOT use production salon data, and do NOT commit real passwords to git.

## Test environment
- **Test tenant:** "LUXE" demo salon (or a dedicated reviewer tenant)
- **Test branch:** the seeded primary branch
- **Backend:** point the build at your staging API (`VITE_API_BASE=https://staging-api.aipowersalon.com`)
- **Payment mode:** sandbox (CardPointe/Fiserv sandbox; no live charges). Cash-to-technician enabled for the tech demo.

## Reviewer logins (fill real passwords before submitting)
| App | Login | Password | Notes |
|---|---|---|---|
| Customer | customer@test.aipowersalon.com | «set in App Store Connect» | Has a test appointment + a checkout-ready ticket |
| Owner | owner@test.aipowersalon.com | «set» | Sees only the test tenant's business |
| Technician | tech@test.aipowersalon.com | «set» | Assigned to the test branch; has assigned tickets |
| Check-In | n/a (device-paired) | n/a | Provide pairing/PIN instructions in review notes |

## Pre-seed before review
- One **test appointment** (today) for the customer account.
- One **checkout ticket** ready for Skip-the-Line pay (sandbox).
- One **assigned ticket** for the technician to accept → start → mark done → confirm cash.
- For Check-In: pair a device to the test tenant/branch and note the staff PIN in the review notes.

## Notes for the reviewer
- Login is email/phone/password (no social login → Sign in with Apple not required).
- Location is optional in the Customer app; "Search by City or ZIP" works without granting location.
- Payments are for in-person salon services via the salon's gateway (sandbox), not Apple In-App Purchase.
