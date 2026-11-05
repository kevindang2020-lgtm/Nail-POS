# Global Advertising + Tenant Control — G7 (guide Nov 5 2026)

## Audit (Part 01)

| Existing piece | Path | Decision |
|---|---|---|
| Salon ads: media, campaigns, schedules, branch targeting, analytics, POS screen | `modules/marketing/src/display-advertising/*` (migration 509), `apps/pos-web/src/screens/POSDisplayAdsScreen.tsx` | KEEP — extended, not duplicated |
| Playlist builder + display DTO (`resolvePlaylist`, `toDisplayAd`) | `display-ads-core.ts`, `display-ads-playlist.service.ts` | KEEP — the platform owner reuses it |
| Image pipeline (signature sniffing, size caps, EXIF strip, scan hook) | `display-ads-media-core.ts`, `acceptUpload` | KEEP — reused for platform images |
| One-image slideshow with crossfade | `packages/ui` `AdRotator` | KEEP — already one slide at a time |
| Device registry, heartbeat, online window (75 s) | `apps/api/src/customer-display/*`, `DISPLAY_ONLINE_WINDOW_MS` | EXTEND — heartbeat carries the applied policy |
| Global switch / platform campaigns / fleet ACK status | — | MISSING → built |

## Built

- **Master switch** `advertising_global_policy` (one row, starts ON = today's behaviour) + append-only `advertising_policy_events`.
  OFF = PLATFORM_ONLY, ON = TENANT_ONLY, never mixed. Super Admin only, fresh step-up, reason required, optimistic
  version; switching OFF with no ready platform ad needs an explicit "neutral welcome panel" confirmation (§37). The
  preview shows salons with live ads, live salon ads, registered / online / offline displays and platform ads ready.
- **Server-side authority (§11):** every display playlist request resolves the policy (5-second cache, cleared on a write);
  PLATFORM_ONLY returns AI PowerSalon's campaigns only; TENANT_ONLY the salon engine unchanged. Every salon advertising write
  (upload, create, edit, publish, restore) is refused while OFF with `ADVERTISING_MANAGED_BY_PLATFORM`; pause / archive stay
  possible; nothing is deleted or unpublished (§42, §45).
- **Platform campaigns** `platform_display_ads` + `platform_ad_media`: the same fields, validation, lifecycle
  (`PLATFORM_DISPLAY_AD_LIFECYCLE`) and image pipeline as salon ads; stored under `global/display-ads/…`; forged scope
  fields (tenant, branches, ownership) refused (§77). Publishing never moves the switch (§35). Schedules evaluated in each
  display's branch time zone.
- **Device truth (§39, §63–§65):** the playlist carries `mode` + `policyVersion`; the display reports them in its heartbeat
  once it plays that playlist (and at once when they change); `customer_display_devices.applied_ad_*` stores the ACK. Fleet
  status: applied / online-pending / offline (heartbeat older than 75 s) / revoked (excluded); registered = applied +
  pending + offline. A sent message never counts.
- **Super Admin UI:** Advertising & Customer Display — switch with preview / reason / history, fleet cards + filter + device
  table, platform ad list, Create Ad (picture upload with half-screen preview, text, verified https QR link, duration,
  dates, order), Save Draft separate from Publish.
- **POS:** "Advertising is currently managed by AI PowerSalon" banner; Add / Publish / Restore disabled (EN / VI).
- **Customer display:** idle layout exactly 50 / 50 (Check-In left — the established orientation — advertising right; portrait:
  advertising top, Check-In bottom); checkout keeps its ticket panel; ads never cover check-in / payment (existing priority).

## Evidence

| Scenario | Status | Evidence |
|---|---|---|
| 82 four platform images, OFF → all displays cycle exactly those, in order | PASS | `platform-advertising.pgtest` |
| 83 ON → each salon only its own ads | PASS | pgtest |
| 76 OFF → salon upload / create / edit / publish refused at the API; pause allowed; kept | PASS | pgtest |
| 45 ON again → only still-published salon ads; paused stays paused; no platform leak | PASS | pgtest |
| 86 fleet math (applied / pending / offline / revoked) | PASS | pgtest |
| §37 neutral-fallback confirmation, reason, version | PASS | pgtest |
| heartbeat ACK parsing | PASS | `heartbeat-ad-policy.vitest` |
| 84 switch during payment / check-in | PASS (by design) | ads are not on the checkout path; the panel only follows the idle state |
| 85 offline device / reconnect | PARTIAL | counted offline until it acknowledges; offline playback is bounded by `validUntil` (existing) — no new stale-policy TTL |
| 88 QR scanned with real phones | BLOCKED_EXTERNAL | needs devices and real App Store / Play links |
| 89 geometry at 1920×1080 / 1366×768 / portrait | NOT_TESTED (CSS only, jsdom) |
| 90 large fleet pilot | NOT_TESTED |

CODE READY FOR DEVELOPER HANDOFF: yes. PRODUCTION READY: no — real-display geometry, QR scan, store links and fleet pilot
remain. The switch starts ON, so deploying changes nothing until Super Admin turns it OFF.

## Not built (PARTIAL)

- Platform analytics (the display-count roll-ups are salon-only; platform ad ids are dropped by the existing report path).
- Media library browsing / reorder by drag, a pinned persistent QR zone (§50), a Customer App promotion template (§38).
- A policy-validity TTL forcing the neutral panel on a long-offline display (§66) beyond the existing `validUntil`.
