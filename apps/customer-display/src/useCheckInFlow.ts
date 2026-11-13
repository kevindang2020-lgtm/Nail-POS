// useCheckInFlow.ts — the customer's check-in on the display (23-inch spec §14–§28): phone → appointment found ("I'm
// here") or walk-in (first name, services and add-ons from the branch's catalog, any / a preferred technician) →
// confirmation. ONE flow, shared by the 23-inch three-column screen and the single-column (portrait / iPad) screen, on
// top of the display's own check-in session (useGoCheckIn). It holds only what the customer typed and what the server
// answered; matching, appointment lookup, prices, who may be asked for, the queue, the wait estimate and tenant/branch
// isolation all stay server-side.
//
// Privacy (§28, §105, §107): the moment a check-in is confirmed, what the customer typed (phone, name, choices) is
// cleared — only the confirmation (first name, wait) stays, for a few seconds — and the next customer's first tap clears
// that too. A guest who walks away mid-check-in is cleared after WALK_AWAY_MS without a touch, so the next guest never
// sees their name, their appointment or their services. Each guest's turn ends with a fresh session (useGoCheckIn.renew).
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CheckInConfirmation, LookupResult } from '@aipowersalon/api-contracts/customer';
import type { DisplayCheckInStep } from '@aipowersalon/api-contracts';
import type { useGoCheckIn } from './useGoCheckIn';
import type { KioskService, KioskTechnician } from './goCheckInApi';
import { useIdle } from './useIdle';
import { useWalkInSelection } from './useWalkInSelection';
import { useT } from './i18n';

/** A guest mid-check-in who has not touched the screen for this long has walked away: the screen is cleared. Longer than
 *  the 30–60 s the full-screen ads wait (§7) — they never cover a check-in in progress — and long enough to find a phone. */
export const WALK_AWAY_MS = 90_000;

export const fmtPhone = (d: string) => {
  const n = d.replace(/\D/g, '').slice(0, 10);
  if (n.length <= 3) return n;
  if (n.length <= 6) return `(${n.slice(0, 3)}) ${n.slice(3)}`;
  return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
};

export type CheckInFlow = ReturnType<typeof useCheckInFlow>;

/** Dual-Screen mandate §11: where the guest is, in the display model's words (CHECK_IN · CHECK_IN_LOOKUP ·
 *  APPOINTMENT_FOUND · WALK_IN · CHECK_IN_SUCCESS). A technician at the clock uses the screen too: CHECK_IN. */
export function checkInStepOf(f: Pick<CheckInFlow, 'mode' | 'phone' | 'lookup' | 'name' | 'picked' | 'addOns' | 'tech' | 'confirmation' | 'busy' | 'appointment'> & { selecting?: boolean }): DisplayCheckInStep {
  if (f.mode === 'technician') return 'phone';
  if (f.confirmation) return 'success';
  if (f.appointment) return 'appointment';
  if (f.busy && !f.lookup) return 'lookup';
  if (f.lookup || f.name || f.picked.length || f.addOns.length || f.tech || f.selecting) return 'walk_in';
  if (f.phone) return 'phone';
  return 'none';
}

