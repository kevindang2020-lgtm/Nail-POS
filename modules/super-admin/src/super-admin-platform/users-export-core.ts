// users-export-core.ts — pure shaping for the server-side audited users export (§ export job). Reuses the canonical
// injection-guarded CSV builder (toCsv) so a cell beginning with = + - @ can't become a spreadsheet formula. Honest
// rendering: gaps render as "—" / "Never", never blank-but-meaningful or fabricated.
import { toCsv } from '@aipowersalon/reports';

export const USERS_EXPORT_HEADERS = ['User', 'Email', 'Role', 'Tenant', 'Branch', 'Status', 'Permission Level', 'MFA', 'Last Active', 'Assigned Devices'];

export interface ExportableUser {
  fullName?: string; email?: string; role?: string; tenantName?: string | null; branchName?: string | null;
  status?: string; permissionLevel?: string | null; mfaEnabled?: boolean; lastLoginAt?: string | null; assignedDevices?: number;
}

export function userExportRow(u: ExportableUser): (string | number)[] {
  return [
    u.fullName || '—', u.email || '—', u.role || '—', u.tenantName || '—', u.branchName || '—',
    u.status || '—', u.permissionLevel || '—', u.mfaEnabled ? 'Enabled' : 'Disabled',
    u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : 'Never', Number(u.assignedDevices || 0),
  ];
}

export function usersExportCsv(users: ExportableUser[]): string {
  return toCsv(USERS_EXPORT_HEADERS, users.map(userExportRow));
}

export function usersExportFilename(now: Date = new Date()): string {
  return `users-export-${now.toISOString().slice(0, 10)}.csv`;
}
