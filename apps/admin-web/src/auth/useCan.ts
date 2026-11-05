// useCan.ts — SCAN (Oct 12 2026): a screen skips a SECONDARY read its platform role cannot make. The real-browser run of
// every route as each platform role found screens whose side panels (analytics strips, app flags, sync conflicts, voice
// fleet …) asked endpoints of another domain on every visit — 403 after 403, each one a console error. The backend stays
// the authority (PlatformDomainGuard); this only stops asking for what the role will be refused.
// No principal (a screen rendered outside the auth provider, e.g. in a unit test) → allowed: the server decides.
import { useAuth } from './AuthContext';
export function useCan(): (key: string) => boolean {
  const { principal } = useAuth();
  return (key: string) => !principal || !!principal.permissions?.includes(key);
}