export function useCheckInFlow(gci: ReturnType<typeof useGoCheckIn>) {
  const t = useT();
  const [phone, setPhone] = useState('');
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [name, setName] = useState('');
  const [services, setServices] = useState<KioskService[]>([]);
  const [techs, setTechs] = useState<KioskTechnician[]>([]);
  const [picked, setPicked] = useState<string[]>([]);       // the services (§24: several)
  const [addOns, setAddOns] = useState<string[]>([]);       // §20: add-ons — they go with a service
  const [tech, setTech] = useState<string>('');             // '' = Any available
  const [confirmation, setConfirmation] = useState<CheckInConfirmation | null>(null);
  const [mode, setMode] = useState<'customer' | 'technician'>('customer');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const settings = gci.config?.settings;
  // the deps are the stable calls and the session's config, never the whole gci object (that re-ran these on every
  // render: a request storm — see useGoCheckIn)
  const { phase, config, listServices, listTechnicians, renew } = gci;

  // §22–§23: the BRANCH's menu and prices, asked once per session — a new guest's session asks again (today's prices)
  useEffect(() => {
    if (phase !== 'ready' || !config?.settings.serviceSelectionEnabled) { setServices([]); return; }
    let live = true;
    listServices().then((r) => { if (live) setServices(r.services || []); }).catch(() => { /* the walk-in still works */ });
    return () => { live = false; };
  }, [phase, config, listServices]);

  // §25: who may be asked for — working today at this branch and qualified for EVERY chosen service; asked again as the
  // services change. A technician who is no longer qualified for the new choice goes back to "Any available".
  const pickedKey = [...picked].sort().join(',');
  useEffect(() => {
    if (phase !== 'ready' || !config?.settings.technicianPreferenceEnabled) { setTechs([]); return; }
    let live = true;
    listTechnicians(pickedKey ? pickedKey.split(',') : []).then((r) => {
      if (!live) return;
      const list = r.technicians || [];
      setTechs(list);
      setTech((t) => (t && !list.some((x) => x.technicianId === t) ? '' : t));
    }).catch(() => { /* "Any available" still works */ });
    return () => { live = false; };
  }, [phase, config, pickedKey, listTechnicians]);

  // SUNMI guide 4A: the walk-in service selection (categories → services → review → confirm) — the salon's own live catalog
  const ws = useWalkInSelection(gci, !!config?.settings.serviceSelectionEnabled && config?.settings.walkinCheckinEnabled !== false);
  const { clear: clearSelection } = ws;

  const mains = useMemo(() => services.filter((s) => !s.isAddOn), [services]);
  const addOnOptions = useMemo(() => services.filter((s) => s.isAddOn), [services]);
  const digits = phone.replace(/\D/g, '');

  /** Clear what the customer typed (not the confirmation). */
  const clearInputs = useCallback(() => { setPhone(''); setLookup(null); setName(''); setPicked([]); setAddOns([]); setTech(''); setErr(null); clearSelection(); }, [clearSelection]);
  /** The guest's turn is over: an empty screen, and the next guest gets a fresh session. */
  const reset = useCallback(() => { clearInputs(); setConfirmation(null); renew(); }, [clearInputs, renew]);

  const press = (k: string) => {
    setErr(null);
    if (confirmation) { setConfirmation(null); renew(); }   // the next customer's first tap: the last confirmation leaves the screen
    if (k === '⌫') { setPhone((p) => fmtPhone(p.replace(/\D/g, '').slice(0, -1))); setLookup(null); return; }
    if (k === 'C') { setPhone(''); setLookup(null); return; }
    if (digits.length >= 10) return;
    setPhone((p) => fmtPhone(p.replace(/\D/g, '') + k));
  };
  const clearPhone = () => { setPhone(''); setLookup(null); setErr(null); };

  const confirmed = (c: CheckInConfirmation) => { clearInputs(); setConfirmation(c); };

  const doLookup = useCallback(async () => {
    if (digits.length < 10) { setErr(t('ci.err.tenDigits')); return; }
    setBusy(true); setErr(null);
    try {
      const r = await gci.lookupPhone(digits);
      setLookup(r);
      if (r.askFrontDesk) setErr(t('ci.err.seeFrontDesk'));
      if (r.match?.firstName && !name) setName(r.match.firstName);
    } catch (e: any) { setErr(e?.message || t('ci.err.lookup')); }
    finally { setBusy(false); }
  }, [gci, digits, name, t]);

  const imHere = async (appointmentId: string) => {
    if (busy) return;   // §19 double-tap: the second tap of a double tap does nothing (the server also refuses a second check-in)
    setBusy(true); setErr(null);
    try { confirmed(await gci.checkInAppointment(appointmentId)); }
    catch (e: any) { setErr(e?.message || t('ci.err.failed')); }
    finally { setBusy(false); }
  };

  // §20–§21: the quick walk-in — first name, phone, service(s); nothing else is asked for
  /** The 4A service selection is this salon's walk-in (an older server without it keeps the plain list). */
  const selecting = ws.status === 'ready' || ws.status === 'loading' || ws.status === 'unavailable';
  /** §20 existing customer: a number typed but never looked up is looked up first. False → stop (shown instead). */
  const ensureLookup = async (): Promise<LookupResult | null> => {
    if (lookup) return lookup;
    const lk = await gci.lookupPhone(digits);
    setLookup(lk);
    if (lk.askFrontDesk || lk.canWalkIn === false) { setErr(t('ci.err.seeFrontDesk')); return null; }
    if (lk.appointment) return null;   // the appointment card replaces the walk-in: "I'm Here" checks them in
    return lk;
  };
  /** 4A step 4: the walk-in's name and phone are in → the salon's categories open (or the review, when picks exist). */
  const startSelection = async () => {
    if (busy) return;
    if (!name.trim()) { setErr(t('ci.err.firstName')); return; }
    if (digits.length !== 10) { setErr(t('ci.err.phoneLeft')); return; }
    if (ws.status !== 'ready') { setErr(t(ws.status === 'loading' ? 'wis.loading' : 'wis.err.unavailableAll')); return; }   // 4A.15: fail closed
    setBusy(true); setErr(null);
    try {
      const lk = await ensureLookup();
      if (lk) ws.setView(ws.picks.length || ws.skip ? { kind: 'review' } : { kind: 'browse' });
    } catch (e: any) { setErr(e?.message || t('ci.err.lookup')); }
    finally { setBusy(false); }
  };
  /** 4A steps 6–7: Confirm Check-In on the review — one request, the server's answer is the confirmation. */
  const confirmSelection = async () => {
    const lk = lookup;
    const out = await ws.confirm({ customerId: lk?.match?.source === 'tenant' ? lk.match.customerId : undefined, customerName: name.trim(), phone: digits });
    if (out) confirmed(out);
  };

  const doWalkIn = async () => {
    if (busy) return;
    if (selecting) { await startSelection(); return; }
    if (!name.trim()) { setErr(t('ci.err.firstName')); return; }
    if (digits.length !== 10) { setErr(t('ci.err.phoneLeft')); return; }
    if (settings?.serviceSelectionEnabled && mains.length > 0 && picked.length === 0) { setErr(t('ci.err.service')); return; }
    setBusy(true); setErr(null);
    try {
      // §20 existing customer: a number typed but never looked up is looked up first — a returning guest is linked to
      // their profile, not duplicated, and a guest with an appointment today is shown it instead
      let lk = lookup;
      if (!lk) {
        lk = await gci.lookupPhone(digits);
        setLookup(lk);
        if (lk.askFrontDesk || lk.canWalkIn === false) { setErr(t('ci.err.seeFrontDesk')); return; }
        if (lk.appointment) return;   // the appointment card replaces the walk-in: "I'm Here" checks them in
      }
      confirmed(await gci.checkInWalkIn({
        // Only a TENANT match carries a customer id; a central (cross-salon) match never does — the contract's union says so.
        customerId: lk.match?.source === 'tenant' ? lk.match.customerId : undefined,
        customerName: name.trim(),
        phone: digits,
        serviceIds: picked,
        ...(addOns.length ? { addOnIds: addOns } : {}),
        technicianId: tech || undefined,
      }));
    } catch (e: any) { setErr(e?.message || t('ci.err.failed')); }
    finally { setBusy(false); }
  };

  const toggleSvc = (id: string) => {
    setErr(null);
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    if (!next.length) setAddOns([]);   // add-ons go with a service
  };
  const toggleAddOn = (id: string) => {
    if (!picked.length) { setErr(t('ci.err.addOnFirst')); return; }
    setErr(null);
    setAddOns((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  };
  const enterTechnician = () => { reset(); setMode('technician'); };
  const exitTechnician = () => { setMode('customer'); renew(); };

  /** Nothing typed, nothing showing — the screen belongs to nobody (full-screen idle ads may take over, §7). */
  const idle = mode === 'customer' && !phone && !lookup && !name && picked.length === 0 && addOns.length === 0 && !tech && !confirmation && !busy && !ws.active;
  // a guest (or a technician at the clock) who walked away: cleared after WALK_AWAY_MS without a touch
  const walkedAway = useIdle(!idle && !confirmation ? WALK_AWAY_MS : null);
  useEffect(() => { if (walkedAway) { setMode('customer'); reset(); } }, [walkedAway, reset]);

  const appointment = lookup?.appointment || null;
  const canWalkIn = settings?.walkinCheckinEnabled !== false && (lookup ? lookup.canWalkIn !== false : true);

  return {
    gci, settings, phone, digits, lookup, name, services, mains, addOnOptions, techs, picked, addOns, tech, confirmation, mode, busy, err, idle, appointment, canWalkIn,
    ws, selectionOn: selecting, selecting: ws.active,
    setName, setTech, setErr, press, clearPhone, doLookup, imHere, doWalkIn, toggleSvc, toggleAddOn, reset, clearInputs, enterTechnician, exitTechnician, confirmSelection,
  };
}
