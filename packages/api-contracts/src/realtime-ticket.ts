// realtime-ticket.ts — BUILD_PLAN Phase 13 A (Constitution 6 §28–32, audit bug 1): the native realtime stream ticket.
// POST /realtime/stream-ticket → this; the app then opens GET /api/v1/<realm>/stream?ticket=<ticket>&device=<install id>.
// Single use, `expiresIn` seconds (60), bound to the session, realm, tenant, branch and device. Never a bearer in a URL.
export interface StreamTicketResponse { ticket: string; expiresIn: number }
export const STREAM_TICKET_PATH = '/realtime/stream-ticket';
