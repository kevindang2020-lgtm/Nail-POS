// http.ts — the SDK's seam to the app's API client (Constitution 13 §89, §108).
//
// faceid.ts, webauthn.ts and native-bootstrap.ts need `api.get/post` and `apiBase()`. Each app owns its API client
// (they have drifted; consolidating them is a later Phase 5 step), so the SDK does not import one — the app injects
// its client once at start-up, exactly as it injects the secure store. The SDK never reaches into an app (§7).
export interface SdkHttp {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
}
let http: SdkHttp | null = null;
let base: (() => string) | null = null;

/** Call once at app start, before any SDK auth function. */
export function configureMobileSdk(o: { http: SdkHttp; apiBase: () => string }): void { http = o.http; base = o.apiBase; }
export function sdkHttp(): SdkHttp {
  if (!http) throw new Error('mobile-sdk: configureMobileSdk({ http, apiBase }) has not been called');
  return http;
}
export function sdkApiBase(): string {
  if (!base) throw new Error('mobile-sdk: configureMobileSdk({ http, apiBase }) has not been called');
  return base();
}
/** Test/reset helper. */
export function resetMobileSdkHttp(): void { http = null; base = null; }
