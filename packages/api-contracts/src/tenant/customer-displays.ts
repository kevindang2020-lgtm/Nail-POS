// customer-displays.ts — 23-inch dual-screen spec §9–§10, §81–§86, §123–§124: the salon's customer displays and POS
// registers as the POS sees them (Devices → Customer Displays, and the display card on Checkout). Realm: tenant.
import type { DisplayDeviceState, DisplayProfile, DisplayReportedMode } from '../display-device-rules';

/** A POS register. A display dedicated to it (§10 DEDICATED) is used by its Send to Display first. */
export interface PosStationView { id: string; name: string; branchId: string }

/** One customer display, everything §86 lists. */
export interface PosDisplayDeviceView {
  deviceId: string;
  name: string;
  branchId: string | null;
  branchName: string | null;
  /** §10: DEDICATED to one register, or SHARED by the branch's registers. */
  pairing: 'dedicated' | 'shared';
  stationId: string | null;
  stationName: string | null;
  /** §85 — worked out on the server (displayDeviceState). */
  state: DisplayDeviceState;
  online: boolean;
  maintenance: boolean;
  lastSeenAt: string | null;
  mode: DisplayReportedMode | null;
  appVersion: string | null;
  screen: { width: number; height: number; pixelRatio: number } | null;
  profile: DisplayProfile | null;
  /** The checkout on it now — staff-facing (§81 "Showing Sophia's checkout"): the first name and ticket number only. */
  session: { sessionId: string; ticketId: string; ticketNumber: string; customerFirstName: string | null; state: string } | null;
  pairedAt: string | null;
  /** Claimed in the POS, but the display has not collected its credential yet (it is still showing its code). */
  awaitingPickup: boolean;
}

/** GET /pos/customer-displays — the signed-in branch's displays and registers. `canManage`: this user may pair, rename,
 *  assign, put in maintenance, revoke and edit registers (the server enforces it; the POS only hides what it can't do). */
export interface PosCustomerDisplaysState { branchId: string; devices: PosDisplayDeviceView[]; stations: PosStationView[]; canManage: boolean }
/** POST /pos/customer-displays/:id/refresh — `online: false` means the display is not connected to hear it. */
export interface PosDisplayRefreshResult { requested: true; online: boolean }

/** POST /pos/customer-displays/pair — the code the display shows, a name, and (optionally) the register it serves. */
export interface PosPairDisplayInput { code: string; name: string; stationId?: string | null }
/** PATCH /pos/customer-displays/:id */
export interface PosDisplayDeviceUpdate { name?: string; stationId?: string | null; maintenance?: boolean }
