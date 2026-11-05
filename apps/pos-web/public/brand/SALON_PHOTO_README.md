# Optional login salon photograph

The POS login page (`src/screens/LoginScreen.tsx`) renders a CSS/SVG marble scene by default because this
repository ships **no licensed salon photograph** — and an unlicensed stock image must not be embedded.

To use a real photo, drop a **licensed** image here:

    apps/pos-web/public/brand/salon-interior.jpg

It is picked up automatically — **no code change required**. If the file is absent, the page falls back to the
marble scene (covered by tests, so the fallback cannot silently break).

Recommended: 1600×2000px or larger, portrait-ish, warm cream/white salon interior. It renders with
`object-fit: cover` beneath the existing soft-white overlay and gold curves, so the brand text stays readable.
