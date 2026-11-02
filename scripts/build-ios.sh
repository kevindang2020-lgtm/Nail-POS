#!/usr/bin/env bash
# Build + export signed iOS .ipa for the 5 native apps. Run on macOS with Xcode + your Apple signing assets.
#   VITE_API_BASE=https://api.aipowersalon.com   APPLE_TEAM_ID=XXXXXXXXXX
# Edit deploy/ExportOptions.plist (teamID + provisioningProfiles) first.
set -euo pipefail
: "${VITE_API_BASE:?set VITE_API_BASE}"; : "${APPLE_TEAM_ID:?set APPLE_TEAM_ID}"
cd "$(dirname "$0")/.."
OUT="$PWD/build/ios"; mkdir -p "$OUT"
APPS=("customer-web" "owner-web" "tech-web" "customer-display" "go-check-in-kiosk")
for app in "${APPS[@]}"; do
  echo "▸ $app"
  ( cd "apps/$app" && VITE_API_BASE="$VITE_API_BASE" npm run build && npx cap sync ios )
  WS="apps/$app/ios/App/App.xcworkspace"
  xcodebuild -workspace "$WS" -scheme App -configuration Release \
    -archivePath "$OUT/$app.xcarchive" -allowProvisioningUpdates DEVELOPMENT_TEAM="$APPLE_TEAM_ID" archive
  xcodebuild -exportArchive -archivePath "$OUT/$app.xcarchive" \
    -exportOptionsPlist deploy/ExportOptions.plist -exportPath "$OUT/$app"
  echo "  → $OUT/$app/App.ipa"
done
echo "✓ All .ipa built. Upload via Xcode Organizer or 'xcrun altool/notarytool' / Transporter to App Store Connect."
