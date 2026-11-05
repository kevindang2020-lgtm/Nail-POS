// usePermissions.ts — client-side permission check for hiding actions the current role cannot use.
// The server still enforces every action; this only avoids showing a control that would be denied.
// Fails OPEN when the permission set is unknown (no session yet / rendered outside AuthProvider in a
// test), so components don't hide everything before auth resolves — the server remains the real gate.
import { useAuth } from '../auth/AuthContext';

export function useCan(): (permission: string) => boolean {
  const { principal } = useAuth();
  const perms = principal?.permissions;
  return (permission: string) => !Array.isArray(perms) || perms.includes(permission);
}
