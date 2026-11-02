// messaging-config-diagnostics.ts — OPS-01 (Four-Module Completion Guide §7.3 / §16, Oct 30 2026): validate the two
// environment values Twilio's callbacks depend on, WITHOUT calling anything (a shape check — "reachable-shape"):
//   PUBLIC_API_BASE_URL         → the inbound webhook <base>/webhooks/twilio/sms/inbound (a purchase wires it; the health
//                                 check compares each number's SMS URL with it)
//   TWILIO_STATUS_CALLBACK_URL  → where Twilio posts delivery statuses (without it a text can never show Delivered)
// Rules: absolute https URL; a public host (not localhost, not an IP literal in a private / loopback range, not a bare
// single-label host); no credentials, query or fragment; the status callback's path IS the app's route
// (/webhooks/twilio/sms/status) and its host matches PUBLIC_API_BASE_URL's (a mismatch is a warning — a proxy may
// legitimately differ). Values are echoed back only as the origin + path (never a query string).
// Actual public reachability needs the deployed environment — that part is Blocked - External Setup (handoff).
export const INBOUND_ROUTE = '/webhooks/twilio/sms/inbound';
export const STATUS_ROUTE = '/webhooks/twilio/sms/status';

export type ConfigState = 'ok' | 'warning' | 'invalid' | 'not_set';
export interface ConfigItem { name: 'PUBLIC_API_BASE_URL' | 'TWILIO_STATUS_CALLBACK_URL'; state: ConfigState; reasonCodes: string[]; value: string | null; expectedRoute: string }
export interface ConfigDiagnostics { state: ConfigState; items: ConfigItem[] }

const PRIVATE_V4 = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/;

function parse(raw: string): { url: URL | null; codes: string[] } {
  const codes: string[] = [];
  let url: URL | null = null;
  try { url = new URL(raw); } catch { return { url: null, codes: ['URL_NOT_ABSOLUTE'] }; }
  if (url.protocol !== 'https:') codes.push('URL_NOT_HTTPS');
  if (url.username || url.password) codes.push('URL_HAS_CREDENTIALS');
  if (url.search || url.hash) codes.push('URL_HAS_QUERY');
  const h = url.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) codes.push('URL_HOST_NOT_PUBLIC');
  else if (/^[0-9.]+$/.test(h) && PRIVATE_V4.test(h)) codes.push('URL_HOST_NOT_PUBLIC');
  else if (h.startsWith('[')) codes.push('URL_HOST_IP_LITERAL');
  else if (!h.includes('.')) codes.push('URL_HOST_NOT_PUBLIC');
  return { url, codes };
}
const shown = (u: URL | null) => (u ? `${u.origin}${u.pathname}` : null);
const stateOf = (codes: string[], warnOnly: string[]): ConfigState => (!codes.length ? 'ok' : codes.every((c) => warnOnly.includes(c)) ? 'warning' : 'invalid');

export function messagingConfigDiagnostics(env: Record<string, string | undefined> = process.env): ConfigDiagnostics {
  const baseRaw = String(env.PUBLIC_API_BASE_URL || env.APS_API_BASE || '').trim();
  const cbRaw = String(env.TWILIO_STATUS_CALLBACK_URL || '').trim();
  const items: ConfigItem[] = [];

  let baseUrl: URL | null = null;
  if (!baseRaw) items.push({ name: 'PUBLIC_API_BASE_URL', state: 'not_set', reasonCodes: ['PUBLIC_API_BASE_URL_NOT_SET'], value: null, expectedRoute: INBOUND_ROUTE });
  else {
    const p = parse(baseRaw); baseUrl = p.url;
    const codes = [...p.codes];
    if (p.url && /\/webhooks\//.test(p.url.pathname)) codes.push('BASE_URL_INCLUDES_ROUTE');
    items.push({ name: 'PUBLIC_API_BASE_URL', state: stateOf(codes, []), reasonCodes: codes, value: shown(p.url), expectedRoute: INBOUND_ROUTE });
  }

  if (!cbRaw) items.push({ name: 'TWILIO_STATUS_CALLBACK_URL', state: 'not_set', reasonCodes: ['STATUS_CALLBACK_NOT_SET'], value: null, expectedRoute: STATUS_ROUTE });
  else {
    const p = parse(cbRaw);
    const codes = [...p.codes];
    if (p.url && p.url.pathname.replace(/\/+$/, '') !== STATUS_ROUTE && !p.url.pathname.replace(/\/+$/, '').endsWith(STATUS_ROUTE)) codes.push('STATUS_CALLBACK_ROUTE_MISMATCH');
    if (p.url && baseUrl && p.url.host.toLowerCase() !== baseUrl.host.toLowerCase()) codes.push('STATUS_CALLBACK_HOST_DIFFERS');
    items.push({ name: 'TWILIO_STATUS_CALLBACK_URL', state: stateOf(codes, ['STATUS_CALLBACK_HOST_DIFFERS']), reasonCodes: codes, value: shown(p.url), expectedRoute: STATUS_ROUTE });
  }
  const rank: Record<ConfigState, number> = { ok: 0, warning: 1, not_set: 2, invalid: 3 };
  const state = items.reduce<ConfigState>((s, i) => (rank[i.state] > rank[s] ? i.state : s), 'ok');
  return { state, items };
}
