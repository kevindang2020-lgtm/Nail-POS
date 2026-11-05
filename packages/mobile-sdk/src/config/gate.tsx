// gate.tsx — BUILD_PLAN Phase 13 B (Constitution 6 §52–57, §219–220): the ONE remote-config gate every store app wraps
// itself in.
//
//   • GET /app-config on launch and again on resume (visibilitychange → visible, at most once a minute), through the app's
//     own API client (configureMobileSdk), so the request carries the transport's X-Client-* headers and the session.
//   • UPDATE_REQUIRED (§55–56) — from /app-config or from ANY API call answered 426 (the transport dispatches
//     UPDATE_REQUIRED_EVENT) — replaces the app with a hard update screen and the store link. Nothing else renders.
//   • UPDATE_RECOMMENDED — a dismissible banner (remote flag `update_prompts` can turn it off).
//   • Maintenance (§220), the announcement banner, break-glass and module notices (§54: "AI temporarily unavailable" while
//     booking keeps working) — a banner above the working app (flag `maintenance_banner`).
//   • useRemoteFlag(name, fallback) / useModuleNotice(module) for screens (§52).
// Never blocks launch: the app renders at once; a failed fetch leaves it exactly as it would be without the gate.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AppConfigResponse, AppVersionState, ModuleNotice } from '@aipowersalon/api-contracts';
import { sdkHttp } from '../http';
import { clientPlatform } from '../network/transport';
import { UPDATE_REQUIRED_EVENT } from './events';

export type GateApp = 'customer' | 'tech' | 'owner' | 'manager-pay';
export const RESUME_REFETCH_MS = 60_000;

/** The /app-config path (the app's client prefixes /api/v1). */
export function appConfigPath(app: GateApp, platform: string, version: string | undefined | null): string {
  const q = new URLSearchParams({ app, platform });
  if (version && version !== 'unknown') q.set('version', version);
  return `/app-config?${q.toString()}`;
}

// ── a tiny store, so hooks anywhere under the gate read the same config ─────────────────────────────────────────────
interface HardUpdate { message: string | null; storeUrl: string | null; minimumVersion: string | null }
interface State { config: AppConfigResponse | null; hard: HardUpdate | null }
let state: State = { config: null, hard: null };
const listeners = new Set<() => void>();
function set(next: Partial<State>) { state = { ...state, ...next }; for (const l of listeners) l(); }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => state;
/** Test / logout helper. */
export function resetAppConfig(): void { state = { config: null, hard: null }; for (const l of listeners) l(); }

export function useAppConfig(): AppConfigResponse | null { return useSyncExternalStore(subscribe, snapshot, snapshot).config; }
/** A remote flag (§52). `fallback` until /app-config answered, or if the flag is not in this app's catalogue. */
export function useRemoteFlag(name: string, fallback: boolean): boolean {
  const c = useAppConfig();
  const v = c?.flags?.[name];
  return typeof v === 'boolean' ? v : fallback;
}
/** The notice for a module switched off right now (§54), or null. */
export function useModuleNotice(module: ModuleNotice['module']): ModuleNotice | null {
  return useAppConfig()?.modules?.find((m) => m.module === module) ?? null;
}
export function useUpdateState(): AppVersionState { const s = useSyncExternalStore(subscribe, snapshot, snapshot); return s.hard ? 'UPDATE_REQUIRED' : s.config?.update.state ?? 'SUPPORTED'; }

export interface AppConfigGateProps {
  app: GateApp;
  /** The build's version — pass import.meta.env.VITE_APP_VERSION. */
  version?: string | null;
  /** Defaults to the transport's platform (ios / android on native, web in a browser). */
  platform?: 'ios' | 'android' | 'web';
  /** Defaults to the app's API client injected with configureMobileSdk. */
  fetchConfig?: (path: string) => Promise<AppConfigResponse>;
  children: ReactNode;
}

const bar = (bg: string): React.CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 13, lineHeight: 1.35, background: bg, color: '#1f1f1f', borderBottom: '1px solid rgba(0,0,0,0.08)' });

