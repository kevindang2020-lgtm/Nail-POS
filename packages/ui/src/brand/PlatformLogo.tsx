// PlatformLogo.tsx — AI PowerSalon shared logo component (SINGLE SOURCE OF TRUTH).
// Lives in @aipowersalon/ui (Constitution 13 Phase 5) — formerly copied into every app by scripts/sync-brand.mjs. Renders the LOCKED official
// logo from /brand/* (see brand/BRAND_LOCK.md). No color filters, no redraw, fixed aspect ratio, stable
// dimensions to avoid layout shift. The logo lives in the persistent app shell, so navigation never reloads it.
import React from 'react';

type Variant = 'full' | 'mark' | 'appIcon';
type Size = 'sidebar' | 'login' | 'topbar' | 'kiosk' | number;

const SRC: Record<Variant, string> = {
  full: '/brand/aipowersalon-logo.png',
  mark: '/brand/aipowersalon-logo.png', // no separate approved mark; reuse full lockup
  appIcon: '/brand/app-icon-192.png',
};
// width in px for named sizes (height auto via aspect-ratio)
const WIDTH: Record<Exclude<Size, number>, number> = { sidebar: 200, login: 220, topbar: 150, kiosk: 320 };

export function PlatformLogo({
  variant = 'full',
  size = 'sidebar',
  priority = false,
  className,
  style,
}: {
  variant?: Variant;
  size?: Size;
  priority?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const w = typeof size === 'number' ? size : WIDTH[size];
  return (
    <img
      src={SRC[variant]}
      alt="AI PowerSalon"
      width={w}
      decoding={priority ? 'sync' : 'async'}
      // @ts-expect-error fetchPriority is valid in modern browsers
      fetchpriority={priority ? 'high' : 'auto'}
      loading={priority ? 'eager' : 'lazy'}
      className={className}
      style={{ width: w, height: 'auto', display: 'block', ...style }}
      draggable={false}
    />
  );
}
export default PlatformLogo;
