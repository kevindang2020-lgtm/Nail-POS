// auto-logout.dto.ts — AIPowerSalon POS "Auto Logout at Store Closing Time".
// Endpoints derive tenantId/branchId/userId/role from the authenticated session — never from the client.
// Times are stored 24-hour (HH:mm); the UI displays 12-hour. Closing is computed in the BRANCH timezone.

export type Weekday = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
export type PosRole = "OWNER" | "MANAGER" | "ADMIN" | "RECEPTION" | "FRONT_DESK" | "TECH" | "SUPER_ADMIN";

export interface DayStoreHour {
  isOpen: boolean;
  closeTime: string | null; // "HH:mm" 24-hour, or null when not set
}

export interface StoreHours {
  monday: DayStoreHour; tuesday: DayStoreHour; wednesday: DayStoreHour; thursday: DayStoreHour;
  friday: DayStoreHour; saturday: DayStoreHour; sunday: DayStoreHour;
}

// ---- GET /pos/session/auto-logout-status ----

// ---- PATCH /pos/settings/store-hours-auto-logout ----  (OWNER/MANAGER/ADMIN/SUPER_ADMIN)

// ---- POST /pos/session/extend-after-close ----

export const DEFAULT_SETTINGS = {
  autoLogoutEnabled: true,
  warningMinutes: [30, 15, 5],
  gracePeriodMinutes: 0,
  storeHours: {
    monday: { isOpen: true, closeTime: "19:30" },
    tuesday: { isOpen: true, closeTime: "19:30" },
    wednesday: { isOpen: true, closeTime: "19:30" },
    thursday: { isOpen: true, closeTime: "19:30" },
    friday: { isOpen: true, closeTime: "19:30" },
    saturday: { isOpen: true, closeTime: "19:30" },
    sunday: { isOpen: true, closeTime: null as string | null },
  } as StoreHours,
};

// ===== pure helpers (unit-testable, no external deps) =====

export function parseHHmm(t: string): { h: number; m: number } | null {
  const mt = /^(\d{1,2}):(\d{2})$/.exec(t || "");
  if (!mt) return null;
  const h = +mt[1], m = +mt[2];
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

// 24h "19:30" -> "7:30 PM"
export function to12Hour(t: string | null): string {
  const p = parseHHmm(t || "");
  if (!p) return "";
  const ap = p.h >= 12 ? "PM" : "AM";
  const hh = p.h % 12 || 12;
  return hh + ":" + (p.m < 10 ? "0" : "") + p.m + " " + ap;
}

// Build the UTC logout instant from a branch-local business date + close time + grace, given the
// branch's UTC offset in minutes (e.g. America/New_York EDT = -240). Returns ISO. The CONTROLLER
// resolves the offset from the IANA timezone (Intl/Luxon) — this fn does the deterministic arithmetic.
export function buildLogoutAtIso(businessDate: string, closeTime: string, graceMinutes: number, tzOffsetMinutes: number): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDate);
  const c = parseHHmm(closeTime);
  if (!d || !c) return null;
  // wall-clock epoch treated as UTC, then shift by -offset to get true UTC, then add grace
  const wallUtc = Date.UTC(+d[1], +d[2] - 1, +d[3], c.h, c.m, 0);
  const trueUtc = wallUtc - tzOffsetMinutes * 60000 + Math.max(0, graceMinutes) * 60000;
  return new Date(trueUtc).toISOString();
}

export function remainingSeconds(currentServerTimeIso: string, logoutAtIso: string | null): number | null {
  if (!logoutAtIso) return null;
  const diff = Date.parse(logoutAtIso) - Date.parse(currentServerTimeIso);
  return Math.max(0, Math.floor(diff / 1000));
}

// which warning level is active right now: the smallest configured threshold the countdown has reached.
// remaining 25m + [30,15,5] -> 30 ; 12m -> 15 ; 4m -> 5 ; 40m -> null
export function pickActiveWarning(remaining: number | null, warningMinutes: number[]): number | null {
  if (remaining == null) return null;
  const crossed = warningMinutes.filter(function (m) { return remaining <= m * 60; });
  if (!crossed.length) return null;
  return Math.min.apply(null, crossed);
}

// SUPER_ADMIN is never controlled by a tenant's closing time. OWNER/ADMIN exempt only if toggled.
// MANAGER exempt unless applyToManagers. RECEPTION/FRONT_DESK always subject to auto logout.
export function isExemptFromAutoLogout(role: PosRole, opts: { exemptOwnerAdmin: boolean; applyToManagers: boolean }): boolean {
  if (role === "SUPER_ADMIN") return true;
  if (role === "OWNER" || role === "ADMIN") return !!opts.exemptOwnerAdmin;
  if (role === "MANAGER") return !opts.applyToManagers;
  return false; // RECEPTION / FRONT_DESK / TECH
}

export function canExtendSession(role: PosRole, allowReceptionExtend: boolean): boolean {
  if (role === "OWNER" || role === "MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN") return true;
  if (role === "RECEPTION" || role === "FRONT_DESK") return !!allowReceptionExtend;
  return false;
}

// settings warning: Sunday open but no close time set
export function needsSundayCloseTime(hours: StoreHours): boolean {
  return !!hours.sunday.isOpen && !hours.sunday.closeTime;
}
