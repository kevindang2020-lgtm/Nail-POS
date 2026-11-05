/**
 * branch-device-core.ts — pure, DB-free rules for allocating a device to a branch (§36).
 *
 * Devices live across category tables. Payment terminals, customer displays, and check-in kiosks carry a branch_id and
 * can be allocated to a branch; leased hardware has no branch_id and is therefore NOT branch-allocatable (shown for
 * visibility, never assigned). These helpers validate the request and gate the allocatable categories; the repository
 * resolves the device against the REAL row in the branch's own tenant (server-derived). Pure → unit-tested.
 */

export type DeviceCategory = 'terminal' | 'display' | 'kiosk' | 'hardware';
export const ALLOCATABLE_CATEGORIES: DeviceCategory[] = ['terminal', 'display', 'kiosk'];
export function isAllocatable(category: string): category is DeviceCategory { return (ALLOCATABLE_CATEGORIES as string[]).includes(category); }

export interface AllocateDeviceInput { deviceId?: unknown; category?: unknown; }
export interface AllocateDeviceValue { deviceId: string; category: DeviceCategory; }
export type AllocateDeviceValidation = { ok: true; value: AllocateDeviceValue } | { ok: false; errors: string[] };

const s = (v: unknown): string => (v == null ? '' : String(v)).trim();

export function validateAllocateDevice(input: AllocateDeviceInput | undefined): AllocateDeviceValidation {
  const i = input || {};
  const errors: string[] = [];
  const deviceId = s(i.deviceId);
  if (!deviceId) errors.push('A device must be selected.');
  const category = s(i.category).toLowerCase();
  if (!category) errors.push('A device category is required.');
  else if (!isAllocatable(category)) errors.push('That device type cannot be allocated to a branch.');
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { deviceId, category: category as DeviceCategory } };
}
