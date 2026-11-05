// posTimeClockApi.ts — technician time clock (pos.technicians.view read, pos.technicians.manage write).
import { api } from "./client";
import type { TimeClockStateQuery, TimeClockBreakPolicyView as BreakPolicyView, TimeClockBreakPolicyValues as BreakPolicyValues, TimeClockBreakAdjustResult } from "@aipowersalon/api-contracts/tenant";
export const posTimeClockApi = {
  // 200-technician §2: one page of the roster (page / pageSize / search / state); no arguments = every row (legacy)
  state: (q: TimeClockStateQuery = {}) => api.get(`/pos/time-clock/state`, Object.fromEntries(Object.entries(q).filter(([, v]) => v != null && v !== ''))),
  clockIn: (technicianId: string) => api.post(`/pos/time-clock/clock-in`, { technicianId }),
  clockOut: (technicianId: string) => api.post(`/pos/time-clock/clock-out`, { technicianId }),
  // Breaks (merge Oct 12, WF 580): workforce clock ON_BREAK → queue BREAK; pos.technicians.manage_status. Lunch is a kind.
  breakStart: (technicianId: string, kind: 'break' | 'lunch' = 'break') => api.post(`/pos/time-clock/break-start`, { technicianId, kind }),
  breakEnd: (technicianId: string) => api.post(`/pos/time-clock/break-end`, { technicianId }),
  // Set/reset a technician's 4-digit kiosk Clock PIN (Go Check-In self clock-in). Server validates format + weak-PIN.
  resetClockPin: (technicianId: string, pin: string) => api.post(`/pos/technician-clock/technicians/${encodeURIComponent(technicianId)}/clock-pin/reset`, { pin }),
  // Correct a punch's clock-in/out times (append-only trail + reason). shiftId is a technician_shifts row id.
  adjustTimecard: (shiftId: string, body: { startTime?: string; endTime?: string; reason: string }) => api.post(`/pos/technician-clock/timecards/${encodeURIComponent(shiftId)}/adjust`, body),
  // Fair Turn §35–40 (migration 603): a break cut short by work, the salon's break policy (paid / unpaid classification)
  // and a manager's correction of one break (append-only trail + reason, re-classified under the policy).
  breakInterrupt: (technicianId: string, reason: string) => api.post(`/pos/time-clock/break-interrupt`, { technicianId, reason }),
  breakPolicy: () => api.get<BreakPolicyView>(`/pos/time-clock/break-policy`),
  saveBreakPolicy: (body: { scope: 'salon' | 'branch'; policy: Partial<BreakPolicyValues>; reason?: string }) => api.put<BreakPolicyView>(`/pos/time-clock/break-policy`, body),
  adjustBreak: (breakId: string, body: { startedAt?: string; endedAt?: string; reason: string }) => api.post<TimeClockBreakAdjustResult>(`/pos/technician-clock/breaks/${encodeURIComponent(breakId)}/adjust`, body),
};
export type { TimeClockBreakPolicyView as BreakPolicyView } from '@aipowersalon/api-contracts/tenant';
