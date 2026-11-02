// goCheckInApi.ts — the customer-display app's client for the guest check-in (the public Go Check-In session routes,
// modules/queue/src/go-check-in/go-check-in.public.controller.ts). Mirrors api.ts conventions: same API_BASE resolution,
// same JSON/error handling.
//
// 23-inch spec §8, §12, §18 (Unit 7): ONE device identity. The display starts each guest's session with ITS OWN
// credential (POST /customer-display/device/check-in/session, x-device-token) — the salon and branch are the display's;
// no Go Check-In kiosk has to exist anywhere. It then drives the session routes with the per-session token in the
// `x-checkin-token` header; tenant/branch stay server-derived.
import { apiUrl, DisplayApiError } from './api';

const base = apiUrl('/go-check-in');

// The kiosk's wire types are @aipowersalon/api-contracts/customer's — the API returns the same definitions (Constitution 13 §15).
import type {
  AppointmentToday, CheckInConfirmation, DisplayCheckInSession, KioskServiceOption, KioskTechnicianOption, LookupResult,
} from '@aipowersalon/api-contracts/customer';

// ---- contract (the backend is the source of truth) ----
/** §22–§23: one of the BRANCH's services, with its price; add-ons (§20) flagged. */
export type KioskService = KioskServiceOption;
/** §25: a technician working today at this branch and qualified for the chosen services (first name; "From 2:00 PM"). */
export type KioskTechnician = KioskTechnicianOption;
/** §20–§24: the walk-in. `serviceIds` are the services; `addOnIds` go with the first of them. */
export interface WalkInInput { customerId?: string; customerName: string; phone?: string; serviceIds: string[]; addOnIds?: string[]; technicianId?: string; notes?: string }

export interface Session { sessionId: string; token: string }

async function parse(res: Response): Promise<any> {
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new DisplayApiError(res.status, body?.message || res.statusText, typeof body?.code === 'string' ? body.code : undefined);
  return body;
}
const authGet = (s: Session, path: string) =>
  fetch(`${base}/session/${encodeURIComponent(s.sessionId)}${path}`, { headers: { 'x-checkin-token': s.token }, cache: 'no-store' }).then(parse);
const authPost = (s: Session, path: string, body?: unknown) =>
  fetch(`${base}/session/${encodeURIComponent(s.sessionId)}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-checkin-token': s.token },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).then(parse);

// ---- the session: started with the display's own credential, one per guest ----
export const startDisplaySession = (deviceToken: string): Promise<DisplayCheckInSession> =>
  fetch(apiUrl('/customer-display/device/check-in/session'), { method: 'POST', headers: { 'x-device-token': deviceToken }, cache: 'no-store' }).then(parse);
export const heartbeat = (s: Session): Promise<{ ok?: boolean }> => authPost(s, '/heartbeat');
/** A guest's turn is over: the server ends their session (its lookup and new-profile allowances go with it). */
export const completeSession = (s: Session): Promise<{ ok?: boolean }> => authPost(s, '/complete');

// ---- customer lookup ----
export const lookupPhone = (s: Session, phone: string): Promise<LookupResult> => authPost(s, '/lookup-phone', { phone });
export const confirmCustomer = (s: Session, customerId: string): Promise<LookupResult> => authPost(s, '/confirm-customer', { customerId });
export const createCustomer = (s: Session, input: { firstName?: string; fullName?: string; phone?: string }): Promise<{ customerId: string; firstName: string }> =>
  authPost(s, '/create-customer', input);

// ---- appointment path ----
export const todayAppointments = (s: Session, customerId: string): Promise<{ appointments: AppointmentToday[] }> =>
  authGet(s, `/today-appointments?customerId=${encodeURIComponent(customerId)}`);
export const checkInAppointment = (s: Session, appointmentId: string): Promise<CheckInConfirmation> =>
  authPost(s, '/check-in-appointment', { appointmentId });

// ---- walk-in path ----
export const listServices = (s: Session): Promise<{ services: KioskService[] }> => authGet(s, '/services');
/** §25: asked again as the guest picks services — only those qualified for every chosen service come back. */
export const listTechnicians = (s: Session, serviceIds: string[] = []): Promise<{ technicians: KioskTechnician[] }> =>
  authGet(s, `/technicians${serviceIds.length ? `?serviceIds=${encodeURIComponent(serviceIds.join(','))}` : ''}`);
export const checkInWalkIn = (s: Session, input: WalkInInput): Promise<CheckInConfirmation> => authPost(s, '/check-in-walk-in', input);

// ---- technician time clock (PIN on the display; tenant/branch stay server-derived) ----
export interface TechClockIdentity {
  technicianId: string; technicianName: string | null; avatarUrl: string | null; clockedIn: boolean;
  action: 'clock_in' | 'clock_out'; clockedInAt: string | null; lastClockOutAt: string | null;
  hoursToday: number; serverTime: string;
}
export interface TechClockResult {
  ok: true; action: 'clock_in' | 'clock_out'; technicianName: string | null;
  clockedInAt?: string | null; lastClockOutAt?: string | null; hoursToday?: number; serverTime: string;
}
export const technicianIdentify = (s: Session, pin: string): Promise<TechClockIdentity> => authPost(s, '/technician/identify', { pin });
export const technicianClockIn = (s: Session, pin: string, idempotencyKey?: string): Promise<TechClockResult> => authPost(s, '/technician/clock-in', { pin, ...(idempotencyKey ? { idempotencyKey } : {}) });
export const technicianClockOut = (s: Session, pin: string, idempotencyKey?: string): Promise<TechClockResult> => authPost(s, '/technician/clock-out', { pin, ...(idempotencyKey ? { idempotencyKey } : {}) });

// ---- status ----
export const placeInLine = (s: Session, checkInId: string): Promise<{ position: number; waitingAhead: number } | null> => authGet(s, `/place-in-line?checkInId=${encodeURIComponent(checkInId)}`);

export const usd = (cents: number): string => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
