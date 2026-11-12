import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiSearch, FiPlus, FiMinus, FiAlertCircle } from 'react-icons/fi';
import { ServiceCard, AddonCard, BookingSummary, type ServiceCatalogItem, type AddonItem, type PriceOverride } from '../components/BookingSharedComponents';
import { QuickServiceCategoryPicker } from '../components/QuickServiceCategoryPicker';
import { posServicesApi } from '../api/posServicesApi';
import { posBookingApi } from '../api/posBookingApi';
import { TechnicianPicker } from '../components/TechnicianPicker';
import { useCan } from '../components/usePermissions';
import { posCheckInApi } from '../api/posCheckInApi';
import { posCustomersApi } from '../api/posCustomersApi';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
// 23-inch spec §20 (Unit 7): ONE add-on rule for the POS walk-in, booking and the guest's own check-in ("Add-ons", any spelling)
import { isAddOnCategory } from '@aipowersalon/api-contracts';
import { msg, renderMsg, type Msg } from '../i18n/notice';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
/** the "All Services" category chip — a sentinel value, labelled at render (never a translated string kept as a value) */
const ALL_CATEGORIES = '__all__';
/** the catalogue-load failure, as a key (translated at render) */
const CATALOG_ERROR = 'ops.booking.catalogLoadFailed';

