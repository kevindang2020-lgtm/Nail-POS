// platform-brand.ts — AI PowerSalon SINGLE SOURCE OF TRUTH for platform branding.
// Every application (Super Admin, POS, Owner, Tech, Customer, Kiosk, Customer Display) and the backend
// branding endpoint consume THIS object. Do not hardcode logo paths or brand colors anywhere else.
//
// Asset paths resolve to each app's /brand/* (populated by scripts/sync-brand.mjs from this brand/ folder).
// The logo artwork is a LOCKED brand asset — see brand/BRAND_LOCK.md. Do not redraw/recolor/crop/stretch it.

export const PLATFORM_BRAND = {
  name: 'AI PowerSalon',
  shortName: 'AI PowerSalon',
  tagline: 'Smarter Salon. Stronger Business.',

  // Approved logo assets (served from each app's public/brand/, synced from /brand/).
  logoFull: '/brand/aipowersalon-logo.png',     // full official lockup (emblem + wordmark + tagline)
  logoFullWebp: '/brand/aipowersalon-logo.webp',
  logoMark: '/brand/aipowersalon-logo.png',     // no separate approved mark exists → reuse full lockup
  favicon: '/brand/favicon.ico',
  appleTouchIcon: '/brand/apple-touch-icon.png',
  appIcon192: '/brand/app-icon-192.png',
  appIcon512: '/brand/app-icon-512.png',

  colors: {
    primary: '#A96F22',        // brand gold (primary actions, active states)
    primaryHover: '#96601D',
    primaryActive: '#84561A',
    gold: '#A96F22',
    deepGold: '#84561A',
    bronze: '#C9971B',
    ivory: '#FBF6EC',
    warmWhite: '#FEFDFC',
    surface: '#FFFFFF',
    surfaceMuted: '#FBF6EC',
    page: '#F7EFE3',
    textPrimary: '#2A2118',
    textSecondary: '#8A7A66',
    border: '#E7DCC9',
    success: '#2E7D32',
    warning: '#C9971B',
    danger: '#C0392B',
    info: '#2C5B93',
    trial: '#5B4B93',          // purple — trial / AI category only
  },

  fonts: {
    serif: '"Playfair Display", Georgia, serif',
    sans: '"Hanken Grotesk", "Segoe UI", system-ui, Arial, sans-serif',
  },
} as const;

export type PlatformBrand = typeof PLATFORM_BRAND;
export default PLATFORM_BRAND;
