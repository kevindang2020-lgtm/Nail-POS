#!/usr/bin/env bash
# Build signed Android release bundles (.aab) for the 5 native apps. Run on a machine with Android SDK + Java 17.
# Requires a keystore (see make-android-keystore.sh) and these env vars:
#   VITE_API_BASE=https://api.aipowersalon.com   (baked into the web build so the app calls your live API)
#   APS_KEYSTORE=/abs/path/aipowersalon.keystore  APS_KS_PASS=...  APS_KEY_ALIAS=aipowersalon  APS_KEY_PASS=...
set -euo pipefail
: "${VITE_API_BASE:?set VITE_API_BASE}"; : "${APS_KEYSTORE:?}"; : "${APS_KS_PASS:?}"; : "${APS_KEY_ALIAS:?}"; : "${APS_KEY_PASS:?}"
cd "$(dirname "$0")/.."
APPS=("customer-web" "owner-web" "tech-web" "customer-display" "go-check-in-kiosk")
for app in "${APPS[@]}"; do
  echo "▸ $app"
  ( cd "apps/$app" && VITE_API_BASE="$VITE_API_BASE" npm run build && npx cap sync android )
  ( cd "apps/$app/android" && ./gradlew bundleRelease \
      -Pandroid.injected.signing.store.file="$APS_KEYSTORE" \
      -Pandroid.injected.signing.store.password="$APS_KS_PASS" \
      -Pandroid.injected.signing.key.alias="$APS_KEY_ALIAS" \
      -Pandroid.injected.signing.key.password="$APS_KEY_PASS" )
  echo "  → apps/$app/android/app/build/outputs/bundle/release/app-release.aab"
done
echo "✓ All Android bundles built. Upload each .aab to Google Play Console."
