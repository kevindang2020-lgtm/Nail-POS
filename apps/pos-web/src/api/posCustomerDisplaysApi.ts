// posCustomerDisplaysApi.ts — the salon's customer displays and POS registers (23-inch dual-screen spec §8–§12, §81–§86,
// §122–§125). Reading and Refresh Display need pos.customer_display.operate (the front desk); pairing, renaming, register
// assignment, maintenance, revoking and registers need pos.customer_display.manage (the owner) — enforced server-side.
// Types come from the contracts (§15), never copied.
import type { PosCustomerDisplaysState, PosDisplayDeviceUpdate, PosDisplayDeviceView, PosDisplayRefreshResult, PosPairDisplayInput, PosStationView } from '@aipowersalon/api-contracts/tenant';
import { api } from './client';

export type { PosCustomerDisplaysState, PosDisplayDeviceView, PosStationView };
const BASE = '/pos/customer-displays';
const id = (s: string) => encodeURIComponent(s);

export const posCustomerDisplaysApi = {
  state: () => api.get<PosCustomerDisplaysState>('/pos/customer-displays'),
  pair: (body: PosPairDisplayInput) => api.post<PosDisplayDeviceView>(`${BASE}/pair`, body as unknown as Record<string, unknown>),
  update: (deviceId: string, body: PosDisplayDeviceUpdate) => api.patch<PosDisplayDeviceView>(`${BASE}/${id(deviceId)}`, body as unknown as Record<string, unknown>),
  revoke: (deviceId: string) => api.post<{ revoked: true; endedSessionIds: string[] }>(`${BASE}/${id(deviceId)}/revoke`),
  refresh: (deviceId: string) => api.post<PosDisplayRefreshResult>(`${BASE}/${id(deviceId)}/refresh`),
  createStation: (name: string) => api.post<PosStationView>(`${BASE}/stations`, { name }),
  renameStation: (stationId: string, name: string) => api.patch<PosStationView>(`${BASE}/stations/${id(stationId)}`, { name }),
  retireStation: (stationId: string) => api.del<{ retired: true; unassignedDeviceIds: string[] }>(`${BASE}/stations/${id(stationId)}`),
};

// ── this POS workstation's register (§9–§10): a per-workstation choice, remembered per branch on this browser ──────────
const STATION_KEY = 'aps.pos.station.v1';
function readMap(): Record<string, string> {
  try { const v = JSON.parse(localStorage.getItem(STATION_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
export function getThisRegister(branchId: string): string | null { return readMap()[branchId] ?? null; }
export function setThisRegister(branchId: string, stationId: string | null): void {
  const m = readMap();
  if (stationId) m[branchId] = stationId; else delete m[branchId];
  try { localStorage.setItem(STATION_KEY, JSON.stringify(m)); } catch { /* private mode: this tab only */ }
}

/**
 * §10, §81: the display THIS POS uses — the one dedicated to its register; otherwise the branch's shared display (the
 * one already showing the selected customer first, then an online one). Pure: the same rule the server's Send applies.
 */
export function myDisplay(devices: PosDisplayDeviceView[], stationId: string | null, ticketId?: string | null): PosDisplayDeviceView | null {
  const live = devices.filter((d) => !d.awaitingPickup);
  const showing = ticketId ? live.find((d) => d.session?.ticketId === ticketId) : undefined;
  if (showing) return showing;
  // The display Send to Display would use, in the server's own order (display-send-core, §10 "dedicated should be
  // preferred"): this register's dedicated display, then the branch's shared ones — one that can take a customer now
  // (online, in service, nobody else on it) first; else one that is merely in use; else the first, so the card says why.
  const dedicated = stationId ? live.filter((d) => d.stationId === stationId) : [];
  const shared = live.filter((d) => d.pairing === 'shared');
  const usable = (d: PosDisplayDeviceView) => d.online && !d.maintenance;
  const free = (d: PosDisplayDeviceView) => usable(d) && !d.session;
  return dedicated.find(free) ?? shared.find(free) ?? dedicated.find(usable) ?? shared.find(usable) ?? dedicated[0] ?? shared[0] ?? null;
}

// ── §122–§125: the customer display on this computer's SECOND monitor ──────────────────────────────────────────────────
/** Where the customer display app is served (VITE_CUSTOMER_DISPLAY_URL, or window.APS_CUSTOMER_DISPLAY_URL). */
export function customerDisplayUrl(): string | null {
  const u = ((import.meta as any).env?.VITE_CUSTOMER_DISPLAY_URL as string) || (typeof window !== 'undefined' && (window as any).APS_CUSTOMER_DISPLAY_URL) || '';
  return u ? String(u) : null;
}
export type OpenDisplayResult = 'second-screen' | 'window' | 'blocked';
type Area = { left: number; top: number; width: number; height: number };
/** The window-management permission's state, WITHOUT prompting ('unsupported' where the browser has no such API). */
async function placementPermission(): Promise<'granted' | 'prompt' | 'denied' | 'unsupported'> {
  if (typeof (window as any).getScreenDetails !== 'function') return 'unsupported';
  try { return (await navigator.permissions.query({ name: 'window-management' as PermissionName })).state; } catch { return 'unsupported'; }
}
/** The other monitor's usable area (prompts when the permission is not yet decided). */
async function secondScreen(): Promise<Area | null> {
  const details = await (window as any).getScreenDetails();
  const screens: any[] = details?.screens || [];
  const other = screens.find((s) => s !== details.currentScreen && !s.isPrimary) || screens.find((s) => s !== details.currentScreen);
  return other ? { left: other.availLeft, top: other.availTop, width: other.availWidth, height: other.availHeight } : null;
}
const within = <T,>(p: Promise<T>, ms: number): Promise<T | null> => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
/**
 * Opens the customer display in its own window — on the second monitor where the browser can place it (the Window
 * Management API, which needs the user's permission once), otherwise as an ordinary window to drag there. The window is
 * opened at once, inside the click (a browser blocks a window opened later); where the permission is still undecided the
 * browser asks, and the window is moved to the second monitor if the user allows it (`onPlaced`). The display then asks
 * for one tap to go full screen (browsers allow full screen only from a touch or click). Placement is never assumed.
 */
export async function openCustomerDisplayWindow(url: string, onPlaced?: () => void): Promise<OpenDisplayResult> {
  const perm = await placementPermission();
  const target = perm === 'granted' ? await within(secondScreen().catch(() => null), 2_000) : null;
  const features = target ? `popup=yes,left=${target.left},top=${target.top},width=${target.width},height=${target.height}` : 'popup=yes,width=1280,height=720';
  const win = window.open(url, 'aps-customer-display', features);
  if (!win) return 'blocked';
  if (target) return 'second-screen';
  if (perm === 'prompt') {
    void within(secondScreen().catch(() => null), 60_000).then((t) => {
      if (!t) return;
      try { win.moveTo(t.left, t.top); win.resizeTo(t.width, t.height); onPlaced?.(); } catch { /* the user moves it */ }
    });
  }
  return 'window';
}
