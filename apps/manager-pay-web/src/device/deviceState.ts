// deviceState.ts — Secure Tap to Pay M6-4: what the app knows about THIS phone's standing with the salon, shared by the
// API client (which learns it from responses) and the screens (which show it).
//   removed  — the owner revoked this phone (DEVICE_REVOKED). Persisted: the app stays locked to the "removed" screen
//              across relaunches until staff choose to set the phone up again (a NEW device, owner approval).
//   pending  — registered and waiting for the owner's approval (registration answer or DEVICE_PENDING_APPROVAL).
//   active   — approved. unknown — not known yet (no registration answer).
import { useSyncExternalStore } from 'react';

export type DeviceStanding = 'unknown' | 'active' | 'pending' | 'suspended' | 'removed';
const REMOVED_KEY = 'aps_pay_device_removed';

function readRemoved(): boolean { try { return globalThis.localStorage?.getItem(REMOVED_KEY) === '1'; } catch { return false; } }

let standing: DeviceStanding = readRemoved() ? 'removed' : 'unknown';
const subs = new Set<() => void>();
const emit = () => { for (const s of subs) s(); };

export function getDeviceStanding(): DeviceStanding { return standing; }
export function setDeviceStanding(s: DeviceStanding): void {
  if (standing === 'removed' && s !== 'removed') return;   // only clearRemoved() leaves the removed lock (a staff action)
  if (s === 'removed') { try { globalThis.localStorage?.setItem(REMOVED_KEY, '1'); } catch { /* the in-memory lock still holds */ } }
  if (s === standing) return;
  standing = s; emit();
}
/** Staff chose "Set up this phone again": the lock lifts; the next registration is a brand-new device. */
export function clearRemoved(): void {
  try { globalThis.localStorage?.removeItem(REMOVED_KEY); } catch { /* fine */ }
  standing = 'unknown'; emit();
}
/** The server's device status (register / heartbeat answers) → standing. */
export function standingFromStatus(status: string | null | undefined): DeviceStanding {
  if (status === 'active') return 'active';
  if (status === 'pending') return 'pending';
  if (status === 'disabled') return 'suspended';
  if (status === 'revoked' || status === 'compromised') return 'removed';
  return 'unknown';
}
export function useDeviceStanding(): DeviceStanding {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, getDeviceStanding, getDeviceStanding);
}
/** Tests only. */
export function resetDeviceStandingForTests(): void { standing = readRemoved() ? 'removed' : 'unknown'; emit(); }
