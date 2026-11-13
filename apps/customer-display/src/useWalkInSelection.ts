// useWalkInSelection.ts — CPad 14 Walk-In service selection (SUNMI guide Section 4A) on the display: browse the salon's
// categories, search, pick services (several, from several categories) with their add-ons, review the SERVER's
// re-priced estimate, confirm once. It holds only what the guest picked and what the server answered — the catalog,
// prices, durations, eligibility, the total and the queue entry are all the server's (go-check-in walk-in routes).
//
//   catalog    loaded once the session is ready; while the picker is open it is re-checked every CATALOG_RECHECK_MS with
//              the revision the screen holds (the server answers notModified, or the new catalog) — an owner's edit
//              reaches an open screen, and a stale line shows as changed / no longer available (4A.8)
//   review     the server's preview — never a total worked out here; a change since the guest looked is shown and needs
//              a NEW tap on Confirm (the confirm is refused with the fresh preview if the guest's approval is stale)
//   confirm    ONE checkin_request_id per payload: a double tap, a retry after a network error or a reconnect re-sends the
//              SAME id (the server answers with the first result); any change to the picks makes a new id. No automatic
//              retry, nothing written to storage (4A.10) — a failed send says "please see the front desk".
//   privacy    clear() drops everything; the flow calls it on success, cancel, walk-away and a restart (state is memory only)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WalkInCatalog, WalkInConfirmResult, WalkInPreview, WalkInSelectionLine, WalkInServiceOption } from '@aipowersalon/api-contracts/customer';
import type { useGoCheckIn } from './useGoCheckIn';
import type { KioskTechnician } from './goCheckInApi';
import { CheckInApiError, DisplayApiError } from './api';
import type { MsgKey } from './i18n';

/** How often an open picker asks whether the catalog changed (a cheap notModified answer when it did not). */
export const CATALOG_RECHECK_MS = 20_000;

export type WalkInView = { kind: 'closed' } | { kind: 'browse' } | { kind: 'category'; categoryId: string } | { kind: 'review' };
/** What the guest picked, and what the screen SHOWED them for it (so the server can tell a change). */
export interface WalkInPick { serviceId: string; addOnIds: string[]; shownName: string; shownPriceCents: number | null }
export type PickState = 'ok' | 'changed' | 'unavailable';
/** 'legacy': an older server without the walk-in catalog (404) — the flow keeps its plain service list. */
export type PickerAvailability = 'off' | 'loading' | 'ready' | 'legacy' | 'unavailable';
export interface WalkInIdentity { customerId?: string; customerName: string; phone?: string }

type Gci = Pick<ReturnType<typeof useGoCheckIn>, 'phase' | 'config' | 'walkInCatalog' | 'walkInPreview' | 'walkInConfirm' | 'listTechnicians'>;

const newRequestId = (): string => {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};
const isOffline = (e: unknown) => !(e instanceof DisplayApiError);   // no HTTP answer at all: the network or the server is gone

/** A pick against the catalog the screen now holds (4A.8): gone / hidden → unavailable; renamed / repriced → changed. */
export function pickState(p: WalkInPick, catalog: WalkInCatalog | null): PickState {
  const s = catalog?.services.find((x) => x.id === p.serviceId);
  if (!s) return 'unavailable';
  if (p.addOnIds.some((id) => !s.addOnIds.includes(id) || !catalog!.addOns.some((a) => a.id === id))) return 'unavailable';
  return s.name !== p.shownName || s.priceCents !== p.shownPriceCents ? 'changed' : 'ok';
}
/** 4A.3 search: service name, description or category name; case and accents ignored. */
export function searchServices(catalog: WalkInCatalog | null, query: string): WalkInServiceOption[] {
  const fold = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const q = fold(query);
  if (!catalog || !q) return [];
  const catName = new Map(catalog.categories.map((c) => [c.id, fold(c.name)]));
  return catalog.services.filter((s) => fold(s.name).includes(q) || fold(s.description ?? '').includes(q) || (catName.get(s.categoryId) ?? '').includes(q));
}