export function POSWalkInScreen() {
  const navigate = useNavigate();
  
  // State
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<ServiceCatalogItem[]>([]);   // the salon's real catalog only — never the demo list (its ids are refused by the server)
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const can = useCan();
  const canOverridePrice = can('checkout.manage_overrides');   // the server's rule (pos.checkout.override_total)
  // ALL_CATEGORIES is a sentinel (labelled "All Services" at render); the rest are the salon's own category names. Before the
  // catalog loads only "All" shows (it listed five made-up categories).
  const [categories, setCategories] = useState<string[]>([ALL_CATEGORIES]);
  // 200-technician §2: the picked technician's name (from the server-paged picker) — the screen never loads the roster
  const [selectedTechName, setSelectedTechName] = useState<string | undefined>(undefined);
  
  const [partySize, setPartySize] = useState(1);
  const [selectedServices, setSelectedServices] = useState<ServiceCatalogItem[]>([]);
  const [selectedAddons, setSelectedAddons] = useState<{addon: AddonItem, parentServiceId: string}[]>([]);
  const [priceOverrides, setPriceOverrides] = useState<Record<string, PriceOverride>>({});
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORIES);
  const [visitNotes, setVisitNotes] = useState('');
  const [sendSms, setSendSms] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<Msg>('');   // a key, translated at render (a language switch re-labels it)
  
  const [isChoosingTech, setIsChoosingTech] = useState(false);
  // The estimate the server quotes (GET /pos/check-in/wait-estimate) — it was a fixed "15 min / Now" whatever the line.
  // null = not known (estimates off, or the read failed): shown as "—", never a made-up number.
  const [waitMin, setWaitMin] = useState<number | null>(null);
  const [selectedTechId, setSelectedTechId] = useState('');

  // Customer State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [guestMode, setGuestMode] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [creatingCustomerError, setCreatingCustomerError] = useState<Msg>('');
  const searchContainerRef = useRef<HTMLDivElement>(null);

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
        setCategories([ALL_CATEGORIES, ...Array.from(new Set<string>(active))]);
      }).catch(() => { /* Booking still works with the tenant-scoped booking-state categories. */ });
      setLoading(false);
    }).catch((e: any) => {
      if (!alive) return;
      console.error(e);
      setCatalogError(CATALOG_ERROR);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

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

  const waitKey = selectedServices.map((sv) => sv.serviceId).join(',') + '|' + (isChoosingTech ? selectedTechId : '');
  useEffect(() => {
    let live = true;
    posCheckInApi.waitEstimate(selectedServices.map((sv) => sv.serviceId), isChoosingTech && selectedTechId ? selectedTechId : undefined)
      .then((r: any) => { if (live) setWaitMin(r?.configured && Number.isFinite(Number(r.quotedWaitMinutes)) ? Math.max(0, Math.round(Number(r.quotedWaitMinutes))) : null); })
      .catch(() => { if (live) setWaitMin(null); });
    return () => { live = false; };
  }, [waitKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const totalMinutes = selectedServices.reduce((acc, s) => acc + s.durationMinutes, 0) + 
                       selectedAddons.reduce((acc, a) => acc + a.addon.durationMinutes, 0);
  const totalCents = selectedServices.reduce((acc, s) => {
    const ov = priceOverrides[s.serviceId];
    return acc + (ov ? ov.priceCents : s.priceCents);
  }, 0) + selectedAddons.reduce((acc, a) => acc + a.addon.priceCents, 0);

  const handleWalkIn = async () => {
    setErrorMsg('');
    if (!selectedCustomer && !guestMode) {
      setErrorMsg(msg('ops.booking.selectCustomerOrGuest'));
      return;
    }
    if (guestMode && !guestName.trim()) {
      setErrorMsg(msg('pos.guest_name_is_required'));
      return;
    }
    if (selectedServices.length === 0) {
      setErrorMsg(msg('ops.booking.selectService'));
      return;
    }
    
    setIsSubmitting(true);
    try {
      const idempotencyKey = globalThis.crypto?.randomUUID?.() || `wi-${Date.now()}`;
      
      const payload: any = {
        serviceIds: [
          ...selectedServices.map(s => s.serviceId),
          ...selectedAddons.map(a => a.addon.serviceId)
        ],
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
        source: 'walk_in',
        notes: visitNotes || undefined,
        technicianId: isChoosingTech && selectedTechId ? selectedTechId : undefined,
        idempotencyKey
      };

      if (guestMode) {
        payload.customerName = guestName.trim() || 'Guest';
      } else if (selectedCustomer) {
        payload.customerId = selectedCustomer.customerId;
        payload.customerName = (selectedCustomer.fullName || selectedCustomer.name) || 'Unknown';
        payload.customerPhone = selectedCustomer.phone;
      }
      
      await posCheckInApi.walkIn(payload);
      navigate('/booking');
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message || msg('pos.failed_to_add_walk_in_please_17yp'));
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

    if (selectedCustomer) {
      const fullName = selectedCustomer.fullName || selectedCustomer.name || tx('pos.customer');
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexGrow: 1, marginLeft: 12 }}>
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
      {/* Header */}
      <div className="vh flex flex-col md:flex-row gap-3 justify-between">
        <div>
          <button onClick={() => navigate('/booking')} style={{ background: 'none', border: 'none', color: 'var(--aps-orange)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, padding: 0, marginBottom: 8 }}>
            <FiArrowLeft /> {tx('pos.back_to_booking')}
          </button>
          <h1 style={{ margin: 0, fontSize: 24, color: '#1f1b16' }}>{tx('pos.add_walk_in_2')}{' '}<span style={{ fontSize: 14, fontWeight: 400, color: 'var(--muted)', marginLeft: 8 }}>{tx('pos.choose_a_customer_tap_services_and_jsy7')}</span></h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div className='whitespace-nowrap' style={{ background: '#FFF', border: '1px solid var(--line)', padding: '6px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, color: '#E8742B', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#E8742B' }} />
            {tx('pos.walk_in_2')}
          </div>
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
            <div className='whitespace-nowrap' style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
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

              {/* Technician Selection */}
              <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--aps-orange)', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12 }}>3</div>
                  <h3 style={{ margin: 0, fontSize: 16 }}>{tx('pos.technician')}</h3>
                </div>
                
                <div style={{ display: 'flex', background: '#F9F8F5', border: '1px solid var(--line)', borderRadius: 8, padding: 4, marginBottom: 12 }}>
                  <button 
                    onClick={() => { setIsChoosingTech(false); setSelectedTechId(''); }}
                    style={{ flex: 1, padding: 8, borderRadius: 6, background: !isChoosingTech ? '#FFF' : 'transparent', border: !isChoosingTech ? '1px solid var(--aps-orange)' : 'none', color: !isChoosingTech ? 'var(--aps-orange)' : 'var(--muted)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
                  >{tx('pos.first_available')}</button>
                  <button 
                    onClick={() => setIsChoosingTech(true)}
                    style={{ flex: 1, padding: 8, borderRadius: 6, background: isChoosingTech ? '#FFF' : 'transparent', border: isChoosingTech ? '1px solid var(--aps-orange)' : 'none', color: isChoosingTech ? 'var(--aps-orange)' : 'var(--muted)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
                  >{tx('pos.choose_technician_2')}</button>
                </div>

                {isChoosingTech && (
                  <div style={{ marginBottom: 16 }}>
                    {/* 200-technician mandate: searchable, server-paged, only technicians approved for the chosen services */}
                    <TechnicianPicker value={selectedTechId} onChange={(id, t) => { setSelectedTechId(id); setSelectedTechName(t?.name); }}
                      serviceIds={selectedServices.map((sv) => sv.serviceId)}
                      selectedName={selectedTechId ? selectedTechName : undefined} />
                  </div>
                )}

                {/* Estimates */}
                <div style={{ background: '#E8F5E9', borderRadius: 8, padding: 12, display: 'flex', justifyContent: 'space-between', textAlign: 'center', marginTop: 16 }}>
                <div><div style={{ fontSize: 11, color: '#2E7D32', fontWeight: 600 }}>{tx('pos.est_wait')}</div><div style={{ fontSize: 15, fontWeight: 800, marginTop: 4 }}>{waitMin == null ? '—' : tx('pos.n_min', { n: String(waitMin) })}</div></div>
                <div><div style={{ fontSize: 11, color: '#2E7D32', fontWeight: 600 }}>{tx('pos.est_start')}</div><div style={{ fontSize: 15, fontWeight: 800, marginTop: 4 }}>{waitMin == null ? '—' : waitMin === 0 ? tx('pos.now') : tx('pos.in_n_min', { n: String(waitMin) })}</div></div>
                <div><div style={{ fontSize: 11, color: '#2E7D32', fontWeight: 600 }}>{tx('pos.est_finish_2')}</div><div style={{ fontSize: 15, fontWeight: 800, marginTop: 4 }}>~{totalMinutes}m</div></div>
              </div>

              <div style={{ marginTop: 16 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>{tx('pos.visit_notes')}</label>
                <textarea 
                  value={visitNotes}
                  onChange={e => setVisitNotes(e.target.value)}
                  placeholder={tx('pos.preferences_or_special_requests')} 
                  style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: 10, marginTop: 4, minHeight: 60, boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 13 }}
                />
              </div>

              <div style={{ marginTop: 12 }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={sendSms} onChange={e => setSendSms(e.target.checked)} style={{ marginTop: 2 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{tx('pos.send_queue_updates_by_sms')}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{tx('pos.customer_permission_confirmed')}</div>
                  </div>
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

      {/* Fixed Bottom Bar */}
      <div className="w-full bg-white border-t border-[var(--line)] px-4 py-3 md:px-6 md:py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between mt-4">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#E3D8F5', color: '#7E57C2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
            {customerDisplayName.substring(0, 2).toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{customerDisplayName} <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 13 }}>&middot; {selectedServices.length} {tx('pos.services_6')}{' '}{selectedAddons.length} {tx('pos.add_on_3')}{' '}{totalMinutes} {tx('pos.min')}</span></div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>${((totalCents || 0) / 100).toFixed(2)}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => navigate('/booking')} className="btn outline" style={{ height: 44, padding: '0 24px' }} disabled={isSubmitting}>{tx('pos.cancel')}</button>
          <button onClick={handleWalkIn} className="btn" style={{ height: 44, padding: '0 24px', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }} disabled={isSubmitting}>{tx('pos.add_to_customer_queue')}</button>
        </div>
      </div>
    </div>
  );
}
