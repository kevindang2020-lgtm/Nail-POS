// realtime.ts — BUILD_PLAN Phase 13 (Constitution 6 §28–32, audit bug 1): what each app's realtime client opens.
//
// Web: the relative /api/v1 stream path; the browser's EventSource sends the realm's httpOnly cookie.
// Native: no cookie exists in the Capacitor shell and EventSource cannot send an Authorization header, so before EVERY
// (re)connect: POST /realtime/stream-ticket with the bearer → a single-use 60-second ticket → the ABSOLUTE stream URL
// `<base>/api/v1/<realm>/stream?ticket=…&device=…`. The bearer token never appears in a URL.
//
// `bindRealtimeToSession(client)` ends the stream on sign-out (`signalSignedOut()`, called by each app's logout) and on
// a dead session (`aps:unauthorized`): a logged-out phone keeps no live channel to the salon.
import { STREAM_TICKET_PATH, type StreamTicketResponse } from '@aipowersalon/api-contracts';
import { deviceId } from '../native-auth';
import { isNativePlatform } from '../capacitor-adapters';
import type { Transport } from './transport';

export const SIGNED_OUT_EVENT = 'aps:signed-out';

/** The `streamUrl` resolver for @aipowersalon/realtime-client's createRealtimeClient. */
export function realtimeStreamUrl(t: Transport, streamPath: string, o: { native?: () => boolean } = {}): () => Promise<string> {
  const native = o.native ?? isNativePlatform;
  return async () => {
    if (!native()) return t.apiUrl(streamPath);
    const { ticket } = await t.post<StreamTicketResponse>(STREAM_TICKET_PATH, undefined, { timeout: 'FAST' });
    const device = await deviceId();
    return t.apiUrl(streamPath, { ticket, ...(device ? { device } : {}) });
  };
}

/** Announce that this app signed out (each app's logout calls it after the server call). */
export function signalSignedOut(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SIGNED_OUT_EVENT));
}

/** Disconnect `client` when the user signs out or the session dies. Returns an unbind. */
export function bindRealtimeToSession(client: { disconnect(): void }): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const end = () => { try { client.disconnect(); } catch { /* already closed */ } };
  window.addEventListener(SIGNED_OUT_EVENT, end);
  window.addEventListener('aps:unauthorized', end);
  return () => { window.removeEventListener(SIGNED_OUT_EVENT, end); window.removeEventListener('aps:unauthorized', end); };
}
