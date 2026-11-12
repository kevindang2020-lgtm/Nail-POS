import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { posCommunicationsApi } from '../api/posCommunicationsApi';
import { FiArrowLeft, FiSearch, FiPlus, FiMinus, FiCalendar, FiChevronLeft, FiChevronRight, FiCheck, FiAlertCircle } from 'react-icons/fi';
import { ServiceCard, AddonCard, BookingSummary, type ServiceCatalogItem, type AddonItem, type PriceOverride } from '../components/BookingSharedComponents';
import { QuickServiceCategoryPicker } from '../components/QuickServiceCategoryPicker';
import { posServicesApi } from '../api/posServicesApi';
import { createIntentKeys } from '@aipowersalon/api-client';
import { posBookingApi } from '../api/posBookingApi';
import { TechnicianPicker } from '../components/TechnicianPicker';
import { lookupTechnicianName } from '../components/useTechnicianNames';
import type { BookingDraftView as BookingDraft } from '@aipowersalon/api-contracts';
import { useCan } from '../components/usePermissions';
import { posCustomersApi } from '../api/posCustomersApi';
import { posCheckInApi } from '../api/posCheckInApi';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
// 23-inch spec §20 (Unit 7): ONE add-on rule for the POS walk-in, booking and the guest's own check-in ("Add-ons", any spelling)
import { isAddOnCategory } from '@aipowersalon/api-contracts';
import { msg, renderMsg, type Msg } from '../i18n/notice';
import { t as tx, enPlural, currentLocale } from '@aipowersalon/mobile-sdk/i18n';
import { fmtYmd } from '../i18n/format';
/** the "All Services" category chip — a sentinel value, labelled at render (never a translated string kept as a value) */
const ALL_CATEGORIES = '__all__';
/** the catalogue-load failure, as a key (translated at render) */
const CATALOG_ERROR = 'ops.booking.catalogLoadFailed';

// Helper to convert "1:00 PM" to "13:00" for backend compatibility
function convertTo24Hour(timeStr: string) {
  if (!timeStr) return timeStr;
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return timeStr;
  const [_, h, m, ampm] = match;
  let hours = parseInt(h, 10);
  if (ampm.toUpperCase() === 'PM' && hours < 12) hours += 12;
  if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
  return `${hours.toString().padStart(2, '0')}:${m}`;
}

