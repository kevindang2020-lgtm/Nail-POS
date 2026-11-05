// POSCustomerProfileScreen.tsx — Customers → Profiles. Search a customer, then view a consolidated
// profile (contact, lifetime stats, loyalty, membership, gift cards, recent visits) from a single
// /pos/customers/:id call (pos.customers.view). Read-only.
import { useRealtime } from '../realtime/useRealtime';
import { displayLocale } from '../i18n/format';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CustomerReminderHistory } from './POSRemindersScreen';
import { useCan } from '../components/usePermissions';
import { LoyaltyBonusRequest } from '../components/LoyaltyBonusRequest';
import { posCustomersApi } from '../api/posCustomersApi';
import type { CustomerPhoneStatus } from '@aipowersalon/api-contracts';
import { POSCustomerPhoneEditor } from './POSCustomerPhoneEditor';
import { money, reportError } from './reportsCommon';
import { t as i18nText } from '@aipowersalon/mobile-sdk/i18n';
import { customerLanguageName } from '../components/customerLanguage';
import { codeLabel } from '../components/peopleLabels';
import { CustomerInvoicesPanel } from '../components/CustomerInvoicesPanel';

type CustomerItem = { customerId: string; fullName: string; phone: string; visitsCount: number; avatarUrl?: string };
type Visit = { visitId: string; date: string; serviceName: string; technicianName: string; totalCents: number; tipCents: number };
type Detail = {
  displayName: string; firstName: string; lastName?: string; phone?: string; email?: string; status: string; isVip: boolean; avatarUrl?: string; isPhoneVerified?: boolean; birthday?: string;
  visitCount: number; lastVisitAt?: string | null; nextAppointmentAt?: string | null; totalSpendCents: number; averageSpendCents: number; loyaltyPoints: number; loyaltyTier?: string;
  tags?: string[];
  smsOptIn?: boolean; emailOptIn?: boolean; marketingOptIn?: boolean;
  preferredName?: string | null; preferredLanguage?: string | null; preferredBranchId?: string | null;   // Decision 1
  notes?: { salonNotes?: string; allergyNotes?: string; preferredStyle?: string; preferredTechnician?: string; servicePreferences?: string; warnings?: string; preferredLanguage?: string; preferredBranch?: string; preferredName?: string; preferredNailShapeColor?: string; favoriteProducts?: string; appointmentPreferences?: string; };
  loyalty: { points: number; earned: number; redeemed: number; tier: string; availableRewards?: any[]; redemptions?: any[] };
  membership: { plan: string; status: string; renewalDate?: string; benefits: string[] };
  giftCards: { giftCardId: string; maskedCode: string; balanceCents: number; status: string }[];
  recentVisits: Visit[];
};

const fmtDate = (iso?: string | null) => { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString(displayLocale(), { month: 'short', day: '2-digit', year: 'numeric' }); } catch { return iso; } };

const SearchIcon = () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>;
const UserIcon = () => <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>;

import { resolveAvatarUrl } from '@aipowersalon/ui';

const Avatar = ({ url, name, size, fontSize, fallbackIcon: Fallback = UserIcon }: { url?: string; name?: string; size: number; fontSize: number; fallbackIcon?: React.ElementType }) => {
  const [error, setError] = useState(false);
  const resolvedUrl = url ? resolveAvatarUrl(url) : null;
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'linear-gradient(135deg, #EADBB6 0%, #C49A54 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFF', fontSize, fontFamily: '"Playfair Display", serif', fontWeight: 700, boxShadow: '0 8px 24px rgba(181,130,31,0.25)', border: '4px solid #FFF', flexShrink: 0, overflow: 'hidden' }}>
      {resolvedUrl && !error ? (
        <img src={resolvedUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setError(true)} />
      ) : (
        name ? name.charAt(0).toUpperCase() : <Fallback />
      )}
    </div>
  );
};

