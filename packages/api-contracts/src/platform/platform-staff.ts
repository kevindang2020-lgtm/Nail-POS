// platform-staff.ts — wire contract (Constitution 13 §15). Realm: platform. Constitution 7 §24–§26: platform accounts.
export interface PlatformStaffRow { userId: string; email: string | null; fullName: string | null; platformRole: string | null; status: string; lastLoginAt: string | null }
export interface PlatformStaffList { rows: PlatformStaffRow[] }
export interface PlatformRoleChangeResult { ok: true; userId: string; from: string | null; to: string; sessionsRevoked: boolean }