// SCAN (Oct 12 2026): every day on this screen is a LOCAL calendar day. toISOString() is UTC — after 8 PM on the US
// east coast it named TOMORROW, so "today" was booked a day late and today's slots were judged by the wrong day.
const pad2 = (n: number) => String(n).padStart(2, '0');
export function localYmd(d: Date): string { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
export function ymdToLocalDate(s: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? '').trim()); if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return localYmd(d) === `${m[1]}-${m[2]}-${m[3]}` ? d : null;
}
/** "10:00 AM" + 115 → "11:55 AM" (the appointment's end on the clock). */
/** '14:30' → '2:30 PM' (the label the time buttons show); anything else is returned as-is. */
export function to12Hour(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ''); if (!m) return hhmm;
  const h24 = Number(m[1]), h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m[2]} ${h24 < 12 ? 'AM' : 'PM'}`;
}
/** Deep-scan (Oct 22 2026): the start times were a fixed list (9:00 AM … 4:00 PM) no matter the services, technician,
 *  schedules or bookings. They are now GET /pos/booking/availability's open slots — the selected technician's, or with
 *  "first available" every technician's, for the whole selected visit — as sorted 12-hour labels. */
export function openStartTimes(rows: { technicianId: string; slots: string[] }[], technicianId?: string): string[] {
  const all = new Set<string>();
  for (const r of rows || []) if (!technicianId || r.technicianId === technicianId) for (const s of r.slots || []) all.add(s);
  return [...all].sort().map(to12Hour);
}
/** The fixed list, kept ONLY for when the availability call fails (offline / older server) — labelled as such on screen; the
 *  server still re-checks every booking for conflicts and store hours. */
const FALLBACK_START_TIMES = ['9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM', '1:00 PM', '1:30 PM', '2:00 PM', '3:00 PM', '4:00 PM'];

export function clockPlusMinutes(timeStr: string, minutes: number): string {
  const hhmm = convertTo24Hour(timeStr); const m = /^(\d{2}):(\d{2})$/.exec(hhmm); if (!m) return timeStr;
  const total = (Number(m[1]) * 60 + Number(m[2]) + Math.max(0, Math.round(minutes))) % (24 * 60);
  const h24 = Math.floor(total / 60), mm = total % 60, h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${pad2(mm)} ${h24 < 12 ? 'AM' : 'PM'}`;
}
/** an "h:mm AM" slot value as the user's clock ("2:30 PM" / "14:30") — the value itself stays the slot key */
export function clockText(label: string): string {
  const hhmm = convertTo24Hour(label); const m = /^(\d{2}):(\d{2})$/.exec(hhmm); if (!m) return label;
  try { return new Intl.DateTimeFormat(currentLocale(), { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(Date.UTC(2000, 0, 1, Number(m[1]), Number(m[2]))); } catch { return label; }
}
const durationLabel = (mins: number) => { const h = Math.floor(mins / 60), m = mins % 60; return [h ? tx('pos.h_hr', { h: String(h) }) : '', m ? tx('pos.m_min', { m: String(m) }) : ''].filter(Boolean).join(' ') || tx('pos.0_min'); };

export function POSNewBookingScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // the board's Best Matches hands off ?time=HH:MM; older callers ?startTime=10:00 AM — both land as the 12-hour label
  const paramTime = searchParams.get('startTime') || (searchParams.get('time') ? to12Hour(searchParams.get('time')!) : null);
  const paramTechId = searchParams.get('technicianId');
  const paramDate = searchParams.get('date');
  const paramServiceId = searchParams.get('serviceId');
  
  // State
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<ServiceCatalogItem[]>([]);   // the salon's real catalog only — never the demo list (its ids are refused by the server)
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const can = useCan();
  const canOverridePrice = can('checkout.manage_overrides');   // the server's rule (pos.checkout.override_total)
  // ALL_CATEGORIES is a sentinel (labelled "All Services" at render); the rest are the salon's own category names. Before the
  // catalog loads only "All" shows (it listed five made-up categories).
  const [categories, setCategories] = useState<string[]>([ALL_CATEGORIES]);
  // 200-technician §2: the chosen technician's name — from the picker, or looked up once for a preselected ?technicianId
  // (one row from the server-paged read); the screen never loads the roster
  const [selectedTechName, setSelectedTechName] = useState<string | undefined>(undefined);
  
  const [partySize, setPartySize] = useState(1);
  const [selectedServices, setSelectedServices] = useState<ServiceCatalogItem[]>([]);
  const [selectedAddons, setSelectedAddons] = useState<{addon: AddonItem, parentServiceId: string}[]>([]);
  const [priceOverrides, setPriceOverrides] = useState<Record<string, PriceOverride>>({});
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORIES);
  const [visitNotes, setVisitNotes] = useState('');
  const [sendSms, setSendSms] = useState(true);
  const [sendReminder, setSendReminder] = useState(true);
  const [selectedTime, setSelectedTime] = useState<string | null>(paramTime);   // never a made-up default: the user picks an open time
  const [selectedTechId, setSelectedTechId] = useState<string>(paramTechId || '');
  const [openTimes, setOpenTimes] = useState<string[] | null>(null);   // null = loading; [] = nothing open
  const [openTimesError, setOpenTimesError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<Msg>('');   // a key, translated at render (a language switch re-labels it)

  // Customer State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // Checkout One-Screen mandate §58 (Oct 28 2026): Checkout's "Rebook Guest" hands over ?customerId=&customerName=&customerPhone=
  // — the new booking opens with that guest already chosen (the Booking domain still validates the customer on save).
  // Four-Module Completion Guide CR-04 (Oct 30 2026): Customer Retention's "Book appointment" hands over ?customerId= ONLY
  // (no name / phone in the URL). Either way the customer is LOADED from the server (this salon's record only) before it is
  // shown as chosen; a deleted / other-salon id → an actionable message and the manual search. Nothing is saved by opening
  // this screen — only the explicit Confirm Booking submit creates the appointment.
  const prefillId = searchParams.get('customerId');
  const [prefill, setPrefill] = useState<'idle' | 'loading' | 'ok' | 'failed'>(prefillId ? 'loading' : 'idle');
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(() => {
    const id = prefillId; const name = searchParams.get('customerName');
    return id && name ? { customerId: id, fullName: name, name, phone: searchParams.get('customerPhone') || undefined } : null;
  });
  const [guestMode, setGuestMode] = useState(false);
  useEffect(() => {
    if (!prefillId) return;
    let alive = true;
    posCustomersApi.getDetail(prefillId).then((d: any) => {
      if (!alive) return;
      if (!d?.customerId || d.status === 'archived') { setSelectedCustomer(null); setPrefill('failed'); return; }
      const fullName = d.displayName || [d.firstName, d.lastName].filter(Boolean).join(' ');
      setGuestMode(false); setSelectedCustomer({ customerId: d.customerId, fullName, name: fullName, phone: d.phone || undefined, avatarUrl: d.avatarUrl || undefined, isVip: !!d.isVip }); setPrefill('ok');
    }, () => { if (!alive) return; setSelectedCustomer(null); setPrefill('failed'); });
    return () => { alive = false; };
  }, [prefillId]);
  const [guestName, setGuestName] = useState('');
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [creatingCustomerError, setCreatingCustomerError] = useState<Msg>('');
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const intentKeys = useRef(createIntentKeys());   // mandate §31: one Idempotency-Key per booking intent
  // B-22 (Oct 22 2026): Save Draft keeps this form as a REAL draft (never an appointment); the drafts of this branch are
  // listed here to resume or discard; a resumed draft leaves the list as 'converted' once the booking is confirmed
  const [drafts, setDrafts] = useState<BookingDraft[]>([]);
  const [resumedDraftId, setResumedDraftId] = useState<string | null>(null);
  const loadDrafts = () => { const api = posBookingApi.drafts; if (!api?.list) return; api.list().then((r) => setDrafts(r?.drafts || [])).catch(() => setDrafts([])); };
  useEffect(() => { loadDrafts(); }, []);

  // Date Logic
  const today = ymdToLocalDate(localYmd(new Date()))!;   // local midnight today
  const initialDate = ymdToLocalDate(paramDate) ?? today;   // the hand-off is only the STARTING day
  const [selectedDate, setSelectedDate] = useState<Date>(initialDate);

  const isPastDate = (d: Date) => {
    const t = new Date();
    t.setHours(0,0,0,0);
    const check = new Date(d);
    check.setHours(0,0,0,0);
    return check.getTime() < t.getTime();
  };

  const isPastTime = (timeStr: string) => {
    const todayStr = localYmd(new Date());
    if (localYmd(selectedDate) !== todayStr) {
      return isPastDate(selectedDate);
    }
    const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) return false;
    const [_, hStr, mStr, ampm] = match;
    let hours = parseInt(hStr, 10);
    const minutes = parseInt(mStr, 10);
    if (ampm.toUpperCase() === 'PM' && hours < 12) hours += 12;
    if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
    
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    return (hours * 60 + minutes) < currentMinutes;
  };

  // Open start times for the day / services / technician on screen (the server's availability — see openStartTimes)
  // the whole visit's length: the main services AND their add-ons (a 45-min gel + a 15-min nail art needs 60 open minutes)
  const serviceKey = [...selectedServices.map((x) => x.serviceId), ...selectedAddons.map((a) => a.addon.serviceId)].join(',');
  const dayMs = selectedDate.getTime();
  useEffect(() => {
    let live = true; setOpenTimes(null); setOpenTimesError(false);
    const date = localYmd(new Date(dayMs));
    Promise.resolve()
      .then(() => posBookingApi.availability({ date, serviceIds: serviceKey ? serviceKey.split(',') : [], technicianId: selectedTechId || undefined }))
      .then((rows: any) => { if (live) setOpenTimes(openStartTimes(Array.isArray(rows) ? rows : [], selectedTechId || undefined)); })
      .catch(() => { if (live) { setOpenTimesError(true); setOpenTimes(FALLBACK_START_TIMES); } });
    return () => { live = false; };
  }, [dayMs, serviceKey, selectedTechId]);

  // a technician handed in by the board (?technicianId=): her name, one row from the server (never the roster)
  useEffect(() => {
    if (!paramTechId) return;
    let live = true;
    void lookupTechnicianName(paramTechId).then((nm) => { if (live && nm) setSelectedTechName((cur) => cur ?? nm); });
    return () => { live = false; };
  }, [paramTechId]);

  // Load Catalog
  useEffect(() => {
    let alive = true;
    posBookingApi.state({ roster: 'none' }).then((res: any) => {
      if (!alive) return;   // §2: services + categories only; technicians come from the picker
      const apiSvcs = (res.filters?.services || []).map((s: any) => ({
        serviceId: s.serviceId,
        name: s.name,
        category: s.category || 'Services',
        priceCents: s.priceCents || 0,
        durationMinutes: s.durationMinutes || 30
      }));
      setServices(apiSvcs);
      // the board's Find an Opening / Best Matches hand off the service they searched for (?serviceId=) — it arrives selected
      const handed = paramServiceId ? apiSvcs.find((x: ServiceCatalogItem) => x.serviceId === paramServiceId) : null;
      if (handed) setSelectedServices((cur) => (cur.length ? cur : [handed]));
      // Use the tenant's REAL catalog categories; examples from the mockup are never inserted as data.
      // Booking state is the safe initial fallback when the catalog admin read is not permitted.
      const fromBooking = [...(res.filters?.serviceCategories || []), ...apiSvcs.map((s: ServiceCatalogItem) => s.category)]
        .filter((name: unknown): name is string => typeof name === 'string' && name.trim().length > 0);
      setCategories([ALL_CATEGORIES, ...Array.from(new Set<string>(fromBooking))]);
      // Tenant category CRUD already exists; fetch the active category order, including empty categories.
      // This is a read-only enrichment, never a second service catalog or a booking dependency.
      void posServicesApi.categories().then((rows: any) => {
        if (!alive || !Array.isArray(rows)) return;
        const active = rows.filter((c: any) => c?.status === 'active' && typeof c?.name === 'string' && c.name.trim())
          .map((c: any) => c.name as string);
        setCategories((prior) => [ALL_CATEGORIES, ...Array.from(new Set<string>([...active, ...prior.filter((c) => c !== ALL_CATEGORIES)]))]);
      }).catch(() => { /* Booking still works with the tenant-scoped booking-state categories. */ });
      setLoading(false);
    }).catch((e: any) => {
      if (!alive) return;
      console.error(e);
      setCatalogError(CATALOG_ERROR);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [paramServiceId]);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowSearchDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Search Debounce
  useEffect(() => {
    if (!searchQuery.trim() || selectedCustomer) {
      setSearchResults([]);
      return;
    }
    const delay = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res: any = await posCustomersApi.quickSearch(searchQuery);
        setSearchResults(res?.items || res || []);
        setShowSearchDropdown(true);
      } catch (e) {
        console.error(e);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(delay);
  }, [searchQuery, selectedCustomer]);

  // Handlers
  const toggleService = (svc: ServiceCatalogItem) => {
    setSelectedServices(prev => 
      prev.some(p => p.serviceId === svc.serviceId)
        ? prev.filter(p => p.serviceId !== svc.serviceId)
        : [...prev, svc]
    );
  };

  const toggleAddon = (addon: AddonItem) => {
    if (selectedServices.length === 0) return;
    const parentServiceId = selectedServices[0].serviceId; 
    
    setSelectedAddons(prev => 
      prev.some(p => p.addon.serviceId === addon.serviceId)
        ? prev.filter(p => p.addon.serviceId !== addon.serviceId)
        : [...prev, { addon, parentServiceId }]
    );
  };

  const handlePriceOverride = (serviceId: string, priceCents: number, reason: string) => {
    setPriceOverrides(prev => ({ ...prev, [serviceId]: { priceCents, reason } }));
  };

  const handleRestorePrice = (serviceId: string) => {
    setPriceOverrides(prev => {
      const next = { ...prev };
      delete next[serviceId];
      return next;
    });
  };

  const totalMinutes = selectedServices.reduce((acc, s) => acc + s.durationMinutes, 0) + 
                       selectedAddons.reduce((acc, a) => acc + a.addon.durationMinutes, 0);
  const totalCents = selectedServices.reduce((acc, s) => {
    const ov = priceOverrides[s.serviceId];
    return acc + (ov ? ov.priceCents : s.priceCents);
  }, 0) + selectedAddons.reduce((acc, a) => acc + a.addon.priceCents, 0);

  const resumeDraft = (d: BookingDraft) => {
    const p: any = d.payload || {};
    const byId = new Map(services.map((x) => [x.serviceId, x]));
    const lines: any[] = Array.isArray(p.serviceLines) ? p.serviceLines : [];
    setSelectedServices(lines.filter((l) => !l.isAddon).map((l) => byId.get(l.serviceId)).filter((x): x is ServiceCatalogItem => !!x));
    setSelectedAddons(lines.filter((l) => l.isAddon && byId.get(l.serviceId)).map((l) => ({ addon: byId.get(l.serviceId) as unknown as AddonItem, parentServiceId: String(l.parentServiceId || '') })));
    setPriceOverrides(p.priceOverrides && typeof p.priceOverrides === 'object' ? p.priceOverrides : {});
    setPartySize(Number(p.partySize) > 0 ? Number(p.partySize) : 1);
    setVisitNotes(String(p.notes || '').replace(/^\[DRAFT\]\s*/i, ''));
    setSelectedTechId(p.technicianId ? String(p.technicianId) : '');
    const day = ymdToLocalDate(p.date); if (day) setSelectedDate(day);
    if (typeof p.startTime === 'string' && /^\d{2}:\d{2}$/.test(p.startTime)) { const [h, m] = p.startTime.split(':').map(Number); const h12 = h % 12 || 12; setSelectedTime(`${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`); }
    if (p.customerId) { setGuestMode(false); setSelectedCustomer({ customerId: p.customerId, fullName: p.customerName, name: p.customerName, phone: p.customerPhone }); }
    else if (p.customerName) { setGuestMode(true); setGuestName(String(p.customerName)); setSelectedCustomer(null); }
    setResumedDraftId(d.draftId);
  };
  const discardDraft = async (d: BookingDraft) => {
    try { await posBookingApi.drafts.discard(d.draftId); } catch { /* the list reload tells the truth */ }
    if (resumedDraftId === d.draftId) setResumedDraftId(null);
    loadDrafts();
  };

  const buildPayload = (_isDraft: boolean) => {   // B-22: a draft is the same form, saved through /pos/booking/drafts
    const formattedDate = localYmd(selectedDate);   // the day on screen — a ?date= hand-off no longer overrides the user's pick

    const payload: any = {
      serviceIds: selectedServices.map(s => s.serviceId),
      serviceLines: [
        ...selectedServices.map(s => ({
          serviceId: s.serviceId,
          name: s.name,
          durationMinutes: s.durationMinutes,
          priceCents: priceOverrides[s.serviceId]?.priceCents ?? s.priceCents,
          overrideReason: priceOverrides[s.serviceId]?.reason,
        })),
        ...selectedAddons.map(a => ({
          serviceId: a.addon.serviceId,
          name: a.addon.name,
          durationMinutes: a.addon.durationMinutes,
          priceCents: a.addon.priceCents,
          isAddon: true,
          parentServiceId: a.parentServiceId,
        }))
      ],
      priceOverrides,
      partySize,
      date: formattedDate,
      startTime: selectedTime ? convertTo24Hour(selectedTime) : undefined,
      technicianId: selectedTechId || undefined,
      source: 'manual',
      notes: visitNotes || undefined   // B-22: a draft is a real draft now, never a tagged appointment (isDraft kept for callers)
    };

    if (guestMode) {
      payload.customerName = guestName.trim();
    } else if (selectedCustomer) {
      payload.customerId = selectedCustomer.customerId;
      payload.customerName = selectedCustomer.fullName || selectedCustomer.name;
      payload.customerPhone = selectedCustomer.phone;
    }
    
    return payload;
  };

  const validateForm = () => {
    setErrorMsg('');
    if (!selectedCustomer && !guestMode) {
      setErrorMsg(msg('ops.booking.selectCustomerOrGuest'));
      return false;
    }
    if (guestMode && !guestName.trim()) {
      setErrorMsg(msg('pos.guest_name_is_required'));
      return false;
    }
    if (selectedServices.length === 0) {
      setErrorMsg(msg('ops.booking.selectService'));
      return false;
    }
    if (!selectedTime) {
      setErrorMsg(msg('ops.booking.selectStartTime'));
      return false;
    }
    return true;
  };

  const handleConfirmBooking = async () => {
    if (!validateForm()) return;
    setIsSubmitting(true);
    try {
      let createdId: string | null = null;
      { const body = buildPayload(false); const created: any = await posBookingApi.create(body, intentKeys.current.keyFor('booking-create', body)); intentKeys.current.done('booking-create'); createdId = created?.id ? String(created.id) : created?.appointment?.id ? String(created.appointment.id) : null; }
      if (resumedDraftId) { await posBookingApi.drafts.converted(resumedDraftId).catch(() => undefined); }   // B-22: the draft this booking came from leaves the list
      // Communications / SMS Inbox guide §9.3 (Oct 30 2026): a booking opened from a conversation returns to THAT conversation
      // (its timeline now shows the appointment); the id is the only thing carried — no phone, no name.
      const backTo = searchParams.get('from') === 'communications' ? searchParams.get('conversationId') : null;
      // C2 audit (Nov 4 2026): the booking is linked back to the conversation it came from (its event log); a failed link
      // never undoes the booking — the timeline still shows it through the customer
      if (backTo && createdId && /^[0-9a-f-]{36}$/i.test(backTo)) await posCommunicationsApi.inbox.linkBooking(backTo, createdId).catch(() => undefined);
      navigate(backTo && /^[0-9a-f-]{36}$/i.test(backTo) ? `/tenant/communications/sms?thread=${encodeURIComponent(backTo)}` : '/booking');
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message || msg('pos.failed_to_create_booking'));
      setIsSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!validateForm()) return;
    setIsSubmitting(true);
    try {
      const saved = await posBookingApi.drafts.save(buildPayload(false));
      if (resumedDraftId && resumedDraftId !== saved.draftId) await posBookingApi.drafts.discard(resumedDraftId).catch(() => undefined);   // the old copy is superseded
      navigate('/booking');
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message || msg('pos.failed_to_save_draft'));
      setIsSubmitting(false);
    }
  };

  const handleCreateCustomer = async () => {
    setCreatingCustomerError('');
    if (!newCustomerName.trim()) {
      setCreatingCustomerError(msg('pos.name_is_required'));
      return;
    }
    if (!newCustomerPhone.trim()) {
      setCreatingCustomerError(msg('ops.booking.phoneRequired'));
      return;
    }
    try {
      const res: any = await posCheckInApi.createCustomer({
        fullName: newCustomerName.trim(),
        phone: newCustomerPhone.trim(),
        smsOptIn: true
      });
      setSelectedCustomer(res);
      setIsCreatingCustomer(false);
      setNewCustomerName('');
      setNewCustomerPhone('');
      setSearchQuery('');
    } catch (e: any) {
      console.error(e);
      setCreatingCustomerError(e?.message || msg('pos.failed_to_create_customer'));
    }
  };

  const renderCustomerDisplay = () => {
    if (guestMode) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexGrow: 1, marginLeft: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#F2EFEA', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontWeight: 600 }}>GS</div>
          <input 
            autoFocus
            placeholder={tx('pos.enter_guest_name')} 
            value={guestName} 
            onChange={e => setGuestName(e.target.value)} 
            style={{ height: 36, padding: '0 12px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, minWidth: 200 }} 
          />
          <span style={{ fontSize: 13, color: 'var(--muted)', marginLeft: 8 }}>{tx('pos.guest_check_in')}</span>
          <button onClick={() => { setGuestMode(false); setGuestName(''); }} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--aps-orange)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{tx('pos.change')}</button>
        </div>
      );
    }

    if (prefill === 'loading' && !selectedCustomer) return <div data-testid="booking-prefill-loading" style={{ flexGrow: 1, marginLeft: 12, fontSize: 13, color: 'var(--muted)' }}>{tx('rt3.bookPrefill.loading')}</div>;
    if (selectedCustomer) {
      const fullName = selectedCustomer.fullName || selectedCustomer.name || tx('pos.customer');
      return (
        <div data-testid="booking-selected-customer" data-customer-id={selectedCustomer.customerId} style={{ display: 'flex', alignItems: 'center', gap: 12, flexGrow: 1, marginLeft: 12 }}>
          <ProfileAvatarWithPreview name={fullName} url={selectedCustomer.avatarUrl} size={36} type="customer" />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{fullName}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
              {selectedCustomer.phone || tx('pos.no_phone_2')}
              <span style={{ color: 'var(--line)' }}>|</span>
              <span>{tx('pos.returning_customer')}</span>
            </div>
          </div>
          <button onClick={() => { setSelectedCustomer(null); setSearchQuery(''); }} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--aps-orange)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{tx('pos.change')}</button>
        </div>
      );
    }

    if (isCreatingCustomer) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexGrow: 1, marginLeft: 12 }}>
          <input 
            autoFocus
            placeholder={tx('pos.full_name_2')} 
            value={newCustomerName} 
            onChange={e => setNewCustomerName(e.target.value)} 
            style={{ height: 36, padding: '0 12px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, minWidth: 200 }} 
          />
          <input 
            placeholder={tx('pos.phone_2')} 
            value={newCustomerPhone} 
            onChange={e => setNewCustomerPhone(e.target.value)} 
            style={{ height: 36, padding: '0 12px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, minWidth: 150 }} 
          />
          <button onClick={handleCreateCustomer} className="btn solid" style={{ height: 36 }}>{tx('pos.save_2')}</button>
          <button onClick={() => { setIsCreatingCustomer(false); setCreatingCustomerError(''); }} className="btn ghost" style={{ height: 36 }}>{tx('pos.cancel')}</button>
          {creatingCustomerError && <span style={{ color: 'var(--aps-red)', fontSize: 13, marginLeft: 8 }}>{renderMsg(creatingCustomerError)}</span>}
        </div>
      );
    }

    return (
      <div style={{ flexGrow: 1, display: 'flex', gap: 12, alignItems: 'center', marginLeft: 12 }}>
        <div ref={searchContainerRef} style={{ position: 'relative', flexGrow: 1, maxWidth: 300 }}>
          <FiSearch style={{ position: 'absolute', left: 12, top: 10, color: 'var(--muted)' }} />
          <input 
            placeholder={tx('pos.search_name_or_phone')} 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => { if (searchResults.length > 0) setShowSearchDropdown(true); }}
            style={{ width: '100%', height: 36, paddingLeft: 36, borderRadius: 18, border: '1px solid var(--line)', background: '#F9F8F5', boxSizing: 'border-box' }} 
          />
          {isSearching && <div style={{ position: 'absolute', right: 12, top: 10, fontSize: 12, color: 'var(--muted)' }}>...</div>}
          
          {showSearchDropdown && searchResults.length > 0 && (
            <div style={{ position: 'absolute', top: 40, left: 0, right: 0, background: '#FFF', borderRadius: 8, border: '1px solid var(--line)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 100, maxHeight: 300, overflowY: 'auto' }}>
              {searchResults.map(c => (
                <div 
                  key={c.customerId} 
                  onClick={() => { setSelectedCustomer(c); setShowSearchDropdown(false); }}
                  style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', cursor: 'pointer', display: 'flex', flexDirection: 'column' }}
                >
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{c.fullName || c.name}</span>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>{c.phone}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="btn ghost" onClick={() => setIsCreatingCustomer(true)} style={{ height: 36 }}>{tx('pos.new_customer_2')}</button>
        <button className="btn outline" onClick={() => setGuestMode(true)} style={{ height: 36 }}>{tx('pos.continue_as_guest')}</button>
      </div>
    );
  };

  const customerDisplayName = guestMode ? (guestName || tx('pos.guest')) : (selectedCustomer?.fullName || selectedCustomer?.name || tx('pos.customer'));

  return (
    <div style={{ padding: '20px', height: '100%', overflowY: 'auto', background: '#FFFCF6' }}>
      {drafts.length > 0 && (
        <div data-testid="booking-drafts" style={{ marginBottom: 12, padding: '10px 14px', background: '#FFF', border: '1px solid var(--line)', borderRadius: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 700, color: '#4A4032', fontSize: 14 }}>{tx('pos.drafts')} ({drafts.length})</span>
          {drafts.map((d) => (
            <span key={d.draftId} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--line)', borderRadius: 20, padding: '4px 10px', fontSize: 13, background: resumedDraftId === d.draftId ? '#FFF3E8' : '#FFFCF6' }}>
              <span>{d.title || tx('pos.new_booking_2')}{d.date ? ` · ${d.date}` : ''}{d.startTime ? ` ${d.startTime}` : ''}</span>
              <button type="button" className="btn outline" style={{ height: 40, padding: '0 12px' }} onClick={() => resumeDraft(d)}>{tx('pos.resume')}</button>
              <button type="button" className="btn outline" style={{ height: 40, padding: '0 12px' }} onClick={() => discardDraft(d)}>{tx('pos.discard')}</button>
            </span>
          ))}
        </div>
      )}
      {/* Header */}
      <div className="vh flex flex-col md:flex-row gap-3 justify-between">
        <div>
          <button onClick={() => navigate('/booking')} style={{ background: 'none', border: 'none', color: 'var(--aps-orange)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, padding: 0, marginBottom: 8 }}>
            <FiArrowLeft /> {tx('pos.back_to_booking')}
          </button>
          <h1 style={{ margin: 0, fontSize: 24, color: '#1f1b16' }}>{tx('pos.new_booking_2')}{' '}<span style={{ fontSize: 14, fontWeight: 400, color: 'var(--muted)', marginLeft: 8 }}>{tx('pos.choose_services_pick_a_technician_and_t93w')}</span></h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ background: '#FFF', border: '1px solid var(--line)', padding: '6px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, color: '#E8742B', display: 'flex', alignItems: 'center', gap: 6 }}>
            <FiCalendar />
            {tx('pos.appointment_3')}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#4A4032' }}>{tx('pos.schedule_for')}{' '}{fmtYmd(localYmd(selectedDate), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
        </div>
        </div>
      

      <div className="grid grid-cols-1 2xl:grid-cols-[1.46fr_0.54fr] gap-3 mt-6">
        {/* Left Content Area (73%) */}
        <div
          className="w-full max-w-full min-w-0 overflow-x-auto"
          style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
        >
          <div className="min-w-[800px] w-full pb-2">
          
          {/* 1. Customer Section */}
          <section style={{ background: '#FFF', border: '1px solid var(--line)', borderRadius: 12, padding: '16px 20px', marginBottom: 24 }}>
            {prefill === 'failed' ? <div role="alert" data-testid="booking-prefill-failed" style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: '#FFF4F2', color: '#B42318', fontSize: 13 }}>{tx('rt3.bookPrefill.failed')}</div> : null}
            {prefill === 'ok' && searchParams.get('from') === 'retention' && selectedCustomer?.customerId === prefillId ? <div data-testid="booking-prefill-note" style={{ marginBottom: 10, fontSize: 13, color: 'var(--muted)' }}>{tx('rt3.bookPrefill.from')}</div> : null}
            {prefill === 'ok' && searchParams.get('from') === 'communications' && selectedCustomer?.customerId === prefillId ? <div data-testid="booking-prefill-note" style={{ marginBottom: 10, fontSize: 13, color: 'var(--muted)' }}>{tx('ci.bookPrefill.from')}</div> : null}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--aps-orange)', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>1</div>
              <h2 style={{ margin: 0, fontSize: 18 }}>{tx('pos.customer')}</h2>
              
              {renderCustomerDisplay()}

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderLeft: '1px solid var(--line)', paddingLeft: 16, flexShrink: 0 }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>{tx('pos.party_size')}</span>
                <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                  <button onClick={() => setPartySize(Math.max(1, partySize - 1))} style={{ width: 32, height: 32, background: '#FFF', border: 'none', cursor: 'pointer' }}><FiMinus /></button>
                  <div style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid var(--line)', borderRight: '1px solid var(--line)', fontWeight: 600 }}>{partySize}</div>
                  <button onClick={() => setPartySize(partySize + 1)} style={{ width: 32, height: 32, background: '#FFF', border: 'none', cursor: 'pointer', color: 'var(--aps-orange)' }}><FiPlus /></button>
                </div>
              </div>
            </div>
          </section>

          {/* 2. Services Section */}
          <section>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--aps-orange)', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>2</div>
              <h2 style={{ margin: 0, fontSize: 18 }}>{tx('pos.choose_services')}{' '}<span style={{ fontSize: 13, fontWeight: 400, color: 'var(--muted)', marginLeft: 8 }}>{tx('pos.tap_a_card_to_add_select_14er')}</span></h2>
            </div>

            {/* In-page quick picker: replaces old horizontal category tabs; sidebar and top bar untouched. */}
            <QuickServiceCategoryPicker
              categories={categories}
              services={services}
              activeCategory={activeCategory}
              onSelectCategory={setActiveCategory}
              allValue={ALL_CATEGORIES}
              allLabel={tx('pos.all_services')}
            />

            {/* Service Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 185px), 1fr))', gap: 12 }}>
              {services.length === 0 && (
                <div role="status" className="s muted" style={{ padding: 12 }}>{catalogError ? tx(catalogError) : (loading ? tx('pos.loading_services') : tx('pos.this_salon_has_no_services_in_387i'))}</div>
              )}
              {services.length > 0 && activeCategory !== ALL_CATEGORIES && !services.some(s => s.category === activeCategory) && (
                <div role="status" className="s muted" data-testid="empty-category-services" style={{ padding: 14 }}>
                  {tx('pos.this_salon_has_no_services_in_387i')}
                </div>
              )}
              {services.filter(s => activeCategory === ALL_CATEGORIES || s.category === activeCategory).map(svc => (
                <ServiceCard 
                  key={svc.serviceId} 
                  item={svc} 
                  selected={selectedServices.some(s => s.serviceId === svc.serviceId)}
                  onToggle={toggleService} 
                />
              ))}
            </div>

            {/* Popular Add-ons */}
            <div style={{ marginTop: 32 }}>
              <h3 style={{ fontSize: 15, marginBottom: 12 }}>{tx('pos.popular_add_ons')}{' '}<span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>{tx('pos.tap_to_add_can_be_added_yzfq')}</span></h3>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {services.filter(s => isAddOnCategory(s.category)).length === 0 ? <div className="s muted">{tx('pos.no_add_ons_in_this_salon_fyus')}</div> : null}
                {services.filter(s => isAddOnCategory(s.category)).map(addon => (
                  <div key={addon.serviceId} style={{ minWidth: 200 }}>
                    <AddonCard 
                      item={addon as AddonItem}
                      selected={selectedAddons.some(a => a.addon.serviceId === addon.serviceId)}
                      onToggle={toggleAddon}
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>

        </div>
        </div>

        {/* Right Summary Area (27%) */}
        <div >
          <div style={{ background: '#FFF', border: '1px solid var(--line)', borderRadius: 12, padding: 20, position: 'sticky', top: 24 }}>
            <BookingSummary 
              services={selectedServices} 
              addons={selectedAddons} 
              priceOverrides={priceOverrides}
              onPriceOverride={handlePriceOverride}
              canOverridePrice={canOverridePrice}
              onRestorePrice={handleRestorePrice}
              onRemoveService={(id) => setSelectedServices(prev => prev.filter(s => s.serviceId !== id))}
              onRemoveAddon={(id) => setSelectedAddons(prev => prev.filter(a => a.addon.serviceId !== id))}
            />

              {/* Technician & Time */}
              <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--aps-orange)', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12 }}>3</div>
                  <h3 style={{ margin: 0, fontSize: 16 }}>{tx('pos.technician_time')}</h3>
                </div>

                <div style={{ marginBottom: 16 }}>
                  {/* 200-technician mandate: searchable, server-paged, only technicians approved for the chosen services */}
                  <TechnicianPicker value={selectedTechId} onChange={(id, t) => { setSelectedTechId(id); setSelectedTechName(t?.name); }} anyLabel={tx('pos.first_available')}
                    date={localYmd(selectedDate)} serviceIds={selectedServices.map((sv) => sv.serviceId)}
                    selectedName={selectedTechId ? selectedTechName : undefined} />
                </div>

                <label style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4, display: 'block' }}>{tx('pos.appointment_date')}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <input 
                    type="date"
                    aria-label={tx('pos.appointment_date')}
                    min={localYmd(new Date())}
                    value={localYmd(selectedDate)}
                    onChange={(e) => {
                      const d = ymdToLocalDate(e.target.value);
                      if (d) setSelectedDate(d);
                    }}
                    style={{ 
                      height: 36, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', 
                      border: '1px solid var(--line)', borderRadius: 8, background: '#FFF', 
                      flexGrow: 1, fontWeight: 600, color: '#4A4032', cursor: 'pointer', fontFamily: 'inherit'
                    }}
                  />
                  <div style={{ display: 'flex' }}>
                    <button onClick={() => {
                      const prev = new Date(selectedDate);
                      prev.setDate(prev.getDate() - 1);
                      setSelectedDate(prev);
                    }} style={{ width: 36, height: 36, background: '#FFF', border: '1px solid var(--line)', borderRadius: '8px 0 0 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><FiChevronLeft /></button>
                    <button onClick={() => {
                      const next = new Date(selectedDate);
                      next.setDate(next.getDate() + 1);
                      setSelectedDate(next);
                    }} style={{ width: 36, height: 36, background: '#FFF', border: '1px solid var(--line)', borderLeft: 'none', borderRadius: '0 8px 8px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><FiChevronRight /></button>
                  </div>
                </div>

              {/* 7 Day Tiles */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 16, justifyContent: 'space-between' }}>
                {Array.from({ length: 7 }).map((_, i) => {
                  const day = new Date(selectedDate);
                  day.setDate(selectedDate.getDate() - 3 + i);
                  const isSelected = localYmd(day) === localYmd(selectedDate);
                  const dayName = fmtYmd(localYmd(day), { weekday: 'short' });
                  const dayNum = day.getDate();
                  const past = isPastDate(day);
                  
                  return (
                    <button key={i} disabled={past} onClick={() => setSelectedDate(day)} style={{ 
                      flex: 1, padding: '4px 0', border: isSelected ? 'none' : '1px solid var(--line)', 
                      background: isSelected ? 'var(--aps-orange)' : '#FFF', color: isSelected ? '#FFF' : 'var(--text)', 
                      borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: past ? 'not-allowed' : 'pointer',
                      opacity: past ? 0.4 : 1
                    }}>
                      <span style={{ fontSize: 10, fontWeight: 600 }}>{dayName}</span>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{dayNum}</span>
                    </button>
                  );
                })}
              </div>

              {/* Available Start Times */}
              <label style={{ fontSize: 13, color: '#1f1b16', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 }}>
                {tx('pos.available_start_times')}
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>{tx('pos.fits_all_selected_services')}</span>
              </label>
              
              {openTimes === null && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{tx('pos.loading_open_times')}</div>}
              {openTimesError && <div role="status" style={{ fontSize: 12, color: '#B45309', marginBottom: 8 }}>{tx('pos.open_times_unavailable')}</div>}
              {openTimes !== null && !openTimesError && openTimes.length === 0 && <div role="status" style={{ fontSize: 12, color: '#B45309', marginBottom: 8 }}>{tx('pos.no_open_start_time_fits')}</div>}
              {selectedTime && openTimes && !openTimesError && openTimes.length > 0 && !openTimes.includes(selectedTime) && <div role="status" style={{ fontSize: 12, color: '#B45309', marginBottom: 8 }}>{tx('pos.selected_time_not_open', { time: selectedTime })}</div>}
              <div data-testid="open-start-times" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
                {(openTimes ?? []).map(time => {
                  const past = isPastTime(time);
                  return (
                    <button 
                      key={time} 
                      disabled={past}
                      onClick={() => setSelectedTime(time)}
                      style={{ 
                        height: 40, border: selectedTime === time ? 'none' : '1px solid var(--line)', 
                        background: selectedTime === time ? 'var(--aps-orange)' : '#FFF', 
                        color: selectedTime === time ? '#FFF' : '#1f1b16', 
                        borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: past ? 'not-allowed' : 'pointer',
                        opacity: past ? 0.3 : 1
                      }}
                    >
                      {clockText(time)}
                    </button>
                  );
                })}
              </div>

              {/* Selected Time Strip */}
              {selectedTime && (
                <div style={{ background: '#E8F5E9', borderRadius: 8, padding: 12, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#2E7D32', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <FiCheck size={10} />
                  </div>
                  <div style={{ fontSize: 13, color: '#2E7D32', fontWeight: 700 }}>
                    {clockText(selectedTime)} – {clockText(clockPlusMinutes(selectedTime, totalMinutes))} <span style={{ fontWeight: 400 }}>&middot; {durationLabel(totalMinutes)}</span>
                  </div>
                </div>
              )}

              <div style={{ marginTop: 16 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>{tx('pos.visit_notes')}</label>
                <textarea 
                  value={visitNotes}
                  onChange={e => setVisitNotes(e.target.value)}
                  placeholder={tx('pos.preferences_or_special_requests')} 
                  style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: 10, marginTop: 4, minHeight: 60, boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 13 }}
                />
              </div>

              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={sendSms} onChange={e => setSendSms(e.target.checked)} style={{ marginTop: 2 }} />
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{tx('pos.send_confirmation_by_sms')}</div>
                </label>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={sendReminder} onChange={e => setSendReminder(e.target.checked)} style={{ marginTop: 2 }} />
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{tx('pos.send_appointment_reminder')}</div>
                </label>
              </div>
            </div>

            {/* Totals */}
            <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--muted)', fontSize: 14 }}>{tx('pos.service_time')}</span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{Math.floor(totalMinutes / 60) > 0 ? tx('pos.v0_hr', { v0: String(Math.floor(totalMinutes / 60)) }) : ''}{totalMinutes % 60} {tx('pos.min')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text)', fontSize: 16, fontWeight: 600 }}>{tx('pos.estimated_total_2')}</span>
                <span style={{ fontWeight: 800, fontSize: 24 }}>${((totalCents || 0) / 100).toFixed(2)}</span>
              </div>
            </div>
            
            {errorMsg && (
              <div style={{ marginTop: 16, padding: 12, background: '#FFF0F0', border: '1px solid #FFCDD2', borderRadius: 8, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <FiAlertCircle color="#D32F2F" style={{ flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: 13, color: '#D32F2F', fontWeight: 600, lineHeight: 1.4 }}>{renderMsg(errorMsg)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fixed Bottom Bar */}
      <div className="w-full bg-white border-t border-[var(--line)] px-4 py-3 md:px-6 md:py-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between mt-4">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#E3D8F5', color: '#7E57C2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
            {customerDisplayName.substring(0, 2).toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{customerDisplayName} <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 13 }}>&middot; {fmtYmd(localYmd(selectedDate), { weekday: 'short', month: 'short', day: 'numeric' })} &middot; {selectedTime ? `${clockText(selectedTime)} – ${clockText(clockPlusMinutes(selectedTime, totalMinutes))}` : tx('pos.no_time_picked')}</span></div>
            <div style={{ color: 'var(--muted)', fontSize: 14 }}>{(selectedTechId ? selectedTechName : undefined) ?? tx('pos.any_available_technician_2')} &middot; {selectedServices.length} {tx('pos.service')}{enPlural(selectedServices.length === 1 ? '' : 's')} + {selectedAddons.length} {tx('pos.add_on')}{enPlural(selectedAddons.length === 1 ? '' : 's')} &middot; <span style={{ fontWeight: 800, color: '#1f1b16' }}>${((totalCents || 0) / 100).toFixed(2)}</span></div>
          </div>
        </div>
        <div className='whitespace-nowrap' style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => navigate('/booking')} className="btn outline" style={{ height: 44, padding: '0 24px' }} disabled={isSubmitting}>{tx('pos.cancel')}</button>
          <button onClick={handleSaveDraft} className="btn outline" style={{ height: 44, padding: '0 24px' }} disabled={isSubmitting}>{tx('pos.save_draft')}</button>
          <button onClick={handleConfirmBooking} className="btn" style={{ height: 44, padding: '0 24px', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }} disabled={isSubmitting}><FiCalendar /> {tx('pos.confirm_booking')}</button>
        </div>
      </div>
    </div>
  );
}
