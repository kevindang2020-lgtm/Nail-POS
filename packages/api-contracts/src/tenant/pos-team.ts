// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export interface TeamUser { id: string; name: string; email: string | null; role: string; status: string; avatarUrl: string | null; branchId: string | null; lastLoginAt: string | null; mfaEnabled: boolean; createdAt: string | null; isYou: boolean }

export interface RoleSummary { role: string; permissionCount: number; userCount: number }

export interface TeamResult { users: TeamUser[]; roles: RoleSummary[]; summary: { total: number; active: number; admins: number } }

// ===== Team Management page state (the rich 1:1 dashboard) — real data only, fail-soft per query. =====
export interface TeamMemberRow {
  employeeId: string; userId: string; technicianId: string | null; name: string; email: string | null; phone: string | null; avatarUrl: string | null;
  role: string; roleLevel: string | null; department: string; shift: string | null; status: string;
  performanceScore: number | null; performanceLabel: string | null;
  servicesCount: number; revenueCents: number; commissionCents: number; isProvider: boolean;
}

export interface TeamPagination { page: number; pageSize: number; totalItems: number; totalPages: number }

export interface POSTeamState {
  kpis: { totalMembers: number; activeToday: number; onShiftNow: number; avgPerformance: number; totalServices: number; totalCommissionCents: number; pendingApprovals: number; openPositions: number };
  rows: { items: TeamMemberRow[]; pagination: TeamPagination };
  tabs: { id: string; label: string; count: number }[];
  facets: { roles: string[]; statuses: string[]; shifts: string[]; departments: string[] };
  attendance: { status: string; count: number }[];
  performance: { overall: number; distribution: { label: string; count: number }[] };
  topPerformers: { employeeId: string; name: string; avatarUrl: string | null; score: number }[];
  birthdays: { employeeId: string; name: string; avatarUrl: string | null; date: string }[];
  shiftOverview: { label: string; time: string; members: number; present: number; presentLabel: string }[];
  productivity: { servicesCompleted: number; revenueCents: number; commissionCents: number };
  approvals: { type: string; label: string; count: number }[];
  training: { certificationsExpiring: number; trainingInProgress: number; newTrainings: number };
  trends: { members: number | null; performance: number | null; services: number | null; commission: number | null; prodServices: number | null; prodRevenue: number | null; prodCommission: number | null };
}

// Employee profile (Overview) — real data for the drawer opened from a table row.
export interface TeamMemberDetail {
  userId: string; technicianId: string | null; employeeId: string; name: string; email: string | null; phone: string | null; avatarUrl: string | null;
  role: string; roleLevel: string | null; department: string; status: string; shift: string | null; isProvider: boolean;
  hireDate: string | null; branchId: string | null;
  performanceScore: number | null; performanceLabel: string | null; reviewCount: number;
  servicesCount: number; revenueCents: number; commissionCents: number;
  skills: string[];
  access: { lastLoginAt: string | null; mfaEnabled: boolean; accountStatus: string };
}
