// apiBase.ts — where the POS finds its API, and the ONE way it spells an API URL (BUILD_PLAN Phase 12, Constitution 5 #57).
// Resolution order: build-time VITE_API_BASE (the API on a separate origin), then a runtime window.APS_API_BASE override,
// then "" (same origin — each dist/ served behind the API or a proxy). Every call goes to /api/v1/<path>
// (@aipowersalon/api-client apiV1Path); the paths that stay put (/auth/refresh, /media, /platform/branding …) are kept
// by that helper. Its own module so a test that mocks ./client still gets real URLs from the domain clients.
import { buildApiUrl } from '@aipowersalon/api-client';

export const API_ORIGIN: string = ((import.meta as any).env?.VITE_API_BASE as string) || (typeof window !== 'undefined' && (window as any).APS_API_BASE) || '';

/** API_ORIGIN + /api/v1 + path (+ query). */
export function apiUrl(path: string, query?: Record<string, unknown>): string {
  return buildApiUrl(API_ORIGIN, path, query);
}