export function POSCustomerProfileScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  // Phase 3: the phone's real proof (verified by SMS / not verified / manually confirmed) from the canonical status, and
  // the change flow right here on the profile — not only from the Customers list row.
  const [phoneStatus, setPhoneStatus] = useState<CustomerPhoneStatus | null>(null);
  const [editingPhone, setEditingPhone] = useState(false);
  useEffect(() => {
    setPhoneStatus(null); setEditingPhone(false);
    if (!selectedId) return;
    posCustomersApi.phoneStatus(selectedId).then(setPhoneStatus).catch(() => setPhoneStatus(null));
  }, [selectedId, detail?.phone]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [ledger, setLedger] = useState<any[] | null>(null);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const can = useCan();
  const timer = useRef<any>(null);

  const runSearch = useCallback(async (q: string) => {
    setSearching(true); setError(null);
    try { const r = await posCustomersApi.quickSearch(q); setResults((r?.items || []) as CustomerItem[]); }
    catch (e: any) { setError(reportError(e, 'customers')); }
    finally { setSearching(false); }
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (selectedId) return;
    timer.current = setTimeout(() => runSearch(query), 250);
    return () => timer.current && clearTimeout(timer.current);
  }, [query, selectedId, runSearch]);

  const pick = async (c: CustomerItem) => {
    setSelectedId(c.customerId); setResults([]); setQuery(c.fullName); setLoading(true); setError(null); setDetail(null); setHistoryPage(1); setLedger(null);
    try { 
      setDetail((await posCustomersApi.getDetail(c.customerId)) as Detail); 
      setLedger((await posCustomersApi.getLoyaltyLedger(c.customerId)) as any[]);
    }
    catch (e: any) { setError(reportError(e, 'this profile')); }
    finally { setLoading(false); }
  };
  // Invoices mandate (Oct 29 2026) §14: an invoice opens its linked profile here (?customerId=…) — the existing profile, not
  // a copy. The server checks the id belongs to this salon (GET /pos/customers/:id is tenant-scoped).
  const [params] = useSearchParams();
  const linkedId = params.get('customerId');
  useEffect(() => {
    if (linkedId && /^[0-9a-f-]{36}$/i.test(linkedId) && linkedId !== selectedId) void pick({ customerId: linkedId, fullName: '', phone: '', visitsCount: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedId]);
  useEffect(() => { if (detail && linkedId === selectedId && !query) setQuery(detail.displayName ?? ''); }, [detail, linkedId, selectedId, query]);
  const reset = () => { setSelectedId(null); setDetail(null); setQuery(''); setResults([]); setError(null); runSearch(''); setLedger(null); setShowAdjustModal(false); };

  const historyLimit = 10; // Trigger HMR to ensure pagination applies
  const historyTotalPages = detail?.recentVisits?.length ? Math.ceil(detail.recentVisits.length / historyLimit) : 1;
  const historyStart = (historyPage - 1) * historyLimit;
  const pagedHistory = detail?.recentVisits?.slice(historyStart, historyStart + historyLimit) || [];
  // Constitution 9: a payment, a profile edit or a loyalty award for the customer whose profile is OPEN refreshes it
  // in place — the POS used to show whatever was fetched when the profile was first opened.
  useRealtime('customers', () => {
    if (!selectedId) return;
    posCustomersApi.getDetail(selectedId).then((d) => setDetail(d as Detail)).catch(() => { /* a refresh failure leaves the current view */ });
  });
  // Decision 1: profile fields first; a value typed into the old notes form (before migration 490) still shows.
  const prefName = detail?.preferredName || detail?.notes?.preferredName || '';
  const prefLang = detail?.preferredLanguage || detail?.notes?.preferredLanguage || '';

  return (
    <div className="work" style={{ width: '100%', maxWidth: 1600, margin: '0 auto', background: 'transparent' }}>
      {/* Header */}
      <div className="mb-6 flex flex-col xl:flex-row gap-3 justify-between ">

        <div >
          <h1 style={{ fontFamily: '"Playfair Display", serif', fontSize: 24, color: '#2C2A29', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: '##DCAB39', fontSize: 24 }}>★</span> {i18nText('pos.customer_profiles')}{' '}<span style={{ color: '#DCAB39', fontSize: 24 }}>★</span>
          </h1>
          <div style={{ color: '#8A7A6D', fontSize: 16 }}>{i18nText('pos.look_up_a_customer_s_full_1ilo')}</div>
        </div>
        {/* Search Bar */}
        <div className="flex ">
          <div className="relative w-full max-w-[500px]">

            <div className="absolute left-3 top-6 z-10 -translate-y-1/2 text-[#B5821F]">
              <SearchIcon />
            </div>

            <input
              type="search"
              value={query}
              onChange={(e) => {
                setSelectedId(null);
                setQuery(e.target.value);
              }}
              placeholder={i18nText('pos.search_by_name_phone_or_email_2')}
              className="w-full rounded-[20px] border border-[#EADBB6] bg-white px-10 py-[10px] pr-12 text-[16px] text-[#2C2A29] shadow-[0_8px_32px_rgba(181,130,31,0.08)] outline-none transition-all duration-200 focus:shadow-[0_12px_40px_rgba(181,130,31,0.15)]"
            />

            {selectedId || query ? (
              <button
                onClick={reset}
                className="absolute right-3 top-6 -translate-y-1/2 cursor-pointer rounded-[20px] border border-[#EFEAE1] bg-[#F8F6F3] px-2 py-1 text-[13px] font-semibold text-[#8A7A6D] transition-colors duration-200 hover:bg-[#F1ECE4]"
              >
                {i18nText('pos.clear')}
              </button>
            ) : null}

          </div>
        </div>      </div>

      {error ? <div className="err" style={{ marginBottom: 24, textAlign: 'center', background: '#FDF0EE', color: '#C0392B', padding: 16, borderRadius: 12, border: '1px solid #FADEDC' }}>{error}</div> : null}

      {/* Default State / Search Results Grid */}
      {!selectedId && results.length > 0 ? (
        <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
          <h2 style={{ fontFamily: '"Playfair Display", serif', fontSize: 18, color: '#2C2A29', marginBottom: 20, borderBottom: '1px solid #EADBB6', paddingBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            {!query.trim() ? i18nText('pos.recently_active_customers') : i18nText('pos.search_results')}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
            {results.map((c) => (
              <button key={c.customerId} onClick={() => pick(c)} style={{
                display: 'flex', alignItems: 'center', gap: 16, width: '100%', padding: '20px',
                background: '#FFFFFF', border: '1px solid #EFEAE1', borderRadius: 20,
                boxShadow: '0 4px 16px rgba(0,0,0,0.03)', cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s'
              }}
                onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 12px 24px rgba(181,130,31,0.08)'; e.currentTarget.style.borderColor = '#EADBB6'; }}
                onMouseOut={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.03)'; e.currentTarget.style.borderColor = '#EFEAE1'; }}
              >
                <Avatar url={c.avatarUrl} name={c.fullName} size={52} fontSize={24} />
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontWeight: 700, color: '#2C2A29', fontSize: 17, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.fullName || i18nText('pos.unnamed_customer')}</div>
                  <div style={{ color: '#8A7A6D', fontSize: 14 }}>{c.phone || i18nText('pos.no_phone_on_file')} <span style={{ margin: '0 6px', color: '#D2C4B3' }}>|</span> <span style={{ fontWeight: 600, color: '#B5821F' }}>{c.visitsCount ?? 0} {i18nText('pos.visits')}</span></div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {!selectedId && !searching && query.trim() && results.length === 0 && !error ? (
        <div style={{ textAlign: 'center', padding: '80px 20px', background: '#FFFFFF', borderRadius: 24, border: '1px dashed #D2C4B3', boxShadow: '0 4px 16px rgba(0,0,0,0.02)' }}>
          <div style={{ color: '#D4AF37', marginBottom: 16, opacity: 0.6, transform: 'scale(1.5)' }}><SearchIcon /></div>
          <div style={{ fontFamily: '"Playfair Display", serif', fontSize: 24, fontWeight: 600, color: '#2C2A29', marginBottom: 8 }}>{i18nText('pos.no_profiles_found')}</div>
          <div style={{ color: '#8A7A6D', fontSize: 16 }}>{i18nText('pos.we_couldn_t_find_anyone_matching')}{query}{i18nText('pos.try_searching_with_a_different_name_ec2s')}</div>
        </div>
      ) : null}

      {/* Selected Profile Detail */}
      {selectedId && loading ? (
        <div style={{ textAlign: 'center', padding: 80, color: '#8A7A6D', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid #EADBB6', borderTopColor: '#C49A54', animation: 'spin 1s linear infinite' }}></div>
          {i18nText('pos.loading_customer_data')}
        </div>
      ) : null}

      {selectedId && detail ? (
        <div style={{ animation: 'fadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)' }}>
          {/* Profile Hero Card */}
          <div style={{ background: '#FFFFFF', padding: '40px 48px', borderRadius: 24, boxShadow: '0 16px 40px rgba(181,130,31,0.05)', border: '1px solid #F1ECE4', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 32 }}>
            <Avatar url={detail.avatarUrl} name={detail.displayName} size={96} fontSize={40} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10 }}>
                <h1 style={{ fontFamily: '"Playfair Display", serif', fontSize: 36, color: '#2C2A29', margin: 0, letterSpacing: '-0.5px' }}>{detail.displayName}</h1>
                {detail.isVip ? <span style={{ padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 700, background: 'linear-gradient(135deg, #FBF3E6 0%, #F5E5C6 100%)', color: '#9E7118', border: '1px solid #EADBB6', boxShadow: '0 2px 8px rgba(181,130,31,0.1)' }}>{i18nText('pos.vip_member')}</span> : null}
                {detail.loyaltyTier ? <span style={{ padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 700, background: '#F1F5FA', color: '#2D6CBF', border: '1px solid #D6E4F4' }}>{detail.loyaltyTier.toUpperCase()}</span> : null}
              </div>
              <div style={{ color: '#8A7A6D', fontSize: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span>{detail.phone || i18nText('pos.no_phone')}</span>
                {phoneStatus?.phone ? (
                  <span data-testid="phone-proof" style={{ color: phoneStatus.phone.verified ? '#2E9E54' : '#9A6A12', marginLeft: -8, fontSize: 14, fontWeight: 700 }}>
                    {phoneStatus.phone.verified ? i18nText('pos.verified') : phoneStatus.phone.label}
                  </span>
                ) : detail.isPhoneVerified ? <span style={{ color: '#2E9E54', marginLeft: -8, fontSize: 14, fontWeight: 700 }}>{i18nText('pos.verified')}</span> : null}
                {phoneStatus?.openChange ? <span style={{ fontSize: 13, color: '#9A6A12' }}>{i18nText('pos.change_to')}{' '}{phoneStatus.openChange.maskedPhone} {i18nText('pos.pending_2')}</span> : null}
                {phoneStatus?.sync === 'retrying' ? <span style={{ fontSize: 13, color: '#9A6A12' }}>{i18nText('pos.records_updating')}</span> : null}
                <button onClick={() => setEditingPhone((v) => !v)} style={{ background: 'none', border: 0, color: '#A96F22', fontWeight: 600, fontSize: 13, cursor: 'pointer' }} data-testid="change-phone">{i18nText('pos.change_phone_number')}</button>
                {detail.email ? <><span style={{ color: '#D2C4B3' }}>|</span><span>{detail.email}</span></> : null}
                {detail.birthday ? <><span style={{ color: '#D2C4B3' }}>|</span><span>🎂 {fmtDate(detail.birthday)}</span></> : null}
                <span style={{ color: '#D2C4B3' }}>|</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: detail.status === 'active' ? '#2E9E54' : '#8A7A6D', fontWeight: 600 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: detail.status === 'active' ? '#2E9E54' : '#D2C4B3' }}></span>
                  {detail.status.charAt(0).toUpperCase() + detail.status.slice(1)}
                </span>
              </div>
            </div>
          </div>
          
          {editingPhone && selectedId ? (
            <div style={{ marginBottom: 24 }}>
              <POSCustomerPhoneEditor customerId={selectedId} customerName={detail.displayName} currentMasked={detail.phone ?? null}
                onDone={() => { setEditingPhone(false); posCustomersApi.getDetail(selectedId).then((d) => setDetail(d as Detail)).catch(() => undefined); }}
                onCancel={() => setEditingPhone(false)} />
            </div>
          ) : null}

          {/* Tags & Preferences Card */}
          {(detail.tags?.length || detail.notes?.preferredStyle || detail.notes?.salonNotes || detail.notes?.warnings || detail.notes?.allergyNotes) ? (
            <div style={{ background: '#FFFFFF', padding: '24px 32px', borderRadius: 24, boxShadow: '0 8px 24px rgba(0,0,0,0.02)', border: '1px solid #F1ECE4', marginBottom: 24 }}>
              <div style={{ fontFamily: '"Playfair Display", serif', fontSize: 20, color: '#2C2A29', marginBottom: 16 }}>{i18nText('pos.profile_tags_notes')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {detail.tags?.length ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {detail.tags.map(t => <span key={t} style={{ background: '#F8F6F3', padding: '6px 14px', borderRadius: 20, fontSize: 13, border: '1px solid #EADBB6', color: '#5A514A', fontWeight: 600 }}>{t}</span>)}
                  </div>
                ) : null}
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                  {detail.notes?.salonNotes && <div><div style={{ fontSize: 12, color: '#8A7A6D', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{i18nText('pos.salon_notes')}</div><div style={{ fontSize: 15, color: '#2C2A29' }}>{detail.notes.salonNotes}</div></div>}
                  {prefName && <div><div style={{ fontSize: 12, color: '#8A7A6D', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{i18nText('pos.preferred_name_2')}</div><div style={{ fontSize: 15, color: '#2C2A29' }}>{prefName}</div></div>}
                  {detail.notes?.preferredStyle && <div><div style={{ fontSize: 12, color: '#8A7A6D', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{i18nText('pos.preferred_style')}</div><div style={{ fontSize: 15, color: '#2C2A29' }}>{detail.notes.preferredStyle}</div></div>}
                  {detail.notes?.preferredNailShapeColor && <div><div style={{ fontSize: 12, color: '#8A7A6D', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{i18nText('pos.nail_shape_color')}</div><div style={{ fontSize: 15, color: '#2C2A29' }}>{detail.notes.preferredNailShapeColor}</div></div>}
                  {detail.notes?.favoriteProducts && <div><div style={{ fontSize: 12, color: '#8A7A6D', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{i18nText('pos.favorite_products')}</div><div style={{ fontSize: 15, color: '#2C2A29' }}>{detail.notes.favoriteProducts}</div></div>}
                  {detail.notes?.appointmentPreferences && <div><div style={{ fontSize: 12, color: '#8A7A6D', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{i18nText('pos.appointment_prefs')}</div><div style={{ fontSize: 15, color: '#2C2A29' }}>{detail.notes.appointmentPreferences}</div></div>}
                  {prefLang && <div><div style={{ fontSize: 12, color: '#8A7A6D', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{i18nText('pos.preferred_language')}</div><div style={{ fontSize: 15, color: '#2C2A29' }}>{customerLanguageName(prefLang)}</div></div>}
                  {detail.notes?.preferredBranch && <div><div style={{ fontSize: 12, color: '#8A7A6D', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{i18nText('pos.preferred_branch')}</div><div style={{ fontSize: 15, color: '#2C2A29' }}>{detail.notes.preferredBranch}</div></div>}
                  {detail.notes?.allergyNotes && <div><div style={{ fontSize: 12, color: '#C0392B', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{i18nText('pos.allergies')}</div><div style={{ fontSize: 15, color: '#C0392B', fontWeight: 600 }}>{detail.notes.allergyNotes}</div></div>}
                  {detail.notes?.warnings && <div><div style={{ fontSize: 12, color: '#E67E22', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{i18nText('pos.warnings')}</div><div style={{ fontSize: 15, color: '#E67E22', fontWeight: 600 }}>{detail.notes.warnings}</div></div>}
                </div>
                
                <div style={{ borderTop: '1px solid #EFEAE1', paddingTop: 16, marginTop: 8 }}>
                  <div style={{ fontSize: 12, color: '#8A7A6D', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>{i18nText('pos.communication_consent')}</div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    {[['SMS', detail.smsOptIn], [i18nText('pos.email'), detail.emailOptIn], [i18nText('pos.marketing'), detail.marketingOptIn]].map(([l, on]) => (
                      <span key={l as string} style={{ background: on ? '#EEF7EF' : '#F8F6F3', color: on ? '#2E7D32' : '#8A7A6D', padding: '4px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, border: '1px solid', borderColor: on ? '#A5D6A7' : '#EFEAE1' }}>{l as string}: {on ? i18nText('pos.on') : i18nText('pos.off')}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* KPI Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 20, marginBottom: 24 }}>
            {[
              { l: i18nText('pos.lifetime_spend'), v: money(detail.totalSpendCents), c: '#B5821F', bg: '#FDFBF7' },
              { l: i18nText('pos.total_visits_2'), v: detail.visitCount, c: '#2C2A29', bg: '#FFFFFF' },
              { l: i18nText('pos.average_ticket'), v: money(detail.averageSpendCents), c: '#2C2A29', bg: '#FFFFFF' },
              { l: i18nText('pos.loyalty_points'), v: detail.loyalty?.points ?? detail.loyaltyPoints ?? 0, c: '#2D6CBF', bg: '#F8FAFD' },
              { l: i18nText('pos.last_visit_3'), v: fmtDate(detail.lastVisitAt), c: '#5A514A', bg: '#FFFFFF', s: 18 }
            ].map((k, i) => (
              <div key={i} style={{ background: k.bg, padding: '24px 20px', borderRadius: 20, border: '1px solid #F1ECE4', boxShadow: '0 4px 16px rgba(0,0,0,0.02)', textAlign: 'center' }}>
                <div style={{ color: '#8A7A6D', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>{k.l}</div>
                <div style={{ color: k.c, fontSize: k.s || 28, fontWeight: 700, fontFamily: k.s ? 'inherit' : '"Playfair Display", serif' }}>{k.v}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 24, marginBottom: 24 }}>
            {/* Loyalty & Rewards */}
            <section style={{ background: '#FFFFFF', padding: 32, borderRadius: 24, border: '1px solid #F1ECE4', boxShadow: '0 8px 24px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div style={{ fontFamily: '"Playfair Display", serif', fontSize: 24, color: '#2C2A29' }}>{i18nText('pos.loyalty_rewards')}</div>
                <button onClick={() => setShowAdjustModal(true)} style={{ background: '#F1F5FA', border: 'none', padding: '8px 16px', borderRadius: 8, color: '#2D6CBF', fontWeight: 600, fontSize: 13, cursor: 'pointer' }} data-testid="lb-open">{i18nText('lb.title')}</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 24 }}>
                <div style={{ background: '#F8FAFD', padding: '16px 12px', borderRadius: 16, border: '1px solid #D6E4F4', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#5A81B8', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{i18nText('pos.available')}</div>
                  <div style={{ fontSize: 20, color: '#2D6CBF', fontWeight: 700, fontFamily: '"Playfair Display", serif' }}>{detail.loyalty?.points || 0}</div>
                </div>
                <div style={{ background: '#FDFBF7', padding: '16px 12px', borderRadius: 16, border: '1px solid #EADBB6', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#A58B54', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{i18nText('pos.lifetime_earned')}</div>
                  <div style={{ fontSize: 20, color: '#B5821F', fontWeight: 700, fontFamily: '"Playfair Display", serif' }}>{detail.loyalty?.earned || 0}</div>
                </div>
                <div style={{ background: '#FAFAF9', padding: '16px 12px', borderRadius: 16, border: '1px solid #EFEAE1', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#8A7A6D', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{i18nText('pos.redeemed')}</div>
                  <div style={{ fontSize: 20, color: '#5A514A', fontWeight: 700, fontFamily: '"Playfair Display", serif' }}>{detail.loyalty?.redeemed || 0}</div>
                </div>
              </div>
              
              {detail.loyalty?.availableRewards && detail.loyalty.availableRewards.length > 0 ? (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 14, color: '#2C2A29', fontWeight: 700, marginBottom: 12 }}>{i18nText('pos.available_rewards')}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {detail.loyalty.availableRewards.map((r: any) => (
                      <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F0F9FF', padding: '12px 16px', borderRadius: 12, border: '1px solid #BAE6FD' }}>
                        <div>
                          <div style={{ color: '#0284C7', fontWeight: 700, fontSize: 14 }}>{r.title}</div>
                          <div style={{ color: '#0369A1', fontSize: 13 }}>{r.description}</div>
                        </div>
                        <span style={{ background: '#0284C7', color: '#FFF', padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>{r.pointsCost} {i18nText('pos.pts')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ color: '#A09388', padding: '10px 0', fontSize: 14, marginBottom: 24 }}>{i18nText('pos.not_enough_points_for_any_rewards_1ytt')}</div>
              )}

              {ledger && ledger.length > 0 && (
                <div>
                  <div style={{ fontSize: 14, color: '#2C2A29', fontWeight: 700, marginBottom: 12 }}>{i18nText('pos.points_history')}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
                    {ledger.map((l: any) => (
                      <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#FDFBF7', padding: '12px 16px', borderRadius: 12, border: '1px solid #EFEAE1' }}>
                        <div>
                          <div style={{ color: '#2C2A29', fontWeight: 600, fontSize: 13 }}>{l.description || codeLabel(`people.ledger.${l.type}`, l.type)}</div>
                          <div style={{ color: '#8A7A6D', fontSize: 12 }}>{fmtDate(l.createdAt)}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ color: l.amount > 0 ? '#2E9E54' : l.amount < 0 ? '#D33' : '#8A7A6D', fontWeight: 700, fontSize: 14 }}>{l.amount > 0 ? '+' : ''}{l.amount} {i18nText('pos.pts')}</span>
                          <div style={{ color: '#8A7A6D', fontSize: 11 }}>{i18nText('pos.bal')}{' '}{l.runningBalance}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* Membership Details */}
            <section style={{ background: '#FFFFFF', padding: 32, borderRadius: 24, border: '1px solid #F1ECE4', boxShadow: '0 8px 24px rgba(0,0,0,0.02)' }}>
              <div style={{ fontFamily: '"Playfair Display", serif', fontSize: 24, color: '#2C2A29', marginBottom: 20 }}>{i18nText('pos.membership_plan')}</div>
              {detail.membership && detail.membership.status !== 'none' ? (
                <div style={{ background: 'linear-gradient(180deg, #FDFBF7 0%, #FFFFFF 100%)', padding: 24, borderRadius: 16, border: '1px solid #EADBB6', boxShadow: '0 4px 12px rgba(181,130,31,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 20, color: '#2C2A29' }}>{detail.membership.plan}</div>
                      <div style={{ color: '#8A7A6D', fontSize: 15, marginTop: 6 }}>
                        <span style={{ color: '#2E9E54', fontWeight: 600 }}>{detail.membership.status.toUpperCase()}</span> {i18nText('pos.renews')}{' '}{fmtDate(detail.membership.renewalDate)}
                      </div>
                    </div>
                    <div style={{ color: '#C49A54', fontSize: 24 }}>★</div>
                  </div>
                  {detail.membership.benefits?.length ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
                      {detail.membership.benefits.map((b, idx) => (
                        <span key={idx} style={{ background: '#F8F6F3', padding: '6px 12px', borderRadius: 8, fontSize: 13, border: '1px solid #E6DCD1', color: '#5A514A', fontWeight: 500 }}>{b}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : <div style={{ color: '#A09388', padding: '20px 0', fontSize: 15 }}>{i18nText('pos.no_active_membership_plan_on_record')}</div>}
            </section>

            {/* Gift Cards */}
            <section style={{ background: '#FFFFFF', padding: 32, borderRadius: 24, border: '1px solid #F1ECE4', boxShadow: '0 8px 24px rgba(0,0,0,0.02)' }}>
              <div style={{ fontFamily: '"Playfair Display", serif', fontSize: 24, color: '#2C2A29', marginBottom: 20 }}>{i18nText('pos.gift_cards_balances')}</div>
              {detail.giftCards?.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {detail.giftCards.map((g: any) => (
                    <div key={g.giftCardId} style={{ display: 'flex', flexDirection: 'column', gap: 16, background: '#F8F6F3', padding: '20px 24px', borderRadius: 16, border: '1px dashed #D2C4B3' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 18, color: '#5A514A', letterSpacing: '1.5px', background: '#FFF', padding: '4px 10px', borderRadius: 6, border: '1px solid #EFEAE1' }}>{g.maskedCode}</span>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                          <span style={{ fontSize: 12, color: '#8A7A6D', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>{i18nText('pos.balance')}</span>
                          <b style={{ fontSize: 20, color: '#2C2A29', fontFamily: '"Playfair Display", serif' }}>{money(g.balanceCents)}</b>
                        </div>
                      </div>
                      
                      {g.ledger && g.ledger.length > 0 && (
                        <div style={{ borderTop: '1px solid #EFEAE1', paddingTop: 16 }}>
                          <div style={{ fontSize: 12, color: '#8A7A6D', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>{i18nText('pos.transaction_history')}</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {g.ledger.map((tx: any) => (
                              <div key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, background: '#FFF', padding: '8px 12px', borderRadius: 8, border: '1px solid #EFEAE1' }}>
                                <div style={{ display: 'flex', gap: 16 }}>
                                  <span style={{ color: '#8A7A6D', width: 90 }}>{fmtDate(tx.createdAt)}</span>
                                  <span style={{ fontWeight: 600, color: '#2C2A29', textTransform: 'capitalize' }}>{codeLabel(`people.ledger.${tx.type}`, tx.type)}</span>
                                </div>
                                <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                                  <span style={{ color: tx.amountCents > 0 ? '#2E9E54' : '#C0392B', fontWeight: 600, minWidth: 60, textAlign: 'right' }}>{tx.amountCents > 0 ? '+' : ''}{money(tx.amountCents)}</span>
                                  <span style={{ color: '#8A7A6D', fontSize: 12, minWidth: 80, textAlign: 'right' }}>{i18nText('pos.bal')}{' '}{money(tx.balanceAfterCents)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : <div style={{ color: '#A09388', padding: '20px 0', fontSize: 15 }}>{i18nText('pos.no_active_gift_cards_associated_with_h0mk')}</div>}
            </section>
          </div>

          {/* Invoices guide (Nov 4 2026) §14: this customer's invoices and balance */}
          {selectedId ? <CustomerInvoicesPanel customerId={selectedId} customerName={detail.displayName} /> : null}

          {/* Recent Service History */}
          <section style={{ background: '#FFFFFF', borderRadius: 24, border: '1px solid #F1ECE4', boxShadow: '0 8px 24px rgba(0,0,0,0.02)', overflow: 'hidden' }}>
            <div style={{ fontFamily: '"Playfair Display", serif', fontSize: 24, color: '#2C2A29', padding: '32px 32px 24px', borderBottom: '1px solid #EFEAE1', background: '#FAFAF9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{i18nText('pos.recent_service_history')}</span>
              {detail.recentVisits?.length > historyLimit && (
                <span style={{ fontSize: 14, color: '#8A7A6D', fontFamily: 'system-ui, sans-serif' }}>
                  {detail.recentVisits.length} {i18nText('pos.total_visits')}
                </span>
              )}
            </div>
            {pagedHistory.length ? (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#FFFFFF', color: '#A09388', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '2px solid #F1ECE4' }}>
                      <th style={{ padding: '20px 32px', textAlign: 'left', fontWeight: 600 }}>{i18nText('pos.date')}</th>
                      <th style={{ padding: '20px 32px', textAlign: 'left', fontWeight: 600 }}>{i18nText('pos.service_provided')}</th>
                      <th style={{ padding: '20px 32px', textAlign: 'left', fontWeight: 600 }}>{i18nText('pos.technician')}</th>
                      <th style={{ padding: '20px 32px', textAlign: 'right', fontWeight: 600 }}>{i18nText('pos.total_paid')}</th>
                      <th style={{ padding: '20px 32px', textAlign: 'right', fontWeight: 600 }}>{i18nText('pos.tip_left')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedHistory.map((v, idx) => (
                      <tr key={v.visitId} style={{ borderBottom: idx === pagedHistory.length - 1 ? 'none' : '1px solid #F1ECE4', transition: 'background 0.2s', cursor: 'default' }} onMouseOver={e => e.currentTarget.style.background = '#FDFCFB'} onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                        <td style={{ padding: '20px 32px', color: '#5A514A', whiteSpace: 'nowrap', fontSize: 15 }}>{fmtDate(v.date)}</td>
                        <td style={{ padding: '20px 32px', color: '#2C2A29', fontWeight: 600, fontSize: 15 }}>{v.serviceName || '—'}</td>
                        <td style={{ padding: '20px 32px', color: '#5A514A', fontSize: 15 }}>{v.technicianName ? <span style={{ background: '#F8F6F3', padding: '4px 10px', borderRadius: 20, border: '1px solid #EFEAE1' }}>{v.technicianName}</span> : '—'}</td>
                        <td style={{ padding: '20px 32px', textAlign: 'right', color: '#2C2A29', fontWeight: 700, fontSize: 16 }}>{money(v.totalCents)}</td>
                        <td style={{ padding: '20px 32px', textAlign: 'right', color: '#8A7A6D', fontSize: 15 }}>{v.tipCents ? money(v.tipCents) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {detail.recentVisits!.length > historyLimit && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 32px', borderTop: '1px solid #F1ECE4', background: '#FAFAF9' }}>
                    <div style={{ color: '#8A7A6D', fontSize: 14 }}>{i18nText('pos.showing')}{' '}{historyStart + 1} {i18nText('pos.to')}{' '}{Math.min(historyStart + historyLimit, detail.recentVisits!.length)} {i18nText('pos.of')}{' '}{detail.recentVisits!.length} {i18nText('pos.entries')}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setHistoryPage(p => Math.max(1, p - 1))} disabled={historyPage === 1} style={{ padding: '8px 16px', borderRadius: 20, background: historyPage === 1 ? '#F1ECE4' : '#FFFFFF', border: '1px solid #EADBB6', color: historyPage === 1 ? '#A09388' : '#2C2A29', fontWeight: 600, cursor: historyPage === 1 ? 'default' : 'pointer', transition: 'all 0.2s' }}>{i18nText('pos.previous_2')}</button>
                      <button onClick={() => setHistoryPage(p => Math.min(historyTotalPages, p + 1))} disabled={historyPage === historyTotalPages} style={{ padding: '8px 16px', borderRadius: 20, background: historyPage === historyTotalPages ? '#F1ECE4' : '#FFFFFF', border: '1px solid #EADBB6', color: historyPage === historyTotalPages ? '#A09388' : '#2C2A29', fontWeight: 600, cursor: historyPage === historyTotalPages ? 'default' : 'pointer', transition: 'all 0.2s' }}>{i18nText('pos.next')}</button>
                    </div>
                  </div>
                )}
              </>
            ) : <div style={{ padding: 60, textAlign: 'center', color: '#8A7A6D', fontSize: 16 }}>{i18nText('pos.no_previous_visits_on_record')}</div>}
          </section>
          {/* Appointment Reminders guide §10 / §4.3: why did (or didn't) this customer get a reminder — newest first, every event */}
          {selectedId ? (
            <section className="panel rmc-profile" data-testid="rmc-profile-history" style={{ marginTop: 24 }}>
              <h3 style={{ margin: '0 0 10px' }}>{i18nText('rmc.custTitle')}</h3>
              <CustomerReminderHistory customerId={selectedId} />
            </section>
          ) : null}
        </div>
      ) : null}

      {/* Customer Profile & Global Loyalty Protection (Nov 4 2026): "Adjust points (use negative to deduct)" is gone — a
          POSITIVE bonus is requested and the owner approves it; points are never lowered by hand */}
      {showAdjustModal && selectedId && (
        <div role="dialog" aria-modal="true" aria-label={i18nText('lb.title')} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#FFF', width: 520, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', borderRadius: 16, padding: 24, boxShadow: '0 16px 48px rgba(0,0,0,0.2)' }}>
            <LoyaltyBonusRequest customerId={selectedId} currentPoints={detail?.loyalty?.points ?? detail?.loyaltyPoints ?? null} canRequest={can('pos.customers.loyalty.edit')} />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowAdjustModal(false)} style={{ padding: '10px 16px', background: '#F1ECE4', border: 'none', borderRadius: 8, color: '#5A514A', fontWeight: 600, minHeight: 40 }}>{i18nText('pos.close')}</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