export function useWalkInSelection(gci: Gci, enabled: boolean) {
  const { phase, config, walkInCatalog, walkInPreview, walkInConfirm, listTechnicians } = gci;
  const [status, setStatus] = useState<PickerAvailability>('off');
  const [catalog, setCatalog] = useState<WalkInCatalog | null>(null);
  const [view, setView] = useState<WalkInView>({ kind: 'closed' });
  const [query, setQuery] = useState('');
  const [picks, setPicks] = useState<WalkInPick[]>([]);
  const [skip, setSkip] = useState(false);
  const [notes, setNotesRaw] = useState('');
  const [techId, setTechId] = useState('');
  const [techs, setTechs] = useState<KioskTechnician[]>([]);
  const [preview, setPreview] = useState<WalkInPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  /** the server said the picks changed since the guest looked: the review shows today's values and needs a new tap */
  const [changedNotice, setChangedNotice] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<MsgKey | null>(null);
  const request = useRef<{ id: string; key: string } | null>(null);
  const confirmingRef = useRef(false);
  const revisionRef = useRef<string | null>(null);
  revisionRef.current = catalog?.revision ?? null;

  // the catalog — once per ready session (a new guest's session asks again: today's menu)
  useEffect(() => {
    if (!enabled || phase !== 'ready') { setStatus('off'); setCatalog(null); return; }
    let live = true;
    setStatus('loading');
    walkInCatalog().then((c) => { if (live) { setCatalog(c); setStatus('ready'); } })
      .catch((e) => {
        if (!live) return;
        setCatalog(null);
        // a plain 404 (no code) = an older server without the route → the plain walk-in; 403 = the salon switched it off;
        // anything else (offline, the session refused, 5xx) = fail closed: "please see the front desk" (4A.15)
        setStatus(e instanceof DisplayApiError && e.status === 404 && !e.code ? 'legacy' : e instanceof DisplayApiError && e.status === 403 ? 'off' : 'unavailable');
      });
    return () => { live = false; };
  }, [enabled, phase, config, walkInCatalog]);   // config: a new guest's session (today's menu)

  const open = view.kind !== 'closed';
  // 4A.8: while the picker is open, ask whether the catalog changed (the revision as an ETag)
  useEffect(() => {
    if (!open || status !== 'ready') return;
    const id = setInterval(() => {
      walkInCatalog(revisionRef.current ?? undefined).then((c) => { if (!c.notModified) setCatalog(c); }).catch(() => { /* the confirm re-checks anyway */ });
    }, CATALOG_RECHECK_MS);
    return () => clearInterval(id);
  }, [open, status, walkInCatalog]);

  const lines = useMemo<WalkInSelectionLine[]>(() => picks.map((p) => ({ serviceId: p.serviceId, addOnIds: p.addOnIds, shownName: p.shownName, shownPriceCents: p.shownPriceCents })), [picks]);
  const runPreview = useCallback(async (ls: WalkInSelectionLine[]) => {
    if (!catalog) return;
    setPreviewing(true);
    try {
      const pv = await walkInPreview(ls, catalog.revision);
      setPreview(pv);
      if (pv.revision !== catalog.revision) walkInCatalog().then(setCatalog).catch(() => undefined);
    } catch (e) { setErr(isOffline(e) ? 'wis.err.offline' : 'wis.err.preview'); }
    finally { setPreviewing(false); }
  }, [catalog, walkInPreview, walkInCatalog]);

  // the review always shows the SERVER's estimate for exactly these picks (and again after a catalog change)
  const revision = catalog?.revision;
  useEffect(() => {
    if (view.kind !== 'review') return;
    void runPreview(lines);
  }, [view.kind, lines, revision]);   // eslint-disable-line react-hooks/exhaustive-deps

  // a preferred technician (only when the salon allows it): eligible for every picked service, asked again as they change
  const allowTech = !!catalog?.rules.allowTechnicianPreference;
  const pickedKey = picks.map((p) => p.serviceId).sort().join(',');
  useEffect(() => {
    if (view.kind !== 'review' || !allowTech || !pickedKey) { setTechs([]); return; }
    let live = true;
    listTechnicians(pickedKey.split(',')).then((r) => {
      if (!live) return;
      const list = r.technicians || [];
      setTechs(list);
      setTechId((t) => (t && !list.some((x) => x.technicianId === t) ? '' : t));
    }).catch(() => { if (live) setTechs([]); });
    return () => { live = false; };
  }, [view.kind, allowTech, pickedKey, listTechnicians]);

  const clear = useCallback(() => {
    setView({ kind: 'closed' }); setQuery(''); setPicks([]); setSkip(false); setNotesRaw(''); setTechId(''); setTechs([]);
    setPreview(null); setChangedNotice(false); setErr(null); request.current = null;
  }, []);

  const toggleService = (s: WalkInServiceOption) => {
    setErr(null); setSkip(false); setChangedNotice(false);
    setPicks((ps) => (ps.some((p) => p.serviceId === s.id) ? ps.filter((p) => p.serviceId !== s.id) : [...ps, { serviceId: s.id, addOnIds: [], shownName: s.name, shownPriceCents: s.priceCents }]));
  };
  const toggleAddOn = (serviceId: string, addOnId: string) => {
    setErr(null); setChangedNotice(false);
    setPicks((ps) => ps.map((p) => (p.serviceId !== serviceId ? p : { ...p, addOnIds: p.addOnIds.includes(addOnId) ? p.addOnIds.filter((x) => x !== addOnId) : [...p.addOnIds, addOnId] })));
  };
  const remove = (serviceId: string) => { setChangedNotice(false); setPicks((ps) => ps.filter((p) => p.serviceId !== serviceId)); };
  const setNotes = (v: string) => setNotesRaw(v.slice(0, catalog?.rules.notesMaxLength ?? 200));

  /** The review now shows the server's values: what the guest approves on the next tap is exactly that. */
  const adoptPreview = (pv: WalkInPreview) => {
    setPreview(pv);
    setPicks((ps) => ps.map((p) => {
      const l = pv.lines.find((x) => x.serviceId === p.serviceId);
      return l && l.state !== 'unavailable' ? { ...p, shownName: l.name, shownPriceCents: l.priceCents } : p;
    }));
  };
  // a preview that found changes: show today's values (they become what the guest approves) and say so
  useEffect(() => {
    if (!preview || view.kind !== 'review') return;
    if (preview.lines.some((l) => l.state === 'changed')) { setChangedNotice(true); adoptPreview(preview); }
  }, [preview]);   // eslint-disable-line react-hooks/exhaustive-deps

  const servicesRequired = catalog?.rules.requireServices !== false;
  const canSkip = !servicesRequired;
  const unavailable = preview?.lines.some((l) => l.state === 'unavailable' || l.addOns.some((a) => a.state === 'unavailable')) ?? false;
  const canConfirm = view.kind === 'review' && !!catalog && !!preview && !previewing && !confirming && !unavailable && (picks.length > 0 || skip);

  /** Confirm once. Resolves with the server's result, or null when it did not go through (the reason is in `err`). */
  const confirm = async (who: WalkInIdentity): Promise<WalkInConfirmResult | null> => {
    if (confirmingRef.current || !catalog || !preview) return null;   // a double tap: the second does nothing
    if (!picks.length && !skip) { setErr('wis.err.required'); return null; }
    const payload = { approvedRevision: preview.revision, customerId: who.customerId, customerName: who.customerName, phone: who.phone, lines, skipServices: skip && !picks.length, technicianId: techId || undefined, notes: notes.trim() || undefined };
    const key = JSON.stringify(payload);
    if (!request.current || request.current.key !== key) request.current = { id: newRequestId(), key };   // same payload → the same id
    confirmingRef.current = true; setConfirming(true); setErr(null);
    try {
      return await walkInConfirm({ checkinRequestId: request.current.id, ...payload });
    } catch (e) {
      if (e instanceof CheckInApiError && e.details?.preview && (e.code === 'WALK_IN_SELECTION_CHANGED' || e.code === 'WALK_IN_SERVICE_UNAVAILABLE')) {
        adoptPreview(e.details.preview);
        setChangedNotice(true);
        setErr(e.code === 'WALK_IN_SERVICE_UNAVAILABLE' ? 'wis.err.unavailable' : 'wis.err.changed');
        walkInCatalog().then(setCatalog).catch(() => undefined);
      } else if (e instanceof DisplayApiError && e.code === 'IDEMPOTENCY_IN_PROGRESS') setErr('wis.err.saving');
      else if (isOffline(e)) setErr('wis.err.offline');
      else if (e instanceof DisplayApiError && e.code === 'SERVICES_REQUIRED') setErr('wis.err.required');
      else setErr('wis.err.failed');
      return null;
    } finally { confirmingRef.current = false; setConfirming(false); }
  };

  const active = open || picks.length > 0 || skip;
  return {
    status, catalog, view, open, active, query, picks, skip, notes, techId, techs, preview, previewing, changedNotice, confirming, err, canConfirm, canSkip, servicesRequired, unavailable,
    setView, setQuery, setNotes, setTechId, setErr, setSkip, toggleService, toggleAddOn, remove, confirm, clear,
  };
}
export type WalkInSelection = ReturnType<typeof useWalkInSelection>;
