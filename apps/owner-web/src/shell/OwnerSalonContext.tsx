import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';

// OwnerSalonContext — the SALON layer of the Owner App.
//
// The existing `OwnerBranchContext` switches BRANCHES *within one salon*. This sits above it and switches SALONS
// (separate tenants — separate legal businesses, each with its own Store Code, subscription and merchant account).
// The two are deliberately different concerns and are not merged.
//
// ── Switching is a server operation, not a client one ──
//
// The active salon lives in the signed session (`tenantId` in the token), which is what every tenant-scoped query
// on the backend already reads. So switching is not "set a variable" — it is asking the server to re-issue the
// session for a salon it has verified you own. Nothing here can move the owner into a salon the server did not
// approve.
//
// ── Cache invalidation is the correctness problem ──
//
// After a switch, ANY data still on screen from the previous salon is wrong — and worse, it is wrong in a way that
// looks right. A stale appointment list from Salon A under Salon B's header is a data-leak-shaped bug. So the
// switch bumps an epoch that every screen keys its data on, and in-flight requests from the old salon are aborted.

export interface PortfolioBranch {
  branchId: string;
  name: string;
  city: string | null;
  state: string | null;
  isActive: boolean;
}

export interface PortfolioSalon {
  salonId: string;
  salonName: string;
  storeCode: string;
  status: string;
  selectable: boolean;
  accessLevel: 'owner' | 'manager' | 'viewer' | 'report_only';
  isPrimaryOwner: boolean;
  branches: PortfolioBranch[];
}

interface OwnerSalonValue {
  loading: boolean;
  error: string | null;
  salons: PortfolioSalon[];
  activeSalonId: string | null;
  activeSalon: PortfolioSalon | null;
  /** 'all' = the All-Salons portfolio view; otherwise a single salon is active. */
  viewingAllSalons: boolean;
  /** Bumped on every switch. Screens key their data on it so nothing from the previous salon survives. */
  epoch: number;
  /** Abort in-flight requests that belong to the salon we just left. */
  signal: AbortSignal | undefined;
  switchSalon: (salonId: string, branchId?: string | null) => Promise<void>;
  showAllSalons: () => void;
  /** Can the owner do this AT THE ACTIVE SALON? Never the best level they hold elsewhere. */
  canHere: (capability: string) => boolean;
  /** Pinned salons. A device-local convenience — it never widens what the server authorized. */
  favorites: string[];
  toggleFavorite: (salonId: string) => void;
  /** Most recently opened, newest first. Only ever salons still in the portfolio. */
  recentSalons: PortfolioSalon[];
  reload: () => Promise<void>;
}

const CAPS: Record<PortfolioSalon['accessLevel'], string[]> = {
  owner: ['view', 'reports', 'operate', 'manage_staff', 'manage_settings', 'manage_payments', 'payroll'],
  manager: ['view', 'reports', 'operate', 'manage_staff'],
  viewer: ['view', 'reports'],
  report_only: ['reports'],
};

const Ctx = createContext<OwnerSalonValue | null>(null);

const LAST_SALON = 'aps.owner.lastSalon';
const FAVORITES = 'aps.owner.favoriteSalons';
const RECENT = 'aps.owner.recentSalons';
const MAX_RECENT = 4;

/** Favourites and recents are a per-device CONVENIENCE, not an authorization. They can only ever narrow what the
 *  server already said this owner may see — a salon id in localStorage grants nothing. */
function readIds(key: string): string[] {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v.map(String) : []; }
  catch { return []; }
}
function writeIds(key: string, ids: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(ids)); } catch { /* private mode */ }
}

