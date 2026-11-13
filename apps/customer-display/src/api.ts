// api.ts — talks to the PUBLIC device API. Two ways the display authenticates:
//  • DEVICE mode (a paired display — the 23-inch screen): its DEVICE credential (23-inch spec §12), collected by pairing
//    itself (POST /customer-display/pairing, the owner types the code into the POS) and kept in the device's secure store
//    (deviceCredential.ts). It asks "what's my current checkout?"; the POS attaches one to it; between customers it shows
//    check-in and the salon's advertising.
//  • SESSION mode (a one-off device): ?session=<id>&token=<token> — the front desk hands a single checkout to the device.
// The device credential rides ONLY in the x-device-token header — fetches and the realtime stream alike (a fetch-based
// stream, headerEventSource.ts): never in an address, where proxies and history keep it. A session token still rides the
// one-off display's stream address (an EventSource cannot send headers; it dies with its checkout).
import type {
  CustomerDisplayAdDisplayReport, CustomerDisplayAdPlaylist, CustomerDisplayState, DisplayHeartbeat, DisplayHeartbeatAck,
  DisplayPairingPoll, DisplayPairingStart, DisplayPlatform, DisplayReceiptSubmission, TipSubmission,
} from '@aipowersalon/api-contracts/customer';
import { HeaderEventSource } from './headerEventSource';
import { buildApiUrl } from '@aipowersalon/api-client';
import type { DeviceHealthFacts } from './useHeartbeat';

export type Creds =
  | { mode: 'session'; sessionId: string; token: string }
  | { mode: 'device'; deviceToken: string };

// Read creds from query string first, then the hash fragment. A device token wins if present. (A device token in the
// address is the provisioning link from before pairing existed: deviceCredential.ts moves it into the secure store and
// wipes it from the address at once.)
export function readCreds(): Creds | null {
  const q = new URLSearchParams(location.search);
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const get = (k: string) => q.get(k) || h.get(k) || '';
  const deviceToken = get('device') || get('deviceToken');
  if (deviceToken) return { mode: 'device', deviceToken };
  const sessionId = get('session') || get('sessionId');
  const token = get('token');
  return sessionId && token ? { mode: 'session', sessionId, token } : null;
}

/** `code`: the server's standard error code (Dual-Screen mandate §104) — the display reacts to it, never to the words. */
export class DisplayApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}
/** A check-in refusal that carries a safe structured body — the walk-in confirm's fresh preview (SUNMI guide 4A:
 *  WALK_IN_SELECTION_CHANGED / WALK_IN_SERVICE_UNAVAILABLE). */
export class CheckInApiError extends DisplayApiError {
  constructor(status: number, message: string, code: string | undefined, public details: { preview?: import('@aipowersalon/api-contracts/customer').WalkInPreview } | null) { super(status, message, code); }
}

// Resolution order: build-time VITE_API_BASE (separate-origin deploy), runtime window.APS_API_BASE override, then ""
// (same-origin — the default, since the display device is normally served behind the API).
export const API_BASE = ((import.meta as any).env?.VITE_API_BASE as string) || (typeof window !== 'undefined' && (window as any).APS_API_BASE) || '';
/** BUILD_PLAN Phase 12 (Constitution 5 #57): API_BASE + /api/v1 + path — the ONE way the display spells an API address
 *  (pictures under /media stay where they are: @aipowersalon/api-client apiV1Path). Displays already in the field keep
 *  calling the legacy paths, which the API still serves. */
export function apiUrl(path: string): string { return buildApiUrl(API_BASE, path); }
const sessBase = (sessionId: string) => apiUrl(`/customer-display/checkout/${encodeURIComponent(sessionId)}`);
const devBase = apiUrl('/customer-display/device');

async function parse(res: Response): Promise<any> {
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new DisplayApiError(res.status, body?.message || res.statusText, typeof body?.code === 'string' ? body.code : undefined);
  return body;
}

export async function fetchState(c: Creds): Promise<CustomerDisplayState> {
  if (c.mode === 'device') return parse(await fetch(`${devBase}/current`, { headers: { 'x-device-token': c.deviceToken } }));
  return parse(await fetch(sessBase(c.sessionId), { headers: { 'x-display-token': c.token } }));
}

