import { BookingDepositCard } from './BookingDepositCard';
import { useEventCallback } from '@aipowersalon/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { networkState } from '@aipowersalon/mobile-sdk';
import { createIntentKeys } from '@aipowersalon/api-client';
import { useAuth } from '../auth/AuthContext';
import { PhoneVerificationStep } from './PhoneVerificationStep';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  customerApi,
  type BookingOptions,
  type BookingResult,
  type AvailabilitySlot,
  type BookingServiceTech,
  type SalonResult,
  type BookableService,
  type CustomerSalonInfo,
} from '../api/customerApi';
import { money2 } from '../lib/appt';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmt12 = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 || 12;
  return `${hr}:${pad(m)} ${ap}`;
};

export type BookStep = 'date' | 'salon' | 'service' | 'technician_time' | 'review';

const applyOverrides = (svcs: any[]) => {
  try {
    const match = document.cookie.match(/(^| )demo_branchOverrides=([^;]+)/);
    if (!match) return svcs;
    const activeOverride = JSON.parse(decodeURIComponent(match[2]))['Verma Nail Salon'];
    if (!activeOverride) return svcs;
    return svcs.map((s: any) => {
      let price = s.priceCents;
      let dur = s.durationMinutes;
      if (activeOverride.price) {
        const val = activeOverride.price;
        if (val.startsWith('+')) {
           if (val.endsWith('%')) price = Math.round(price * (1 + parseInt(val.slice(1, -1)) / 100));
           else price += parseInt(val.slice(1)) * 100;
        } else {
           const p = parseFloat(val);
           if (!isNaN(p)) price = Math.round(p * 100);
        }
      }
      if (activeOverride.duration) {
        const d = parseInt(activeOverride.duration);
        if (!isNaN(d)) dur = d;
      }
      return { ...s, priceCents: price, durationMinutes: dur };
    });
  } catch (e) {
    return svcs;
  }
};

