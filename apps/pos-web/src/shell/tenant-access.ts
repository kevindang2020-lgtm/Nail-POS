// tenant-access.ts — sidebar data hooks. All values are tenant/location-scoped on the backend.
//  • useTenantNavAccess: GET /tenant/navigation → role + permissions + feature flags + AI packages + subscription + salon name.
//  • useSidebarBadges:    GET /tenant/navigation/badges → live counts (no hardcoded numbers).
//  • useSystemStatus:     GET /tenant/system-status → real health + version for the bottom status card.
// Every hook fails soft (returns safe defaults) so the sidebar never blocks the app.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEventCallback } from '@aipowersalon/ui';
import { useSafetySync } from '../realtime/useRealtime';
import { api } from '../api/client';
import { REALTIME_EVENT } from '../realtime/realtime-client';
import { requiredPermissions, type BadgeKey, type NavPermission } from './tenant-nav';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { serverText } from '../i18n/server-text';

/** Fired when the API says this session's authorization changed (x-authorization-changed: 1) — see api/client.ts. */
export const AUTHORIZATION_CHANGED_EVENT = 'aps:authorization-changed';

export interface NavAccess {
  /** The person's role, for DISPLAY only (badges, greetings). Never used to decide what they may open. */
  role: string;
  permissions: string[];
  features: string[];
  aiPackages: string[];
  subscriptionStatus: string;     // active | trialing | past_due | suspended | cancelled
  salonName: string | null;       // the tenant's own salon name for the sidebar header; null = not set (never invented)
}
export type Badges = Partial<Record<BadgeKey, number>>;
export interface SystemStatus { healthy: boolean; label: string; version: string; }

const mapRole = (r?: string): string => (r || '').toUpperCase();

export function useTenantNavAccess(fallbackRole?: string, fallbackPerms?: string[]): NavAccess {
  const [a, setA] = useState<NavAccess>({
    role: mapRole(fallbackRole), permissions: fallbackPerms || [], features: [], aiPackages: [], subscriptionStatus: 'active',
    salonName: null,
  });
  // Phase 9: when the server says this person's grants changed (the authorization_changed realtime event, or the
  // x-authorization-changed response header), the sidebar asks again — a demoted manager's menu shrinks without a reload.
  const [rev, setRev] = useState(0);
  useEffect(() => {
    const bump = () => setRev((n) => n + 1);
    const onEvent = (e: Event) => { const d = (e as CustomEvent<{ screens?: string[] }>).detail; if (d && Array.isArray(d.screens) && d.screens.includes('navigation')) bump(); };
    window.addEventListener(REALTIME_EVENT, onEvent);
    window.addEventListener(AUTHORIZATION_CHANGED_EVENT, bump);
    return () => { window.removeEventListener(REALTIME_EVENT, onEvent); window.removeEventListener(AUTHORIZATION_CHANGED_EVENT, bump); };
  }, []);
  const loadNavigation = useEventCallback(() => {
    let alive = true;
    api.get<Partial<NavAccess> & { role?: string }>('/tenant/navigation')
      .then((r) => { if (alive && r) setA({
        role: mapRole(r.role || fallbackRole),
        permissions: r.permissions || fallbackPerms || [],
        features: r.features || [],
        aiPackages: r.aiPackages || [],
        subscriptionStatus: r.subscriptionStatus || 'active',
        salonName: r.salonName ?? null,
      }); })
      .catch(() => { /* optimistic defaults; backend remains source of truth on each page */ });
    return () => { alive = false; };
  });
  useEffect(() => loadNavigation(), [fallbackRole, rev, loadNavigation]);
  return a;
}

export function useSidebarBadges(pollMs = 30000): Badges {
  const [b, setB] = useState<Badges>({});
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(() => api.get<Badges>('/tenant/navigation/badges').then((r) => { if (alive.current && r) setB(r); }), []);
  useEffect(() => { load().catch(() => {}); }, [load]);
  // Smooth Refresh spec §95/§40: badges refresh on the shared safety sync (visible-gated, jittered, single-flight),
  // not on a raw 30 s interval that also ran in hidden tabs.
  useSafetySync(load, { intervalMs: pollMs });
  return b;
}

export function useSystemStatus(): SystemStatus {
  // WP-B: the state keeps the server's label or a catalogue KEY — the text is built at render, so a language switch
  // (which re-renders the shell in place) never leaves "All Systems Operational" in the old language
  const [s, setS] = useState<{ healthy: boolean; server: string | null; key: string; version: string }>({ healthy: true, server: null, key: 'pos.all_systems_operational', version: 'v2.4.1' });
  useEffect(() => {
    let alive = true;
    api.get<Partial<SystemStatus>>('/tenant/system-status')
      .then((r) => { if (alive && r) setS({ healthy: r.healthy ?? true, server: r.label || null, key: 'pos.all_systems_operational', version: r.version || 'v2.4.1' }); })
      // An unreachable status endpoint IS a system problem — never keep claiming "All Systems Operational"
      // when the health check itself cannot be reached.
      .catch(() => { if (alive) setS((prev) => ({ healthy: false, server: null, key: 'pos.status_unavailable_2', version: prev.version })); });
    return () => { alive = false; };
  }, []);
  return { healthy: s.healthy, label: s.server ? serverText(s.server) : t(s.key), version: s.version };
}

// ---- pure visibility/gating helpers (used by the sidebar + FeaturePage) ----
// Phase 9: permissions only. The old owner-role shortcut and the role lists are gone — an owner passes
// because the owner holds every tenant key, and a key the server did not grant hides the item for everyone.
export type GateState = 'ok' | 'no-permission' | 'feature-locked' | 'ai-locked' | 'suspended';
export function hasAllPermissions(keys: string[], held: string[] | undefined | null): boolean {
  if (!Array.isArray(held)) return keys.length === 0;
  return keys.every((k) => held.includes(k));
}
export function gateFor(
  item: { id?: string; permission?: NavPermission; featureFlag?: string; aiPackageCode?: string },
  access: Pick<NavAccess, 'permissions' | 'features' | 'aiPackages' | 'subscriptionStatus'>,
): GateState {
  if (access.subscriptionStatus === 'suspended') return 'suspended';
  if (!hasAllPermissions(requiredPermissions(item), access.permissions)) return 'no-permission';
  if (item.featureFlag && access.features.length > 0 && !access.features.includes(item.featureFlag)) return 'feature-locked';
  if (item.aiPackageCode && !access.aiPackages.includes(item.aiPackageCode)) return 'ai-locked';
  return 'ok';
}