export async function submitTip(c: Creds, body: TipSubmission): Promise<CustomerDisplayState> {
  if (c.mode === 'device') return parse(await fetch(`${devBase}/tip`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': c.deviceToken }, body: JSON.stringify(body) }));
  return parse(await fetch(`${sessBase(c.sessionId)}/tip`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-display-token': c.token }, body: JSON.stringify(body) }));
}

// customer_pays mode: the customer chooses how they'll pay (card vs cash). This recomputes their total — card adds the
// salon's surcharge, cash doesn't — and tells the front desk which method to complete the sale with.
export async function submitMethod(c: Creds, method: 'card' | 'cash'): Promise<CustomerDisplayState> {
  if (c.mode === 'device') return parse(await fetch(`${devBase}/method`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': c.deviceToken }, body: JSON.stringify({ method }) }));
  return parse(await fetch(`${sessBase(c.sessionId)}/method`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-display-token': c.token }, body: JSON.stringify({ method }) }));
}

// post-payment: the guest taps a 1–5 satisfaction score on the thank-you screen. Persists to the ticket; the
// front desk's Service Done "Customer Satisfaction" KPI averages today's rated tickets.
export async function submitRating(c: Creds, rating: number): Promise<CustomerDisplayState> {
  if (c.mode === 'device') return parse(await fetch(`${devBase}/rating`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': c.deviceToken }, body: JSON.stringify({ rating }) }));
  return parse(await fetch(`${sessBase(c.sessionId)}/rating`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-display-token': c.token }, body: JSON.stringify({ rating }) }));
}

// customer_pays mode: the customer confirms payment on the device. No card data is collected here — the actual charge is
// completed by the front desk / paired terminal on the POS; the kiosk then mirrors completion from the ticket status.
/** BUILD_PLAN Phase 3: the customer types the phone-change code staff asked for on THIS display (device mode only). */
export async function submitPhoneCode(c: Creds, code: string): Promise<{ ok: boolean; message: string }> {
  if (c.mode !== 'device') throw new DisplayApiError(400, 'Codes are entered on a paired display.');
  return parse(await fetch(`${devBase}/phone-code`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': c.deviceToken }, body: JSON.stringify({ code }) }));
}

export async function requestPayment(c: Creds): Promise<CustomerDisplayState> {
  if (c.mode === 'device') return parse(await fetch(`${devBase}/pay`, { method: 'POST', headers: { 'x-device-token': c.deviceToken } }));
  return parse(await fetch(`${sessBase(c.sessionId)}/pay`, { method: 'POST', headers: { 'x-display-token': c.token } }));
}

// 23-inch spec §43–§46: after its 3 seconds on the completed checkout, a DEVICE display releases it so the server ends
// the session — no later fetch, reconnect or restart can show that customer again. Session-mode (one-off) displays have
// nothing to release; they only clear locally.
export async function releaseCompleted(c: Creds, sessionId: string): Promise<CustomerDisplayState | null> {
  if (c.mode !== 'device') return null;
  return parse(await fetch(`${devBase}/release`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': c.deviceToken }, body: JSON.stringify({ sessionId }) }));
}

export function streamUrl(c: Creds): string {
  if (c.mode === 'device') return `${devBase}/stream`;                      // the credential rides the header (streamSource)
  return `${sessBase(c.sessionId)}/stream?token=${encodeURIComponent(c.token)}`;
}
/** The realtime stream's transport: a paired display's stream carries its credential in a HEADER (a fetch-based stream);
 *  a one-off session display uses the browser's EventSource. */
export function streamSource(c: Creds): ((path: string) => EventSource) | undefined {
  if (c.mode !== 'device') return undefined;
  return (path: string) => new HeaderEventSource(path, { 'x-device-token': c.deviceToken }) as unknown as EventSource;
}

// ── 23-inch spec §97–§98: the receipt the customer chooses after paying (`auto`: they walked away — the salon's default) ──
export async function submitReceipt(c: Creds, choice: DisplayReceiptSubmission['choice']): Promise<CustomerDisplayState> {
  const body = JSON.stringify({ choice } satisfies DisplayReceiptSubmission);
  if (c.mode === 'device') return parse(await fetch(`${devBase}/receipt`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': c.deviceToken }, body }));
  return parse(await fetch(`${sessBase(c.sessionId)}/receipt`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-display-token': c.token }, body }));
}

// ── 23-inch spec §85–§86: the heartbeat (mode, app version, screen, profile); the answer says whether it is in maintenance ──
export async function sendHeartbeat(c: Creds, hb: DisplayHeartbeat & DeviceHealthFacts): Promise<DisplayHeartbeatAck> {
  if (c.mode !== 'device') return { maintenance: false };
  return parse(await fetch(`${devBase}/heartbeat`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': c.deviceToken }, body: JSON.stringify(hb) }));
}

// ── 23-inch spec §8–§12: a display with no credential pairs itself. Public; the code means nothing until staff claim it ──
const pairBase = apiUrl('/customer-display/pairing');
export async function startPairing(platform: DisplayPlatform): Promise<DisplayPairingStart> {
  return parse(await fetch(pairBase, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform }), cache: 'no-store' }));
}
export async function pollPairing(p: Pick<DisplayPairingStart, 'pairingId' | 'pollSecret'>): Promise<DisplayPairingPoll> {
  return parse(await fetch(`${pairBase}/${encodeURIComponent(p.pairingId)}/poll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pollSecret: p.pollSecret }), cache: 'no-store' }));
}

// ── 23-inch spec §47–§74, §108: the salon's advertising for THIS display (device mode only) ──────────────────────────
// Tenant, branch and device are the server's to decide from the device token; a one-off session display has no ads.
export async function fetchAdPlaylist(c: Creds): Promise<CustomerDisplayAdPlaylist> {
  if (c.mode !== 'device') throw new DisplayApiError(400, 'Advertising needs a paired display.');
  return parse(await fetch(`${devBase}/ads`, { headers: { 'x-device-token': c.deviceToken }, cache: 'no-store' }));
}
/** §108: which ads were ON SCREEN and for how long ("displays" — never "views"). A resent batch id counts once. */
export async function postAdDisplays(c: Creds, report: CustomerDisplayAdDisplayReport): Promise<{ accepted: number; duplicate: boolean }> {
  if (c.mode !== 'device') return { accepted: 0, duplicate: false };
  return parse(await fetch(`${devBase}/ads/displays`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': c.deviceToken }, body: JSON.stringify(report) }));
}
/** A media address the display can load: absolute (object storage / CDN) as is, a server path behind API_BASE. */
export function mediaUrl(u: string): string {
  if (/^https?:\/\//i.test(u) || u.startsWith('blob:') || u.startsWith('data:')) return u;
  return apiUrl(u.startsWith('/') ? u : '/' + u);
}