export function BookScreen() {
  const nav = useNavigate();
  const location = useLocation();
  const locState = (location.state as any) || {};

  // Preselected payload from Home / Discover / Popular Services
  const preService = locState.preService as BookableService | undefined;
  const preSalon = locState.preSalon as SalonResult | CustomerSalonInfo | undefined;
  // "Book This Look" (Technician Profile mandate §46/§47): a portfolio photo (photoId → stored on the appointment) or a
  // Nail Showcase post (source 'showcase' — its photo is not a portfolio photo, so only the style note travels).
  const look = locState.look as { photoId?: string; caption: string | null; imageUrl?: string | null; techName?: string | null; source?: 'portfolio' | 'showcase' } | undefined;
  // ?serviceId= / ?technicianId= (the showcase's links) and the older ?techId= — pre-fills only; the server still validates
  const qp = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const deal = locState.deal as { id: string; title?: string } | undefined;

  // Step state
  const [step, setStep] = useState<BookStep>('date');
  const [error, setError] = useState<string | null>(null);

  // Date selection state
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const days = useMemo(
    () => Array.from({ length: 30 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      return d;
    }),
    [today]
  );
  const [date, setDate] = useState<string>(locState.preDate || ymd(today));

  // Salon selection state
  const [defaultSalon, setDefaultSalon] = useState<CustomerSalonInfo | null>(null);
  const [nearbySalons, setNearbySalons] = useState<SalonResult[]>([]);
  const { principal } = useAuth() as any;
  const [salonsLoading, setSalonsLoading] = useState(false);
  const [selectedSalon, setSelectedSalon] = useState<SalonResult | CustomerSalonInfo | null>(preSalon || null);
  const [salonQuery, setSalonQuery] = useState('');

  // Service selection state
  const [opts, setOpts] = useState<BookingOptions | null>(null);
  const [optsLoading, setOptsLoading] = useState(false);
  const [picked, setPicked] = useState<string[]>(preService ? [preService.id] : []);
  const [serviceQuery, setServiceQuery] = useState('');
  const [cat, setCat] = useState('All');
  const [showAllCats, setShowAllCats] = useState(false);

  // Time & Tech selection state
  const [slots, setSlots] = useState<AvailabilitySlot[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slot, setSlot] = useState<AvailabilitySlot | null>(null);
  const [chosenTech, setChosenTech] = useState<string | null>(
    () => qp.get('technicianId') || qp.get('techId') || null   // the ROUTER's query (window.location missed in-app navigation state)
  );
  const [techCards, setTechCards] = useState<Record<string, BookingServiceTech>>({});
  // §56 / §144: the customer's favourite technicians come FIRST in the choices and are preferred for "Any Available" —
  // a preference only: availability and skills stay the server's call (the slot's technicianIds are already eligible).
  const [favSlugs, setFavSlugs] = useState<Set<string>>(new Set());
  const [favTechIds, setFavTechIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => customerApi.techFavorites())
      .then((r) => { if (!live) return; setFavSlugs(new Set(r?.slugs ?? [])); setFavTechIds(new Set((r?.techs ?? []).map((t) => t.technicianId).filter(Boolean))); })
      .catch(() => undefined);   // signed out / no favourites → no preference, never an error on the booking flow
    return () => { live = false; };
  }, []);
  const isFavorite = useCallback((technicianId: string) => favTechIds.has(technicianId) || (!!techCards[technicianId]?.publicSlug && favSlugs.has(techCards[technicianId]!.publicSlug!)), [favTechIds, favSlugs, techCards]);

  // Submission & verification state
  const [submitting, setSubmitting] = useState(false);
  const bookingKeys = useRef(createIntentKeys());   // BUILD_PLAN Phase 13: one Idempotency-Key per booking attempt
  // Phase 4: the 428's booking session (the slot is HELD for it) — the retry after the code carries it.
  const [verify, setVerify] = useState<{ bookingSessionId: string; maskedPhone: string; holdExpiresAt: string | null; captcha?: boolean } | null>(null);
  const [done, setDone] = useState<BookingResult | null>(null);

  // 1. Initial Data Fetch: Default salon & nearby partner salons
  const loadNearbySalons = useEventCallback(() => {
    let live = true;
    setSalonsLoading(true);

    customerApi.salon()
      .then((s) => {
        if (!live) return;
        setDefaultSalon(s);
        if (!preSalon && s) {
          setSelectedSalon(s);
        }
      })
      .catch(() => {});

    customerApi.salonsNearby({ radiusMiles: 30 })
      .then((r) => {
        // Sep 2026 merge: only salons this account can actually book — partner branches of the signed-in tenant that take
        // in-app bookings (the server refuses any other salonId). The redesign offered every nearby salon, Google ones included.
        if (live) setNearbySalons((r.results || []).filter((x) => x.is_aipowersalon_partner && x.is_bookable_in_app && (!x.tenant_id || x.tenant_id === principal?.tenantId)));
      })
      .catch(() => {})
      .finally(() => {
        if (live) setSalonsLoading(false);
      });

    return () => {
      live = false;
    };
  });
  useEffect(() => loadNearbySalons(), [loadNearbySalons]);

  // 2. Fetch booking options (services & technicians) for the current salon
  const loadOptions = useEventCallback(() => {
    let live = true;
    setOptsLoading(true);
    setError(null);

    // If a specific partner salon is chosen that is different from session tenant, fetch its services
    const salonId = (selectedSalon as SalonResult)?.salon_id || defaultSalon?.id;
    if (salonId && (selectedSalon as SalonResult)?.is_aipowersalon_partner) {
      Promise.all([
        customerApi.salonServices(salonId).catch(() => []),
        customerApi.salonTechnicians(salonId).catch(() => ({ technicians: [] })),
      ]).then(([svcs, techs]) => {
        if (!live) return;
        setOpts({
          services: applyOverrides(svcs.map((s) => ({
            id: s.serviceId,
            name: s.name,
            durationMinutes: s.durationMinutes,
            priceCents: s.priceCents,
            category: 'Services',
          }))),
          technicians: (techs.technicians || []).map((t) => ({
            id: t.technicianId,
            fullName: t.displayName,
          })),
        });
      }).catch((e: any) => {
        if (live) setError(e?.message || 'Could not load services for this salon.');
      }).finally(() => {
        if (live) setOptsLoading(false);
      });
    } else {
      customerApi.bookingOptions((selectedSalon as SalonResult)?.salon_id || defaultSalon?.id)
        .then((r) => {
          if (live && r) {
            setOpts({
              ...r,
              services: applyOverrides(r.services || [])
            });
          }
        })
        .catch((e: any) => {
          if (live) setError(e?.message || 'Could not load booking options.');
        })
        .finally(() => {
          if (live) setOptsLoading(false);
        });
    }

    return () => {
      live = false;
    };
  });
  useEffect(() => loadOptions(), [selectedSalon, loadOptions]);

  // Book This Look from the showcase: pre-pick its service only when THIS salon offers it (never a foreign id)
  const preServiceId = qp.get('serviceId');
  useEffect(() => {
    if (!preServiceId || !opts?.services?.length) return;
    setPicked((p) => (p.length === 0 && opts.services.some((x) => x.id === preServiceId) ? [preServiceId] : p));
  }, [preServiceId, opts]);

  // 3. Fetch real availability slots when date/service/tech changes (does NOT reset chosen slot on step change)
  const firstPicked = picked[0];   // the first chosen service drives availability
  const loadSlots = useEventCallback(() => {
    if (!picked.length || !date) return;
    let live = true;
    setSlotsLoading(true);
    setSlots(null);

    // Developer merge (Oct 6 2026): the chosen salon's technicians and calendar — not the default salon's.
    const salonId = (selectedSalon as SalonResult)?.salon_id || defaultSalon?.id;
    customerApi.bookingServiceTechnicians(picked[0], salonId)
      .then((d) => {
        if (live) setTechCards(Object.fromEntries(d.technicians.map((t) => [t.technicianId, t])));
      })
      .catch(() => setTechCards({}));

    customerApi.availability(picked[0], date, chosenTech || undefined, salonId)
      .then((r) => {
        if (live) setSlots(r.slots);
      })
      .catch((e: any) => {
        if (live) {
          setSlots([]);
          setError(e?.message || 'Could not load available times.');
        }
      })
      .finally(() => {
        if (live) setSlotsLoading(false);
      });

    return () => {
      live = false;
    };
  });
  useEffect(() => loadSlots(), [firstPicked, date, chosenTech, selectedSalon, defaultSalon, loadSlots]);

  // Helper to determine if a time slot has already passed on today's date
  const isPastTime = (slotTimeHHMM: string, targetDateYMD: string): boolean => {
    if (targetDateYMD !== ymd(today)) return false;
    const now = new Date();
    const [h, m] = slotTimeHHMM.split(':').map(Number);
    const slotMin = h * 60 + m;
    const currentMin = now.getHours() * 60 + now.getMinutes();
    return slotMin <= currentMin;
  };

  const services = useMemo(() => opts?.services || [], [opts?.services]);   // §39: one array per options load (a fresh [] each render re-ran the memos below)
  const cats = useMemo(
    () => Array.from(new Set(services.map((s) => s.category).filter(Boolean))) as string[],
    [services]
  );
  const visibleCats = showAllCats ? cats : cats.slice(0, 4);
  const hasMore = cats.length > 4;

  const shownServices = useMemo(() => {
    return services.filter(
      (s) =>
        s.name.toLowerCase().includes(serviceQuery.trim().toLowerCase()) &&
        (cat === 'All' || s.category === cat)
    );
  }, [services, serviceQuery, cat]);

  const pickedServices = useMemo(() => {
    return picked.map((id) => services.find((s) => s.id === id)).filter(Boolean) as typeof services;
  }, [picked, services]);

  const totalCents = pickedServices.reduce((n, s) => n + s.priceCents, 0);
  const totalMin = pickedServices.reduce((n, s) => n + s.durationMinutes, 0);

  const toggleService = (id: string) => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  // Filter nearby salons for salon search step
  const filteredSalons = useMemo(() => {
    const q = salonQuery.trim().toLowerCase();
    if (!q) return nearbySalons;
    return nearbySalons.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.city && s.city.toLowerCase().includes(q)) ||
        (s.address && s.address.toLowerCase().includes(q)) ||
        (s.zip && s.zip.includes(q))
    );
  }, [nearbySalons, salonQuery]);

  // Submission handler
  const submit = async (bookingSessionId?: string) => {
    setError(null);
    if (!picked.length) {
      setStep('service');
      return;
    }
    if (!slot || !slot.technicianIds[0]) {
      setError('Please choose an available time.');
      return;
    }
    setSubmitting(true);
    try {
      const technicianId = chosenTech && slot.technicianIds.includes(chosenTech) ? chosenTech : (slot.technicianIds.find((t) => isFavorite(t)) ?? slot.technicianIds[0]);
      const inspirationNote = look
        ? `Wants this look: ${look.caption ? `"${look.caption}"` : look.source === 'showcase' ? 'a Nail Showcase look' : 'a saved portfolio look'}${look.techName ? ` (from ${look.techName}'s ${look.source === 'showcase' ? 'Nail Showcase post' : 'portfolio'})` : look.source === 'showcase' ? ' (from Nail Showcase)' : ''}`
        : undefined;

      const body = {
        salonId: (selectedSalon as SalonResult)?.salon_id || defaultSalon?.id,
        serviceId: picked[0],
        serviceIds: picked,
        technicianId,
        date,
        startTime: slot.startTime,
        ...(look ? { inspirationNote, ...(look.photoId && look.source !== 'showcase' ? { inspirationPhotoId: look.photoId } : {}) } : {}),
        ...(deal ? { dealId: deal.id } : {}),
        ...(bookingSessionId ? { bookingSessionId } : {}),
      };
      // BUILD_PLAN Phase 13 (Constitution 6 §14–15, §20): booking is ONLINE-ONLY — availability must be confirmed by the
      // server at the moment of booking, so nothing is queued offline. One Idempotency-Key per attempt: the same details
      // retried after a lost answer reuse it (the server returns the first booking); an answer retires it.
      if (!networkState.isOnline()) { setError('You’re offline. Booking needs a live connection to confirm the time — try again when you’re back online.'); return; }
      let r;
      try { r = await customerApi.createBooking(body, { idempotencyKey: bookingKeys.current.keyFor('book', body) }); }
      catch (e: any) { if (Number(e?.status) >= 100) bookingKeys.current.done('book'); throw e; }
      bookingKeys.current.done('book');
      setDone(r);
    } catch (e: any) {
      if (e?.status === 428 || e?.code === 'phone_verification_required') {
        const d = (e.details || {}) as any;
        const held = { bookingSessionId: d.bookingSessionId, maskedPhone: d.maskedPhone, holdExpiresAt: d.holdExpiresAt ?? null };
        try {
          const sent = await customerApi.sendBookingVerification({ bookingSessionId: d.bookingSessionId });
          setVerify({ ...held, bookingSessionId: sent.bookingSessionId || d.bookingSessionId, maskedPhone: sent.maskedPhone || d.maskedPhone });
        } catch (se: any) {
          // A human check first (the send was challenged): the code screen shows it, then sends.
          if ((se?.details as any)?.status === 'captcha_required' || se?.code === 'captcha_required') { setVerify({ ...held, captcha: true }); return; }
          setError(se?.message || 'We could not send a verification code. Please call the salon.');
        }
        return;
      }
      if (e?.status === 503 || e?.code === 'phone_verification_unavailable') {
        setError(e?.message || 'Online booking is temporarily unavailable. Please call the salon to book.');
        return;
      }
      setError(e?.message || 'This time is no longer available. Please select another.');
    } finally {
      setSubmitting(false);
    }
  };

  const BackButton = ({ onClick }: { onClick: () => void }) => (
    <button
      onClick={onClick}
      aria-label="Back"
      className="customer-back"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );

  // Verification Screen Overlay
  if (verify) {
    return (
      <PhoneVerificationStep
        bookingSessionId={verify.bookingSessionId}
        maskedPhone={verify.maskedPhone}
        holdExpiresAt={verify.holdExpiresAt}
        needsCaptcha={!!verify.captcha}
        onVerified={() => {
          const sid = verify.bookingSessionId;
          setVerify(null);
          void submit(sid);
        }}
        onChangePhone={() => nav('/profile/edit')}
        onCancel={() => {
          setVerify(null);
          setError(null);
        }}
      />
    );
  }

  // Done Screen
  if (done) {
    return (
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h1 className="cust-h1">You’re booked! 🎉</h1>
        <div className="cust-card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>{done.serviceName}</div>
          <div className="cust-sub" style={{ marginTop: 6 }}>
            with {done.technicianName}
          </div>
          <div className="cust-sub">
            {done.date} · {fmt12(done.startTime)}–{fmt12(done.endTime)}
          </div>
          {selectedSalon ? (
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--customer-primary)', fontWeight: 600 }}>
              📍 {selectedSalon.name} {selectedSalon.address ? `· ${selectedSalon.address}` : ''}
            </div>
          ) : null}
          <span className="cust-pill cust-pill-green" style={{ marginTop: 10 }}>
            {done.status}
          </span>
        </div>
        {done.deposit ? <BookingDepositCard appointmentId={done.appointmentId} initial={done.deposit} /> : null}
        <button className="cust-btn" onClick={() => nav('/appointments')}>
          View my appointments
        </button>
        <button
          className="cust-btn cust-btn-ghost"
          onClick={() => {
            setDone(null);
            setPicked([]);
            setStep('date');
          }}
        >
          Book another
        </button>
      </div>
    );
  }

  // Booking Summary Card Component (Rendered on top of steps)
  const BookingSummaryHeader = () => {
    const salonDisplayName = selectedSalon?.name || defaultSalon?.name || 'AIPowerSalon Partner';
    const salonAddressText = selectedSalon?.address || defaultSalon?.address || 'Full address confirmed upon booking';
    const hasService = pickedServices.length > 0;

    return (
      <div
        className="cust-card"
        style={{
          padding: '14px 16px',
          marginBottom: 6,
          background: 'linear-gradient(135deg, rgba(201, 151, 27, 0.08) 0%, rgba(169, 111, 34, 0.03) 100%)',
          border: '1px solid var(--customer-border)',
          borderRadius: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 16 }} aria-hidden>📍</span>
              <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--customer-text)' }}>
                {salonDisplayName}
              </span>
            </div>
            <div
              className="cust-sub"
              style={{
                fontSize: 12,
                marginTop: 2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                paddingLeft: 22,
              }}
            >
              {salonAddressText}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setStep('salon')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--customer-primary)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: '2px 4px',
            }}
          >
            Change
          </button>
        </div>

        {(hasService || date || slot) && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              paddingTop: 8,
              borderTop: '1px solid rgba(169, 111, 34, 0.12)',
              fontSize: 12.5,
            }}
          >
            {hasService ? (
              <span style={{ fontWeight: 700, color: 'var(--customer-primary-dark)' }}>
                💅 {pickedServices.map((s) => s.name).join(', ')} ({money2(totalCents)} · {totalMin}m)
              </span>
            ) : null}
            {date ? (
              <span style={{ color: 'var(--customer-text-secondary)', fontWeight: 600 }}>
                📅 {new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            ) : null}
            {slot ? (
              <span style={{ color: 'var(--customer-text-secondary)', fontWeight: 600 }}>
                ⏰ {fmt12(slot.startTime)}
              </span>
            ) : null}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: '18px 18px 140px 18px', display: 'flex', flexDirection: 'column', gap: 12, minHeight: '100%' }}>
      {/* Top Bar with Dynamic Step Title & Back Navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {step === 'date' ? (
          <BackButton onClick={() => nav(-1)} />
        ) : step === 'salon' ? (
          <BackButton onClick={() => setStep('date')} />
        ) : step === 'service' ? (
          <BackButton onClick={() => setStep(selectedSalon ? 'date' : 'salon')} />
        ) : step === 'technician_time' ? (
          <BackButton onClick={() => setStep('service')} />
        ) : (
          <BackButton onClick={() => setStep('technician_time')} />
        )}
        <h1 className="cust-h1" style={{ fontSize: 21 }}>
          {step === 'date'
            ? 'Select Date'
            : step === 'salon'
            ? 'Select Salon'
            : step === 'service'
            ? 'Select Services'
            : step === 'technician_time'
            ? 'Choose Time & Tech'
            : 'Booking Summary'}
        </h1>
      </div>

      {/* Look / Portfolio Tag if booking from inspiration */}
      {look ? (
        <div className="cust-card" style={{ padding: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
          {look.imageUrl ? <img src={look.imageUrl} alt="Selected look" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8 }} /> : null}
          <div style={{ fontSize: 12.5 }}>
            <div style={{ fontWeight: 800 }}>Booking this look</div>
            <div className="cust-sub" style={{ fontSize: 11.5 }}>
              {look.caption || (look.source === 'showcase' ? 'From Nail Showcase' : 'Saved from portfolio')}{look.techName ? ` · ${look.techName}` : ''}
            </div>
          </div>
        </div>
      ) : null}

      {/* ─────────────────────────────────────────────────────────────
          STEP 1: SELECT DATE (Calendar / Date Selector First)
          ───────────────────────────────────────────────────────────── */}
      {step === 'date' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Top Salon Indicator */}
          {selectedSalon || defaultSalon ? (
            <div
              className="cust-card"
              style={{
                padding: '12px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#FFFFFF',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }} aria-hidden>📍</span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 14 }}>
                    {selectedSalon?.name || defaultSalon?.name}
                  </div>
                  <div className="cust-sub" style={{ fontSize: 11.5 }}>
                    {selectedSalon?.address || defaultSalon?.address || 'Default Salon'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setStep('salon')}
                style={{
                  background: 'var(--customer-primary-light)',
                  color: 'var(--customer-primary)',
                  border: 'none',
                  borderRadius: 8,
                  padding: '6px 12px',
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Change Salon
              </button>
            </div>
          ) : null}

          {/* Quick Date Chips */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setDate(ymd(today))}
              style={{
                flex: 1,
                padding: '10px 12px',
                borderRadius: 12,
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                border: date === ymd(today) ? '1.5px solid var(--customer-primary)' : '1px solid var(--customer-border)',
                background: date === ymd(today) ? 'var(--customer-primary-light)' : '#fff',
                color: date === ymd(today) ? 'var(--customer-primary-dark)' : 'var(--customer-text)',
              }}
            >
              Today ({new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})
            </button>
            <button
              type="button"
              onClick={() => setDate(ymd(new Date(today.getTime() + 86400000)))}
              style={{
                flex: 1,
                padding: '10px 12px',
                borderRadius: 12,
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                border: date === ymd(new Date(today.getTime() + 86400000)) ? '1.5px solid var(--customer-primary)' : '1px solid var(--customer-border)',
                background: date === ymd(new Date(today.getTime() + 86400000)) ? 'var(--customer-primary-light)' : '#fff',
                color: date === ymd(new Date(today.getTime() + 86400000)) ? 'var(--customer-primary-dark)' : 'var(--customer-text)',
              }}
            >
              Tomorrow
            </button>
          </div>

          {/* 30-Day Horizontal Calendar Slider */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="cust-label" style={{ fontSize: 13, color: 'var(--customer-text-secondary)' }}>
              Or pick an upcoming day:
            </span>
            <div
              style={{
                display: 'flex',
                gap: 8,
                overflowX: 'auto',
                paddingBottom: 6,
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              {days.map((d) => {
                const v = ymd(d);
                const sel = v === date;
                const isDayToday = v === ymd(today);
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setDate(v)}
                    aria-pressed={sel}
                    aria-label={d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                    style={{
                      flex: '0 0 auto',
                      minWidth: 58,
                      borderRadius: 16,
                      border: sel ? '1.5px solid var(--customer-primary)' : '1px solid var(--customer-border)',
                      background: sel ? 'linear-gradient(135deg, #C9971B 0%, #A96F22 100%)' : '#FFFFFF',
                      color: sel ? '#FFFFFF' : 'var(--customer-text)',
                      boxShadow: sel ? '0 4px 12px rgba(169, 111, 34, 0.25)' : '0 1px 3px rgba(0,0,0,0.02)',
                      padding: '12px 8px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 4,
                      cursor: 'pointer',
                      transition: 'all 0.18s ease',
                    }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', opacity: sel ? 0.95 : 0.65 }}>
                      {isDayToday ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short' })}
                    </span>
                    <span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.1 }}>
                      {d.getDate()}
                    </span>
                    <span style={{ fontSize: 10.5, fontWeight: 600, opacity: sel ? 0.9 : 0.5 }}>
                      {d.toLocaleDateString('en-US', { month: 'short' })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected Date Card */}
          <div
            className="cust-card"
            style={{
              padding: '14px 16px',
              background: 'linear-gradient(135deg, rgba(201, 151, 27, 0.08) 0%, rgba(169, 111, 34, 0.03) 100%)',
              border: '1px solid var(--customer-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>
                {new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </div>
              <div className="cust-sub" style={{ fontSize: 12 }}>
                {date === ymd(today) ? 'Viewing available times for today' : 'Advance appointment scheduling'}
              </div>
            </div>
            <span style={{ fontSize: 22 }} aria-hidden>🗓️</span>
          </div>

          {/* Next Action Button */}
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: 'calc(65px + env(safe-area-inset-bottom,0px))', zIndex: 10, maxWidth: 560, margin: '0 auto', padding: '12px 18px', background: 'linear-gradient(transparent, var(--customer-background) 30%)' }}>
            <button
              className="cust-btn"
              onClick={() => {
                // If customer has salon & service already picked -> go to tech & time
                if ((selectedSalon || defaultSalon) && picked.length > 0) {
                  setStep('technician_time');
                } else if (selectedSalon || defaultSalon) {
                  setStep('service');
                } else {
                  setStep('salon');
                }
              }}
            >
              Continue to Services →
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          STEP 2: SELECT SALON (Default vs Search / Multi-Salon)
          ───────────────────────────────────────────────────────────── */}
      {step === 'salon' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            value={salonQuery}
            onChange={(e) => setSalonQuery(e.target.value)}
            placeholder="Search salon name, city, or zip code..."
            aria-label="Search salons"
            style={{
              width: '100%',
              height: 48,
              borderRadius: 12,
              border: '1px solid var(--customer-border)',
              padding: '0 14px',
              font: 'inherit',
              background: '#fff',
              fontSize: 14,
            }}
          />

          {defaultSalon ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="cust-label" style={{ fontSize: 12, color: 'var(--customer-text-secondary)' }}>
                YOUR DEFAULT SALON
              </div>
              <div
                className="cust-card"
                style={{
                  padding: 14,
                  border: selectedSalon?.name === defaultSalon.name ? '1.5px solid var(--customer-primary)' : '1px solid var(--customer-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{defaultSalon.name}</div>
                  <div className="cust-sub" style={{ fontSize: 12 }}>{defaultSalon.address || 'Partner Salon'}</div>
                  {defaultSalon.phone ? <div className="cust-sub" style={{ fontSize: 11.5 }}>📞 {defaultSalon.phone}</div> : null}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSalon(defaultSalon);
                    setStep(picked.length > 0 ? 'technician_time' : 'service');
                  }}
                  style={{
                    background: 'var(--customer-primary)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 10,
                    padding: '8px 14px',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  Select
                </button>
              </div>
            </div>
          ) : null}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            <div className="cust-label" style={{ fontSize: 12, color: 'var(--customer-text-secondary)' }}>
              NEARBY SALONS ({filteredSalons.length})
            </div>

            {salonsLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[1, 2, 3].map((i) => (
                  <div key={i} className="cust-skel" style={{ height: 100, borderRadius: 14 }} />
                ))}
              </div>
            ) : filteredSalons.length === 0 ? (
              <div className="cust-card" style={{ padding: 18, textAlign: 'center' }}>
                <div className="cust-sub">No salons found matching “{salonQuery}”.</div>
              </div>
            ) : (
              filteredSalons.map((s) => {
                const isCurrent = (selectedSalon as SalonResult)?.salon_id === s.salon_id;
                return (
                  <div
                    key={s.salon_id}
                    className="cust-card"
                    style={{
                      padding: 14,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      border: isCurrent ? '1.5px solid var(--customer-primary)' : '1px solid var(--customer-border)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontWeight: 800, fontSize: 15 }}>{s.name}</span>
                          {s.is_aipowersalon_partner && (
                            <span className="cust-pill cust-pill-purple" style={{ padding: '2px 7px', fontSize: 10 }}>
                              Partner
                            </span>
                          )}
                        </div>
                        <div className="cust-sub" style={{ fontSize: 12.5, marginTop: 2 }}>
                          {s.address ? `${s.address}, ${s.city || ''} ${s.state || ''}` : 'Address available on booking'}
                        </div>
                      </div>
                      {s.rating != null ? (
                        <div style={{ fontWeight: 800, fontSize: 13, color: '#A96F22' }}>
                          ★ {s.rating.toFixed(1)} {s.review_count ? `(${s.review_count})` : ''}
                        </div>
                      ) : null}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                      <div style={{ display: 'flex', gap: 10, fontSize: 12, color: 'var(--customer-text-secondary)' }}>
                        {s.distance_miles != null ? (
                          <span>🚗 {s.distance_miles.toFixed(1)} mi away</span>
                        ) : null}
                        {s.open_now != null ? (
                          <span style={{ color: s.open_now ? '#0E8A63' : '#F04444', fontWeight: 600 }}>
                            {s.open_now ? 'Open now' : 'Closed'}
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSalon(s);
                          setStep(picked.length > 0 ? 'technician_time' : 'service');
                        }}
                        style={{
                          background: 'var(--customer-primary)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 10,
                          padding: '7px 16px',
                          fontWeight: 700,
                          fontSize: 13,
                          cursor: 'pointer',
                        }}
                      >
                        Book Here
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          STEP 3: SELECT SERVICE (with Category filter pills & Search)
          ───────────────────────────────────────────────────────────── */}
      {step === 'service' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <BookingSummaryHeader />

          <input
            value={serviceQuery}
            onChange={(e) => setServiceQuery(e.target.value)}
            placeholder="Search services (e.g. Manicure, Gel, Pedicure)..."
            aria-label="Search services"
            style={{
              width: '100%',
              height: 48,
              borderRadius: 12,
              border: '1px solid var(--customer-border)',
              padding: '0 14px',
              font: 'inherit',
              background: '#fff',
              fontSize: 14,
            }}
          />

          {/* Category filter pills */}
          {cats.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {['All', ...visibleCats].map((c) => {
                const on = cat === c;
                return (
                  <button
                    key={c}
                    onClick={() => setCat(c)}
                    aria-pressed={on}
                    style={{
                      height: 34,
                      padding: '0 14px',
                      borderRadius: 999,
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: 13,
                      border: on ? '0' : '1px solid var(--customer-border)',
                      background: on ? 'var(--customer-primary)' : '#fff',
                      color: on ? '#fff' : 'var(--customer-text)',
                    }}
                  >
                    {c}
                  </button>
                );
              })}
              {hasMore && (
                <button
                  onClick={() => setShowAllCats((v) => !v)}
                  aria-label={showAllCats ? 'Show fewer categories' : 'Show more categories'}
                  style={{
                    height: 34,
                    padding: '0 14px',
                    borderRadius: 999,
                    cursor: 'pointer',
                    fontWeight: 700,
                    fontSize: 13,
                    border: '1px solid var(--customer-border)',
                    background: '#fff',
                    color: 'var(--customer-primary)',
                  }}
                >
                  {showAllCats ? 'Less' : 'More'}
                </button>
              )}
            </div>
          )}

          {optsLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="cust-skel" style={{ height: 72, borderRadius: 14 }} />
              ))}
            </div>
          ) : shownServices.length === 0 ? (
            <div className="cust-card" style={{ padding: 20, textAlign: 'center' }}>
              <div className="cust-sub">No services match “{serviceQuery}”.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {shownServices.map((s) => {
                const on = picked.includes(s.id);
                return (
                  <div
                    key={s.id}
                    className="cust-card"
                    style={{
                      padding: 14,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      border: on ? '1.5px solid var(--customer-primary)' : '1px solid var(--customer-border)',
                    }}
                  >
                    <span
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 12,
                        background: 'var(--customer-purple-100)',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 22,
                        flex: '0 0 auto',
                      }}
                      aria-hidden
                    >
                      💅
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 14.5 }}>{s.name}</div>
                      <div className="cust-sub" style={{ fontSize: 13, marginTop: 2 }}>
                        {money2(s.priceCents)} · {s.durationMinutes} min
                      </div>
                    </div>
                    <button
                      onClick={() => toggleService(s.id)}
                      aria-pressed={on}
                      aria-label={`${on ? 'Remove' : 'Select'} ${s.name}`}
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 999,
                        border: on ? '0' : '1.5px solid var(--customer-primary)',
                        cursor: 'pointer',
                        fontSize: 18,
                        fontWeight: 800,
                        background: on ? 'var(--customer-primary)' : '#fff',
                        color: on ? '#fff' : 'var(--customer-primary)',
                      }}
                    >
                      {on ? '✓' : '+'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Sticky Bottom Continue Bar */}
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: 'calc(65px + env(safe-area-inset-bottom,0px))', zIndex: 10, maxWidth: 560, margin: '0 auto', padding: '12px 18px', background: 'linear-gradient(transparent, var(--customer-background) 30%)' }}>
            <button
              className="cust-btn"
              disabled={picked.length === 0}
              onClick={() => setStep('technician_time')}
            >
              {picked.length === 0 ? 'Select a Service to Continue' : `Choose Time & Tech (${picked.length}) · ${money2(totalCents)}`}
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          STEP 4: CHOOSE TECHNICIAN & TIME SLOTS
          ───────────────────────────────────────────────────────────── */}
      {step === 'technician_time' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <BookingSummaryHeader />

          {/* Technician Selection */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="cust-label" style={{ fontSize: 14 }}>Select Technician</span>
            <div
              style={{
                display: 'flex',
                gap: 8,
                overflowX: 'auto',
                paddingBottom: 4,
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              <button
                type="button"
                onClick={() => setChosenTech(null)}
                aria-pressed={chosenTech === null}
                style={{
                  flex: '0 0 auto',
                  minWidth: 120,
                  borderRadius: 14,
                  border: chosenTech === null ? '1.5px solid var(--customer-primary)' : '1px solid var(--customer-border)',
                  background: chosenTech === null ? 'var(--customer-primary-light)' : '#fff',
                  color: chosenTech === null ? 'var(--customer-primary-dark)' : 'var(--customer-text)',
                  padding: '10px 12px',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 800, fontSize: 13 }}>⭐ Any Available</div>
                <div className="cust-sub" style={{ fontSize: 11 }}>Fastest booking</div>
              </button>

              {[...(opts?.technicians || [])].sort((a, b) => Number(isFavorite(b.id)) - Number(isFavorite(a.id))).map((t) => {
                const sel = chosenTech === t.id;
                const card = techCards[t.id];
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setChosenTech(t.id)}
                    aria-pressed={sel}
                    style={{
                      flex: '0 0 auto',
                      minWidth: 140,
                      borderRadius: 14,
                      border: sel ? '1.5px solid var(--customer-primary)' : '1px solid var(--customer-border)',
                      background: sel ? 'var(--customer-primary-light)' : '#fff',
                      color: sel ? 'var(--customer-primary-dark)' : 'var(--customer-text)',
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                    }}
                  >
                    {card?.avatarUrl ? (
                      <img
                        src={card.avatarUrl}
                        alt=""
                        style={{ width: 34, height: 34, borderRadius: 99, objectFit: 'cover', border: '1.5px solid #C9962E' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 99,
                          background: '#F0E2C0',
                          display: 'grid',
                          placeItems: 'center',
                          fontWeight: 800,
                          fontSize: 13,
                        }}
                      >
                        {t.fullName.charAt(0)}
                      </div>
                    )}
                    <div style={{ textAlign: 'left', minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {t.fullName}{isFavorite(t.id) ? <span aria-label="Your favorite" title="Your favorite" style={{ marginLeft: 4, color: '#C2185B' }}>♥</span> : null}
                      </div>
                      {/* Sep 2026 merge: the redesign showed a bare average (even with 0 reviews) and dropped the P5 'View profile'
                          link; restored — a rating only with its review count, and the public profile when one exists */}
                      {card?.averageRating != null && (card.reviewCount ?? 0) > 0 ? (
                        <div style={{ fontSize: 11, color: '#A96F22', fontWeight: 600 }}>
                          ★ {card.averageRating.toFixed(1)} ({card.reviewCount})
                          {card.publicSlug ? (
                            <span role="link" tabIndex={0} style={{ marginLeft: 8, textDecoration: 'underline' }}
                              onClick={(e) => { e.stopPropagation(); nav(`/techs/${card.publicSlug}`); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); nav(`/techs/${card.publicSlug}`); } }}>View profile</span>
                          ) : null}
                        </div>
                      ) : (
                        <div className="cust-sub" style={{ fontSize: 11 }}>Technician</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Time Slots Grid */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="cust-label" style={{ fontSize: 14 }}>Available Times for {new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>

            {slotsLoading ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <div key={i} className="cust-skel" style={{ height: 46, borderRadius: 12 }} />
                ))}
              </div>
            ) : (() => {
              const visibleSlots = (slots || []).filter((s) => !isPastTime(s.startTime, date));
              const availableCount = visibleSlots.filter((s) => s.available).length;

              if (visibleSlots.length === 0 || availableCount === 0) {
                const isTodayDate = date === ymd(today);
                const tomorrowDate = ymd(new Date(today.getTime() + 86400000));
                return (
                  <div className="cust-card" style={{ padding: '24px 18px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(169, 111, 34, 0.1)', display: 'grid', placeItems: 'center', fontSize: 22 }}>
                      ⏰
                    </div>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>
                      {isTodayDate ? 'No Remaining Times Today' : 'No Times Available'}
                    </div>
                    <div className="cust-sub" style={{ fontSize: 12.5, maxWidth: 320, lineHeight: 1.4 }}>
                      {isTodayDate
                        ? 'All booking times for today are booked or passed. Check tomorrow or pick another date.'
                        : 'No slots open on this date with the selected technician. Please pick another date or choose Any Technician.'}
                    </div>
                    {isTodayDate ? (
                      <button
                        type="button"
                        className="cust-btn cust-btn-ghost"
                        style={{ width: 'auto', padding: '0 18px', height: 38, fontSize: 13, marginTop: 4 }}
                        onClick={() => setDate(tomorrowDate)}
                      >
                        Check Tomorrow →
                      </button>
                    ) : null}
                  </div>
                );
              }

              const morning = visibleSlots.filter((s) => parseInt(s.startTime.split(':')[0], 10) < 12);
              const afternoon = visibleSlots.filter((s) => {
                const h = parseInt(s.startTime.split(':')[0], 10);
                return h >= 12 && h < 17;
              });
              const evening = visibleSlots.filter((s) => parseInt(s.startTime.split(':')[0], 10) >= 17);

              const renderSlotSection = (title: string, icon: string, sectionSlots: AvailabilitySlot[]) => {
                if (sectionSlots.length === 0) return null;
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--customer-text-secondary)' }}>
                      <span>{icon}</span>
                      <span>{title}</span>
                      <span style={{ fontSize: 11, opacity: 0.7 }}>({sectionSlots.filter((s) => s.available).length} open)</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                      {sectionSlots.map((s) => {
                        const sel = slot?.startTime === s.startTime;
                        return (
                          <button
                            key={s.startTime}
                            disabled={!s.available}
                            aria-pressed={sel}
                            onClick={() => setSlot(s)}
                            style={{
                              height: 48,
                              borderRadius: 12,
                              cursor: s.available ? 'pointer' : 'not-allowed',
                              padding: '0 8px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 4,
                              fontWeight: 700,
                              fontSize: 13,
                              border: sel ? '1.5px solid var(--customer-primary)' : '1px solid var(--customer-border)',
                              background: sel ? 'linear-gradient(135deg, #C9971B 0%, #A96F22 100%)' : s.available ? '#FFFFFF' : '#F7F3EB',
                              color: sel ? '#FFFFFF' : s.available ? 'var(--customer-text)' : 'var(--customer-text-secondary)',
                              opacity: s.available ? 1 : 0.45,
                              boxShadow: sel ? '0 4px 10px rgba(169, 111, 34, 0.25)' : '0 1px 2px rgba(0,0,0,0.02)',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <span>{fmt12(s.startTime)}</span>
                            {sel ? <span style={{ fontSize: 12, marginLeft: 2 }} aria-hidden>✓</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              };

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {renderSlotSection('Morning', '🌅', morning)}
                  {renderSlotSection('Afternoon', '☀️', afternoon)}
                  {renderSlotSection('Evening', '🌙', evening)}
                </div>
              );
            })()}
          </div>

          {/* Sticky Bottom Continue Bar */}
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: 'calc(65px + env(safe-area-inset-bottom,0px))', zIndex: 10, maxWidth: 560, margin: '0 auto', padding: '12px 18px', background: 'linear-gradient(transparent, var(--customer-background) 30%)' }}>
            <button
              className="cust-btn"
              disabled={!slot}
              onClick={() => {
                setError(null);
                setStep('review');
              }}
            >
              Review Booking Summary →
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          STEP 5: REVIEW & CONFIRM BOOKING (Detailed Booking Summary)
          ───────────────────────────────────────────────────────────── */}
      {step === 'review' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Main Booking Summary Card */}
          <div
            className="cust-card"
            style={{
              padding: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              background: '#FFFFFF',
              border: '1.5px solid var(--customer-primary)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--customer-border)', paddingBottom: 10 }}>
              <div>
                <span className="cust-pill cust-pill-purple" style={{ padding: '2px 8px', fontSize: 11 }}>
                  Booking Summary
                </span>
                <div style={{ fontWeight: 800, fontSize: 17, marginTop: 4 }}>
                  {selectedSalon?.name || defaultSalon?.name || 'AIPowerSalon'}
                </div>
                <div className="cust-sub" style={{ fontSize: 12.5 }}>
                  📍 {selectedSalon?.address || defaultSalon?.address || 'Partner Location'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setStep('salon')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--customer-primary)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Edit Salon
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div className="cust-sub" style={{ fontSize: 11 }}>SERVICE</div>
                <div style={{ fontWeight: 800, fontSize: 14 }}>
                  {pickedServices.map((s) => s.name).join(', ')}
                </div>
              </div>
              <div>
                <div className="cust-sub" style={{ fontSize: 11 }}>TOTAL PRICE</div>
                <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--customer-primary-dark)' }}>
                  {money2(totalCents)} ({totalMin} min)
                </div>
              </div>
              <div>
                <div className="cust-sub" style={{ fontSize: 11 }}>DATE & TIME</div>
                <div style={{ fontWeight: 800, fontSize: 14 }}>
                  {new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  {slot ? ` · ${fmt12(slot.startTime)}` : ''}
                </div>
              </div>
              <div>
                <div className="cust-sub" style={{ fontSize: 11 }}>TECHNICIAN</div>
                <div style={{ fontWeight: 800, fontSize: 14 }}>
                  {chosenTech
                    ? opts?.technicians.find((x) => x.id === chosenTech)?.fullName || 'Selected Tech'
                    : 'Any Available Tech'}
                </div>
              </div>
            </div>
          </div>

          {/* Cancellation & Policy Notice */}
          <div className="cust-card" style={{ padding: 14, background: 'var(--customer-purple-100)', border: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Cancellation &amp; Arrival Policy</div>
            <div className="cust-sub" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>
              Free cancellation up to 2 hours before appointment. Please arrive 5 minutes early for check-in.
            </div>
          </div>

          {error ? (
            <div className="cust-card" style={{ padding: 12, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>
              {error}
            </div>
          ) : null}

          {/* Confirm Button */}
          <button
            className="cust-btn"
            disabled={submitting || !slot}
            onClick={() => void submit()}
            style={{ height: 54, fontSize: 16, marginTop: 4 }}
          >
            {submitting ? 'Confirming Appointment…' : 'Confirm & Book Now'}
          </button>
        </div>
      )}
    </div>
  );
}
