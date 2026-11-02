# Optional login salon photograph

The POS login page (`src/screens/LoginScreen.tsx`) renders a CSS/SVG marble scene when no photograph is present.

**Oct 12 2026 (developer merge):** the `salon-interior*.jpg/.webp` set here is derived from the photograph the
developer added to his login redesign on Oct 6 2026 (`newloaginimg.png`, 1448×1086, a rendered luxury-salon
interior) — resized into the responsive set this page already expected. Kevin: confirm it is a licensed / owned
render; if not, delete the `salon-interior*` files and the marble scene returns on its own. An unlicensed stock
image must not be embedded.

To use a real photo, drop a **licensed** image here:

    apps/pos-web/public/brand/salon-interior.jpg

It is picked up automatically — **no code change required**. If the file is absent, the page falls back to the
marble scene (covered by tests, so the fallback cannot silently break).

Recommended: 1600×2000px or larger, portrait-ish, warm cream/white salon interior. It renders with
`object-fit: cover` beneath the existing soft-white overlay and gold curves, so the brand text stays readable.
