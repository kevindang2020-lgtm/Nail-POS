# Pointing the frontends at your backend (API origin)

Each SPA resolves its API origin in this order — **first non-empty wins**:

1. **Build-time** `VITE_API_BASE` — `VITE_API_BASE=https://api.yoursalon.com npm run build` (bakes the origin into the bundle).
2. **Runtime** `window.APS_API_BASE` — set in `dist/config.js`, editable **on the server with no rebuild**.
3. **Same-origin** `""` — the default; calls the API on whatever origin the app is served from (the standard deploy:
   host each `dist/` behind the API).

## The no-rebuild path (recommended for static hosting)

Every app ships a `public/config.js` that is copied verbatim to `dist/config.js` (never bundled or hashed) and loaded
in `index.html` **before** the app bundle. To point a deployed app at a separately-hosted backend, edit one line on the
server:

```js
// dist/config.js
window.APS_API_BASE = "https://api.yoursalon.com";   // "" = same-origin (default)
```

No rebuild, no redeploy of the bundle — refresh and the app calls the new origin. You can set a different origin per
environment (staging vs prod) without rebuilding.

**Verified:** in a real browser, editing `dist/config.js` to a test origin makes the app read that origin; with
`config.js = ""` the full authenticated click-through passes same-origin (0 JS errors) against a real Postgres.

## Which apps

`pos-web`, `admin-web`, `customer-web`, `tech-web`, `owner-web`, `customer-display` — all six use the same mechanism.
