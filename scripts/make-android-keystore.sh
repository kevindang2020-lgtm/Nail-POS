#!/usr/bin/env bash
# One-time: create the upload keystore for signing Android releases. Keep the file + passwords SAFE (losing them
# means you can't update the apps). Do NOT commit the keystore.
set -euo pipefail
OUT="${1:-aipowersalon.keystore}"
keytool -genkeypair -v -keystore "$OUT" -alias aipowersalon \
  -keyalg RSA -keysize 2048 -validity 10000
echo "✓ Created $OUT (alias: aipowersalon). Set APS_KEYSTORE/APS_KS_PASS/APS_KEY_ALIAS/APS_KEY_PASS from these when running build-android.sh."
