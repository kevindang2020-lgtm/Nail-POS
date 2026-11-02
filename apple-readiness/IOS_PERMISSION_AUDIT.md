# iOS Permission Audit

Principle: request only permissions the app actually uses. Audited the real code for each capability.

| Permission | Used? | Where | Info.plist string |
|---|---|---|---|
| Location (When In Use) | **Yes — customer app only** | "Find Salons Near Me" (`navigator.geolocation`, opt-in) | `NSLocationWhenInUseUsageDescription` — set, exact App Store wording, with manual city/ZIP fallback |
| Camera | No | — | not added |
| Photo Library | No (photo uploads use the standard web file input, no native photo-library API) | — | not added |
| Microphone | No | — | not added |
| Contacts | No | — | not added |
| Face ID | No (auth is email/phone/password + session cookie; no native biometric API in these web apps) | — | not added |
| Push (APNs) | Not yet wired (FCM/APNs is a pending infra item) | — | add `aps-environment` entitlement when push is implemented |

**Owner, Technician, Check-In apps:** no device permissions required at all today. Do not add location to owner/checkin.

**Result:** the only permission requested is `NSLocationWhenInUseUsageDescription`, in the customer app, and it is
already present and correctly worded. No over-permissioning.
