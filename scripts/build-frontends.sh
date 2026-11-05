#!/usr/bin/env sh
# build-frontends.sh — build every AIPowerSalon frontend to static files and stage them under dist-frontends/.
# Phase 0 deploy artifact. Each Vite app builds to apps/<app>/dist; this collects them into one place per app so a
# static host (Railway/Render static site, a CDN bucket, or the API itself) can serve them.
#
# API base URL resolution (from apps/*/src/api/client.ts):
#   build-time VITE_API_BASE  ->  runtime window.APS_API_BASE  ->  "" (same-origin, the default)
#   - Serving each dist/ BEHIND the API (same origin)   => leave VITE_API_BASE unset. No CORS needed. Simplest.
#   - Serving from a separate origin / CDN              => set VITE_API_BASE=https://api.yourdomain before building,
#                                                          AND add that app's origin to WEB_CORS_ORIGINS on the API.
#
# Usage:
#   sh scripts/build-frontends.sh                 # same-origin build (VITE_API_BASE unset)
#   VITE_API_BASE=https://api.example.com sh scripts/build-frontends.sh   # separate-origin build
#
# Output: dist-frontends/<app>/  (each a self-contained static bundle with a SPA-rewrite file)

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Auto-load VITE_API_BASE from root .env if not explicitly passed in environment
if [ -z "$VITE_API_BASE" ] && [ -f "$ROOT/.env" ]; then
  ENV_VITE_API_BASE=$(grep -E '^ *VITE_API_BASE=' "$ROOT/.env" | tail -n 1 | cut -d '=' -f2- | tr -d '\r"' | tr -d "'")
  if [ -n "$ENV_VITE_API_BASE" ]; then
    export VITE_API_BASE="$ENV_VITE_API_BASE"
  fi
fi

OUT="$ROOT/dist-frontends"
rm -rf "$OUT"
mkdir -p "$OUT"

# Vite SPA apps: "<dir>:<workspace-name>". All use react-router, so each needs an index.html rewrite on its host.
VITE_APPS="
pos-web:aipowersalon-pos-web
admin-web:aipowersalon-admin-web
owner-web:aipowersalon-owner-web
tech-web:aipowersalon-tech-web
customer-web:aipowersalon-customer-web
customer-display:aipowersalon-customer-display
go-check-in-kiosk:aipowersalon-go-check-in-kiosk
manager-pay-web:aipowersalon-manager-pay-web
"

echo "==> Building Vite frontends (VITE_API_BASE='${VITE_API_BASE:-<same-origin>}')"

for entry in $VITE_APPS; do
  [ -z "$entry" ] && continue
  dir="${entry%%:*}"; ws="${entry##*:}"
  [ -z "$dir" ] && continue
  echo "  - $dir ($ws)"
  npm run build --workspace "$ws"
  mkdir -p "$OUT/$dir"
  cp -R "apps/$dir/dist/." "$OUT/$dir/"
  # SPA rewrite so client-side routes (react-router) resolve to index.html on any static host.
  printf '/*    /index.html   200\n' > "$OUT/$dir/_redirects"          # Netlify / Render static
  # CDN cache policy (Phase 2 §9): content-hashed build assets are immutable → cache for a year; the HTML entry point
  # must revalidate so a new release is picked up immediately. _headers is read by Netlify / Cloudflare Pages / Render.
  {
    printf '/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n\n'
    printf '/index.html\n  Cache-Control: no-cache\n\n'
    printf '/*.js\n  Cache-Control: public, max-age=31536000, immutable\n\n'
    printf '/*.css\n  Cache-Control: public, max-age=31536000, immutable\n'
  } > "$OUT/$dir/_headers"
  # Railway/Nginx-style hosts read a static.json or nixpacks config; _redirects covers the common case.
done

# Phase 15 (Oct 10 2026): the static go-check-in-admin page that used to be staged here was removed — Super Admin manages
# kiosks in admin-web → Check-In Devices (/check-in-devices), against the same six super-admin/tenants/:id/go-check-in routes.

echo ""
echo "==> Done. Staged static bundles:"
for d in "$OUT"/*/; do printf '   %s\n' "$d"; done
echo ""
echo "Next: point each app's subdomain (or the API's static route) at the matching dist-frontends/<app> folder."
echo "Same-origin note: if serving behind the API, no CORS change is needed; otherwise set WEB_CORS_ORIGINS."
