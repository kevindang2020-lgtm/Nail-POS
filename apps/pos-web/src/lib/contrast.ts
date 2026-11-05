import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
// contrast.ts — WCAG relative-luminance + contrast helpers for the catalog color picker.
// Pure, framework-free, unit tested. Used to warn when a category's display color would make labels hard to read.

export function hexToRgb(hex: string): [number, number, number] | null {
  const t = (hex || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(t)) { const n = parseInt(t, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  if (/^[0-9a-f]{3}$/i.test(t)) return [parseInt(t[0] + t[0], 16), parseInt(t[1] + t[1], 16), parseInt(t[2] + t[2], 16)];
  return null;
}

function channel(c: number): number { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }

/** WCAG relative luminance (0=black, 1=white). */
export function luminance(rgb: [number, number, number]): number { return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]); }

/** WCAG contrast ratio between two luminances (1..21). */
export function contrastRatio(l1: number, l2: number): number { const a = Math.max(l1, l2), b = Math.min(l1, l2); return (a + 0.05) / (b + 0.05); }

const WHITE = luminance([255, 255, 255]);
const INK = luminance([26, 18, 8]); // the cream/gold system's near-black ink
const PAGE = luminance([247, 239, 227]); // #F7EFE3 — the cream page a color swatch sits on

/** The more readable of white / dark ink for text on the given background. */
export function readableTextColor(hex: string): '#FFFFFF' | '#1A1208' {
  const rgb = hexToRgb(hex); if (!rgb) return '#1A1208';
  const L = luminance(rgb);
  return contrastRatio(L, WHITE) >= contrastRatio(L, INK) ? '#FFFFFF' : '#1A1208';
}

/** Best achievable contrast for any label color on this background. */
export function bestContrast(hex: string): number {
  const rgb = hexToRgb(hex); if (!rgb) return 0;
  const L = luminance(rgb);
  return Math.max(contrastRatio(L, WHITE), contrastRatio(L, INK));
}

/** A human warning when a chosen swatch color would be hard to see against the cream page, or null when it's fine. */
export function colorContrastWarning(hex: string): string | null {
  const t = (hex || '').trim();
  if (!t) return null;
  const rgb = hexToRgb(t);
  if (!rgb) return tx('pos.not_a_valid_hex_color_use_1kcw');
  const vsPage = contrastRatio(luminance(rgb), PAGE);
  if (vsPage < 1.4) return tx('pos.very_close_to_the_page_color_1rsb');
  if (vsPage < 2) return tx('pos.low_contrast_with_the_page_a_1o94');
  return null;
}