export function AppConfigGate({ app, version, platform, fetchConfig, children }: AppConfigGateProps) {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [dismissed, setDismissed] = useState(false);
  const plat = platform ?? clientPlatform();

  useEffect(() => {
    let alive = true;
    let last = 0;
    const load = async () => {
      last = Date.now();
      try {
        const get = fetchConfig ?? ((p: string) => sdkHttp().get<AppConfigResponse>(p));
        const c = await get(appConfigPath(app, plat, version));
        if (!alive || !c || typeof c !== 'object' || !c.update) return;
        set({ config: c, hard: c.update.state === 'UPDATE_REQUIRED' ? { message: c.update.message, storeUrl: c.update.storeUrl, minimumVersion: c.update.minimumVersion } : null });
      } catch { /* offline / server down: the app runs exactly as it would without the gate */ }
    };
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible' && Date.now() - last >= RESUME_REFETCH_MS) void load();
    };
    const onUpdateRequired = (e: Event) => {
      const d = (e as CustomEvent).detail ?? {};
      if (d?.code !== 'UPDATE_REQUIRED') return;
      set({ hard: { message: typeof d.message === 'string' ? d.message : null, storeUrl: typeof d.storeUrl === 'string' ? d.storeUrl : null, minimumVersion: typeof d.minimumVersion === 'string' ? d.minimumVersion : null } });
    };
    void load();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(UPDATE_REQUIRED_EVENT, onUpdateRequired);
    return () => { alive = false; document.removeEventListener('visibilitychange', onVisible); window.removeEventListener(UPDATE_REQUIRED_EVENT, onUpdateRequired); };
  }, [app, plat, version, fetchConfig]);

  if (s.hard) return <UpdateRequiredScreen hard={s.hard} version={version ?? null} />;

  const c = s.config;
  const prompts = c?.flags?.update_prompts !== false;
  const notices = c?.flags?.maintenance_banner !== false;
  const lines: Array<{ key: string; text: string; tone: string }> = [];
  if (c && notices) {
    if (c.breakGlass.mode !== 'off' && c.breakGlass.message) lines.push({ key: 'bg', text: c.breakGlass.message, tone: '#ffe1a8' });
    if (c.maintenance.active && c.maintenance.message) lines.push({ key: 'm', text: c.maintenance.message, tone: '#ffe1a8' });
    if (c.maintenance.banner) lines.push({ key: 'b', text: c.maintenance.banner, tone: '#dbe9ff' });
    for (const m of c.modules) lines.push({ key: `mod-${m.module}`, text: m.message, tone: '#f1f1f1' });
  }
  return (
    <>
      {c && prompts && !dismissed && c.update.state === 'UPDATE_RECOMMENDED' && (
        <div role="status" style={bar('#e5f6ea')}>
          <span style={{ flex: 1 }}>A new version{c.update.recommendedVersion ? ` (${c.update.recommendedVersion})` : ''} is available.</span>
          {c.update.storeUrl && <a href={c.update.storeUrl} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>Update</a>}
          <button type="button" aria-label="Dismiss" onClick={() => setDismissed(true)} style={{ border: 0, background: 'transparent', fontSize: 16, cursor: 'pointer' }}>×</button>
        </div>
      )}
      {lines.map((l) => <div key={l.key} role="status" style={bar(l.tone)}>{l.text}</div>)}
      {children}
    </>
  );
}

function UpdateRequiredScreen({ hard, version }: { hard: HardUpdate; version: string | null }) {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#fafafa', color: '#1f1f1f', textAlign: 'center' }}>
      <div style={{ maxWidth: 360 }}>
        <h1 style={{ fontSize: 22, margin: '0 0 12px' }}>Update required</h1>
        <p style={{ margin: '0 0 8px' }}>{hard.message || 'A newer version of this app is required. Please update to continue.'}</p>
        <p style={{ margin: '0 0 20px', fontSize: 13, opacity: 0.7 }}>
          {version ? `This version: ${version}` : ''}{version && hard.minimumVersion ? ' · ' : ''}{hard.minimumVersion ? `Minimum: ${hard.minimumVersion}` : ''}
        </p>
        {hard.storeUrl
          ? <a href={hard.storeUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', padding: '12px 24px', borderRadius: 10, background: '#1f1f1f', color: '#fff', textDecoration: 'none', fontWeight: 600 }}>Update now</a>
          : <p style={{ fontSize: 13 }}>Open the App Store or Google Play to update.</p>}
      </div>
    </main>
  );
}