export function OwnerSalonProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [salons, setSalons] = useState<PortfolioSalon[]>([]);
  const [activeSalonId, setActiveSalonId] = useState<string | null>(null);
  const [viewingAllSalons, setViewingAllSalons] = useState(true);   // until the server tells us otherwise
  const [epoch, setEpoch] = useState(0);
  const [controller, setController] = useState<AbortController | null>(null);
  const [favorites, setFavorites] = useState<string[]>(() => readIds(FAVORITES));
  const [recentIds, setRecentIds] = useState<string[]>(() => readIds(RECENT));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, c] = await Promise.all([
        api.get<{ salons: PortfolioSalon[] }>('/owner/portfolio'),
        api.get<{ activeSalonId: string | null }>('/owner/context'),
      ]);
      const loaded = p.salons || [];
      setSalons(loaded);
      let effectiveSalonId = c.activeSalonId ?? null;
      // Requirement: "After login, automatically open the owner’s main store/account."
      if (!effectiveSalonId && loaded.length > 0) {
        const primary = loaded.find((s) => s.isPrimaryOwner && s.selectable) || loaded.find((s) => s.selectable) || loaded[0];
        if (primary) {
          try {
            const r = await api.post<{ activeSalonId: string; salonName: string }>('/owner/context/switch', { salonId: primary.salonId });
            effectiveSalonId = r.activeSalonId;
          } catch {
            effectiveSalonId = primary.salonId;
          }
        }
      }
      setActiveSalonId(effectiveSalonId);
      setViewingAllSalons(!effectiveSalonId);
    } catch (e: any) {
      setError(e?.message || 'We could not load your salons.');
      setSalons([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const switchSalon = useCallback(async (salonId: string, branchId?: string | null) => {
    setError(null);

    // Abort anything still in flight for the salon we are leaving — its response would arrive after the switch
    // and paint the previous salon's data under the new salon's name.
    controller?.abort();
    const next = new AbortController();
    setController(next);

    try {
      const r = await api.post<{ activeSalonId: string; salonName: string }>('/owner/context/switch', { salonId, branchId: branchId ?? null });
      // Trust the SERVER's answer, not the id we asked for.
      setActiveSalonId(r.activeSalonId);
      setViewingAllSalons(false);
      setEpoch((e) => e + 1);          // ← every screen re-fetches; nothing from the old salon survives
      try { sessionStorage.setItem(LAST_SALON, r.activeSalonId); } catch { /* private mode */ }

      // Recently viewed — newest first, de-duplicated, capped.
      setRecentIds((prev) => {
        const next = [r.activeSalonId, ...prev.filter((id) => id !== r.activeSalonId)].slice(0, MAX_RECENT);
        writeIds(RECENT, next);
        return next;
      });
    } catch (e: any) {
      // A refused switch leaves the owner exactly where they were — we do NOT optimistically move them.
      setError(e?.message || 'That salon is not available for your account.');
      throw e;
    }
  }, [controller]);

  const showAllSalons = useCallback(() => {
    controller?.abort();
    setViewingAllSalons(true);
    setEpoch((e) => e + 1);
  }, [controller]);

  const activeSalon = useMemo(
    () => salons.find((s) => s.salonId === activeSalonId) ?? null,
    [salons, activeSalonId],
  );

  const toggleFavorite = useCallback((salonId: string) => {
    setFavorites((prev) => {
      const next = prev.includes(salonId) ? prev.filter((id) => id !== salonId) : [...prev, salonId];
      writeIds(FAVORITES, next);
      return next;
    });
  }, []);

  // Only salons STILL IN THE PORTFOLIO. A remembered id whose membership was revoked must not reappear here —
  // the server list is the authority, and localStorage can only ever filter it.
  const recentSalons = useMemo(
    () => recentIds.map((id) => salons.find((s) => s.salonId === id)).filter((s): s is PortfolioSalon => !!s),
    [recentIds, salons],
  );

  const canHere = useCallback((capability: string) => {
    if (!activeSalon) return false;
    if (!activeSalon.selectable) return false;
    return (CAPS[activeSalon.accessLevel] ?? []).includes(capability);
  }, [activeSalon]);

  const value: OwnerSalonValue = {
    loading, error, salons, activeSalonId, activeSalon, viewingAllSalons, epoch,
    signal: controller?.signal,
    switchSalon, showAllSalons, canHere, reload: load,
    favorites, toggleFavorite, recentSalons,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOwnerSalon(): OwnerSalonValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOwnerSalon must be used inside <OwnerSalonProvider>');
  return v;
}

// A NON-throwing read of just the salon-switch counter. OwnerBranchContext lives inside this provider in the app, but
// is mounted standalone in isolated tests (OwnerBranchSelector.test, smoke.test) — so it can't use the throwing
// useOwnerSalon(). Returns 0 when there is no salon provider: a harmless no-op that never triggers a spurious reload.
export function useOwnerSalonEpoch(): number {
  return useContext(Ctx)?.epoch ?? 0;
}
