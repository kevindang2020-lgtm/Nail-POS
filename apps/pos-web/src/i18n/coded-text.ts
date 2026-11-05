// coded-text.ts — Vietnamese POS mandate §21 / §120 (Oct 27 2026): render text the SERVER wrote as a code + vars
// (packages/api-contracts/src/text/coded-text.ts) in the cashier's language. Key = `srv.<code>` (ns/srv.*.ts). A code the
// POS has no key for falls back to the server's English sentence (never blank, never a raw key). A var value "@<key>" is
// itself a catalogue key, worded with the same vars (a reason code, a nested "why this place"). Read at render, so a
// language switch re-labels it without a refetch.
import { t } from '@aipowersalon/mobile-sdk/i18n';
import type { CodedText } from '@aipowersalon/api-contracts';

function humanise(code: string): string { const s = code.split('.').pop()!.replace(/_/g, ' ').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); }
function words(key: string, vars: Record<string, string>): string | null { const out = t(key, vars); return out === key ? null : out; }

/** "@key" → that key worded with the same vars; "@key#p0" → worded with the vars named p0_<name> (nested refs resolved) */
function ref(spec: string, raw: Record<string, string>): string {
  const [key, prefix] = spec.split('#');
  let vars = raw;
  if (prefix) { vars = {}; for (const [k, v] of Object.entries(raw)) if (k.startsWith(prefix + '_')) vars[k.slice(prefix.length + 1)] = v; }
  const resolved: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) resolved[k] = prefix && v.startsWith('@') ? ref(v.slice(1), vars) : v;
  return words(key, resolved) ?? humanise(key);
}

export function codedText(ct: CodedText | null | undefined, fallback?: string | null): string {
  if (!ct || !ct.code) return fallback ?? '';
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(ct.vars ?? {})) if (v !== undefined && v !== null) raw[k] = String(v);
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) vars[k] = v.startsWith('@') ? ref(v.slice(1), raw) : v;
  return words('srv.' + ct.code, vars) ?? ((fallback ?? '') || humanise(ct.code));
}
/** does the POS have words for this code? */
export function hasCodedText(code: string | null | undefined): boolean { if (!code) return false; const k = 'srv.' + code; return t(k) !== k; }
