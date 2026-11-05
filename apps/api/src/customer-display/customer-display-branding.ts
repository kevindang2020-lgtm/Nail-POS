// customer-display-branding.ts — 23-inch dual-screen spec §13: the SALON's identity at the top of its customer display.
// PURE. "Do not permanently hard-code AI PowerSalon as the salon identity" — the header shows the salon's name, its logo
// (Settings → Receipts & Branding), its tagline and, when the salon wants it, the branch (Settings → Customer Display).
// Everything here comes from the salon's own rows, resolved for the device's tenant and branch by the server; the text
// is shown as text (never markup) and the logo is accepted only as the salon's own stored file (safeSalonLogoUrl).
import type { CustomerDisplayBranding } from '@aipowersalon/api-contracts/customer';
import { safeSalonLogoUrl } from '@aipowersalon/tenants';

export interface DisplayBrandingSource {
  salonName: string;
  /** The device's branch name (null when the device has none). */
  branchName: string | null;
  /** tenant_settings 'customer-display-devices' — the branch's row over the salon's row. */
  display: Record<string, unknown>;
  /** tenant_settings 'salon-logo' (salon-wide), as stored. */
  logo: { key?: unknown; url?: unknown } | null;
}

// invisible / control characters a saved line must never carry onto a public screen
// eslint-disable-next-line no-control-regex -- deliberate: strip control characters before the text reaches a public screen
const HIDDEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;

/** A short line of the salon's own text: trimmed, invisible characters removed, collapsed, capped; null when empty. */
export function cleanLine(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(HIDDEN, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max).trimEnd() : s;
}

export function buildDisplayBranding(tenantId: string, src: DisplayBrandingSource): CustomerDisplayBranding {
  const d = src.display ?? {};
  const branded = d.displayBranding !== false;   // the salon's "branding" switch (default on) shows the logo and tagline
  return {
    salonName: cleanLine(src.salonName, 80) ?? 'Salon',
    logoUrl: branded ? safeSalonLogoUrl(tenantId, src.logo) : null,
    tagline: branded ? cleanLine(d.tagline, 60) : null,
    branchName: d.showBranchName === true ? cleanLine(src.branchName, 60) : null,
    idleMessage: cleanLine(d.idleMessage, 80),
  };
}
