// branding-client.ts — optional dynamic branding. Fetches GET /platform/branding and applies any Super-Admin
// colour/tagline overrides by setting --brand-* CSS variables at runtime. Best-effort: on ANY failure it does
// nothing, because brand-tokens.css already provides the locked defaults (so branding works fully offline).
// Call once at app boot: import { applyPlatformBranding } from './brand/branding-client'; applyPlatformBranding();
//
// The LOGO is never changed here — logo assets are locked and served statically from /brand/*.

function apiBase(): string {
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return '';
  }
  const env = (import.meta as any)?.env?.VITE_API_BASE as string | undefined;
  const win = typeof window !== 'undefined' ? (window as any).APS_API_BASE : undefined;
  return (env || win || '').replace(/\/+$/, '');
}

const MAP: Record<string, string> = {
  primary_color: '--brand-primary',
  secondary_color: '--brand-deep-gold',
  accent_color: '--brand-bronze',
  surface_color: '--brand-surface-muted',
  text_color: '--brand-text',
};

export async function applyPlatformBranding(): Promise<void> {
  if (typeof document === 'undefined') return;
  try {
    const res = await fetch(`${apiBase()}/platform/branding`, { credentials: 'include' });
    if (!res.ok) return;
    const b = await res.json();
    const root = document.documentElement;
    for (const [key, cssVar] of Object.entries(MAP)) {
      const v = b?.[key];
      if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) {
        root.style.setProperty(cssVar, v);
        if (cssVar === '--brand-primary') root.style.setProperty('--gold', v); // keep legacy alias in sync
      }
    }
    if (typeof b?.platform_name === 'string' && b.platform_name && document.title) {
      // keep the per-app suffix, just normalize the brand prefix
      document.title = document.title.replace(/^AI ?PowerSalon/i, b.platform_name);
    }
  } catch { /* offline / pre-auth / no endpoint → keep locked defaults */ }
}
export default applyPlatformBranding;
