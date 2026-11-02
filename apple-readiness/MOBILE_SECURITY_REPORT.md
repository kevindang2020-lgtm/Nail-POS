# Mobile Security Report

Audited the real frontend + backend code. Strong existing posture, with two integration items for native shells.

## Strengths (verified)
- **No tokens in JS storage.** Auth is a server-set **httpOnly session cookie** (`credentials: 'include'`). There is no
  JWT/access token in `localStorage`/`sessionStorage`. (owner-web's only `localStorage` use is a branch-view UI
  preference, not a credential.)
- **No secrets in the frontend.** Code search found no API keys, Google Maps keys, or payment-gateway secrets in any
  web bundle. Maps use Leaflet/OpenStreetMap (no key). Gateway secrets live server-side.
- **Tenant scope is server-derived.** A global middleware strips any client-supplied tenant/branch keys; the server
  always derives scope from the session. Cross-tenant access is prevented server-side.
- **No raw card data.** Payment flows use tokenization/sandbox; no PAN/CVV is stored.
- **Transport:** all API calls are HTTPS/TLS (standard).

## Items to resolve for the native (WebView) builds
1. **Absolute API base.** The web apps call relative paths (`/customer`, `/owner`, `/tech`) that only resolve via the
   Vite dev proxy. Inside a Capacitor WebView there is no proxy, so the production build must point at an absolute
   `https://` API: build with `VITE_API_BASE=https://api.yourdomain`. (No hardcoded localhost in production.)
2. **Cookie-session in WKWebView.** httpOnly cookies work in `WKWebView` but require the API and app to be configured
   for it (cookie domain, `SameSite`/secure attributes, CORS `credentials`). Validate login persists in the native
   shell during device testing; if needed, move to a token-in-Keychain flow. This is a real integration step.

## Other
- Logout revokes the server session (clears the cookie). Session expiry is handled server-side.
- No biometric/Face ID API is used (so no `NSFaceIDUsageDescription` needed).
- IPv6: no IP literals in client code; uses DNS hostnames — compatible with IPv6-only review networks once the
  absolute API base is a hostname (not an IP).
