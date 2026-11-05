# App Icon & Launch Screen Report

## Current state (honest)
The Capacitor iOS targets (customer, owner, tech) were generated with **default placeholder** app icons and the default
Capacitor launch screen. These are **not** App Store ready — Apple rejects placeholder/Capacitor-default icons. No custom
icon or launch asset exists in the repo yet. (No icon work was faked.)

## What's required
- **App icon:** a single 1024×1024 PNG (no alpha, no rounded corners — iOS masks it) per app, plus the generated size
  set in the asset catalog (`App/Assets.xcassets/AppIcon.appiconset`).
- **Launch screen:** `App/Base.lproj/LaunchScreen.storyboard` (Capacitor ships one) — replace the default with a simple
  branded splash (logo on the cream/gold or per-app background). Keep it minimal; Apple discourages text-heavy splashes.

## Fastest correct path (Mac)
1. Design a 1024px icon per app (distinct enough to tell Customer / Owner / Tech apart — e.g. shared mark + accent).
2. Use **`@capacitor/assets`**: place `assets/icon.png` (1024px) and `assets/splash.png` (2732×2732) in each app, then
   `npx @capacitor/assets generate --ios`. It populates the asset catalog and launch images automatically.
3. `npx cap sync ios`, open in Xcode, confirm the AppIcon set is fully populated (no missing slots), archive.

## Per-app
| App | Bundle id | Display name | Icon status |
|---|---|---|---|
| Customer | com.aipowersalon.customer | AIPowerSalon | placeholder → replace |
| Owner | com.aipowersalon.owner | AIPowerSalon Owner | placeholder → replace |
| Tech | com.aipowersalon.technician | AIPowerSalon Tech | placeholder → replace |
| Check-In | com.aipowersalon.checkin | AIPowerSalon Check-In | not scaffolded yet |

**Blocker:** real icon/splash art + the asset-catalog generation must be done with the design assets on a Mac; cannot be
produced here.

## Real icons + splash generated (DONE — verified on Linux)
The placeholder Capacitor art is replaced. Brand source assets and the `@capacitor/assets` pipeline are committed and were
run here (the CLI runs on Linux via sharp), baking a real icon + launch screen into all four iOS asset catalogs.
- **Source art** (`apps/<app>/assets/`): `icon-only.png` (1024², gold vertical-gradient field, cream serif "A", subtle
  hairline border), `icon-foreground.png` / `icon-background.png` (adaptive), `splash.png` (cream, centered gold mark +
  ring) and `splash-dark.png` (deep-brown, cream mark). Generator: `brand/make_brand_assets.py` (Pillow, DejaVu Serif Bold
  standing in for Playfair until the licensed font is dropped in). Brand colors: gold `#A96F22`, cream `#F7EFE3`.
- **Generated** into each `apps/<app>/ios/App/App/Assets.xcassets/`: `AppIcon.appiconset` (modern single 1024 source) and
  `Splash.imageset` (light + dark, @1x/2x/3x). Verified present for **customer-web, owner-web, tech-web, customer-display**.
- **Regenerate** any time after editing the source art: `cd apps/<app> && npx @capacitor/assets generate --ios`.
- **Optional polish (not blocking):** the four apps currently share one mark; to disambiguate on a device you can add a
  small per-role accent (e.g. a tiny "Owner"/"Tech" tag or hue shift) — swap the source PNGs and regenerate. Swapping in
  the real Playfair Display font is a one-line change in the generator.
