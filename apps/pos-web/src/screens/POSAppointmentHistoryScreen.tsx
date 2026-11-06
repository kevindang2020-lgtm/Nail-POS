// POSAppointmentHistoryScreen.tsx — Customers → Appointment History. Search a customer, then view their
// appointment history. Reuses /pos/customers/search + /pos/customers/:id/appointments (pos.customers.view).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fmtInZone } from '../i18n/format';
import { posCustomersApi } from '../api/posCustomersApi';
import { money, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { statusLabel } from '../i18n/status-label';

type CustomerItem = { customerId: string; fullName: string; phone: string; visitsCount: number };
type Appt = { 
  appointmentId: string; startsAt: string; serviceName: string; technicianName: string; status: string;
  branchName?: string; source?: string; scheduledDurationMinutes?: number; actualDurationMinutes?: number;
  originalPriceCents?: number; discountsCents?: number; finalPriceCents?: number; tipCents?: number;
  taxCents?: number; totalCents?: number; cancelReason?: string; notes?: string;
  paymentMethodMasked?: string; loyaltyPointsEarned?: number; loyaltyPointsRedeemed?: number;
  giftCardUsageCents?: number; membershipBenefitUsage?: string; refundStatus?: string; rebooked?: boolean;
};

const SearchIcon = () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>;

// F1 §46 (Nov 6 2026): the location's time zone (the salon's day and hour), not the device's
const fmtDateTime = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const statusChip = (status: string) => {
  const s = (status || '').toLowerCase();
  const map: Record<string, { bg: string; fg: string, border: string }> = { 
    completed: { bg: '#EEF7EF', fg: '#2E7D32', border: '#A5D6A7' }, 
    booked: { bg: '#F0F9FF', fg: '#0284C7', border: '#BAE6FD' }, 
    confirmed: { bg: '#F0F9FF', fg: '#0284C7', border: '#BAE6FD' }, 
    cancelled: { bg: '#FDF0EE', fg: '#C0392B', border: '#FCA5A5' }, 
    no_show: { bg: '#FDF0EE', fg: '#C0392B', border: '#FCA5A5' }, 
    'no-show': { bg: '#FDF0EE', fg: '#C0392B', border: '#FCA5A5' } 
  };
  const m = map[s] || { bg: '#FAFAF9', fg: '#8A7A6D', border: '#EFEAE1' };
  const label = status ? statusLabel('appointment', status.replace(/-/g, '_')) : '—';
  return <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 20, fontSize: 13, fontWeight: 700, background: m.bg, color: m.fg, border: `1px solid ${m.border}` }}>{label}</span>;
};

export function POSAppointmentHistoryScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerItem[]>([]);
  const [selected, setSelected] = useState<CustomerItem | null>(null);
  const [appts, setAppts] = useState<Appt[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const timer = useRef<any>(null);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true); setError(null);
    try { const r = await posCustomersApi.quickSearch(q); setResults((r?.items || []) as CustomerItem[]); }
    catch (e: any) { setError(reportError(e, 'customers')); }
    finally { setSearching(false); }
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (selected) return; // don't re-search while viewing a customer
    timer.current = setTimeout(() => runSearch(query), 250);
    return () => timer.current && clearTimeout(timer.current);
  }, [query, selected, runSearch]);

  const pick = async (c: CustomerItem) => {
    setSelected(c); setResults([]); setQuery(c.fullName); setLoading(true); setError(null); setAppts(null);
    try { setAppts((await posCustomersApi.appointments(c.customerId)) as Appt[]); }
    catch (e: any) { setError(reportError(e, t('admin.history.noun'))); }
    finally { setLoading(false); }
  };
  const reset = () => { setSelected(null); setAppts(null); setQuery(''); setResults([]); setError(null); };

  return (
    <div className="work no-scrollbar" style={{ width: '100%', maxWidth: 1600, margin: '0 auto', padding: '32px 40px', background: 'transparent' }}>
      {/* Header */}
      <div className="mb-6 flex flex-col xl:flex-row gap-3 justify-between ">
        <div >
          <h1 style={{ fontFamily: '"Playfair Display", serif', fontSize: 24, color: '#2C2A29', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: '#DCAB39', fontSize: 24 }}>★</span> {t('pos.appointment_history')}{' '}<span style={{ color: '#DCAB39', fontSize: 24 }}>★</span>
          </h1>
          <div style={{ color: '#8A7A6D', fontSize: 16 }}>{t('pos.look_up_a_customer_s_past_6lwd')}</div>
        </div>
        {/* Search Bar */}
        <div className="flex " style={{ position: 'relative' }}>
          <div className="relative w-full max-w-[500px]">
            <div className="absolute left-3 top-6 z-10 -translate-y-1/2 text-[#B5821F]">
              <SearchIcon />
            </div>
            <ImeSafeInput
              type="search"
              autoFocus
              value={query}
              onValue={(v) => {
                setSelected(null);
                setQuery(v);
              }}
              placeholder={t('pos.search_by_name_phone_or_email_2')}
              className="w-full rounded-[20px] border border-[#EADBB6] bg-white px-10 py-[10px] pr-12 text-[16px] text-[#2C2A29] shadow-[0_8px_32px_rgba(181,130,31,0.08)] outline-none transition-all duration-200 focus:shadow-[0_12px_40px_rgba(181,130,31,0.15)]"
            />
            {selected || query ? (
              <button
                onClick={reset}
                className="absolute right-3 top-6 -translate-y-1/2 cursor-pointer rounded-[20px] border border-[#EFEAE1] bg-[#F8F6F3] px-2 py-1 text-[13px] font-semibold text-[#8A7A6D] transition-colors duration-200 hover:bg-[#F1ECE4]"
              >
                {t('pos.clear')}
              </button>
            ) : null}
            {searching ? <span style={{ position: 'absolute', right: '65px', top: '50%', transform: 'translateY(-50%)', color: '#8A7A6D', fontSize: 12 }}>{t('pos.searching')}</span> : null}
          </div>
        </div>
      </div>

      {/* Search Results Grid */}
      {!selected && results.length > 0 ? (
        <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
          <h2 style={{ fontFamily: '"Playfair Display", serif', fontSize: 18, color: '#2C2A29', marginBottom: 20, borderBottom: '1px solid #EADBB6', paddingBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            {!query.trim() ? t('pos.recently_active_customers') : t('pos.search_results')}
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
                <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'linear-gradient(135deg, #FDFBF7 0%, #F5E5C6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#B5821F', fontWeight: 800, fontSize: 24, border: '1px solid #EADBB6', flexShrink: 0 }}>
                  {c.fullName?.charAt(0).toUpperCase() || '?'}
                </div>
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontWeight: 700, color: '#2C2A29', fontSize: 17, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.fullName || t('pos.unnamed_customer')}</div>
                  <div style={{ color: '#8A7A6D', fontSize: 14 }}>{c.phone || t('pos.no_phone_on_file')} <span style={{ margin: '0 6px', color: '#D2C4B3' }}>|</span> <span style={{ fontWeight: 600, color: '#B5821F' }}>{c.visitsCount ?? 0} {t('pos.visits')}</span></div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {!selected && !searching && query.trim() && results.length === 0 && !error ? (
        <div style={{ textAlign: 'center', padding: '80px 20px', background: '#FFFFFF', borderRadius: 24, border: '1px dashed #D2C4B3', boxShadow: '0 4px 16px rgba(0,0,0,0.02)' }}>
          <div style={{ color: '#D4AF37', marginBottom: 16, opacity: 0.6, transform: 'scale(1.5)' }}><SearchIcon /></div>
          <div style={{ fontFamily: '"Playfair Display", serif', fontSize: 24, fontWeight: 600, color: '#2C2A29', marginBottom: 8 }}>{t('pos.no_profiles_found')}</div>
          <div style={{ color: '#8A7A6D', fontSize: 16 }}>{t('pos.we_couldn_t_find_anyone_matching')}{query}{t('pos.try_searching_with_a_different_name_ec2s')}</div>
        </div>
      ) : null}

      {error ? <div style={{ background: '#FDF0EE', color: '#C0392B', padding: '16px 24px', borderRadius: 16, margin: '24px auto', maxWidth: 640, textAlign: 'center', fontWeight: 600, border: '1px solid #FCA5A5' }}>{error}</div> : null}

      {selected && (
        <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 32 }}>
            <button onClick={reset} style={{ background: '#FFFFFF', border: '1px solid #EADBB6', borderRadius: 24, padding: '10px 24px', fontSize: 14, fontWeight: 700, color: '#2C2A29', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s' }} onMouseOver={e => e.currentTarget.style.background = '#FDFCFB'} onMouseOut={e => e.currentTarget.style.background = '#FFFFFF'}>
              <span style={{ color: '#B5821F' }}>←</span> {t('pos.search_another_customer')}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 24 }}>
            {[
              { l: t('pos.customer_name_3'), v: selected.fullName, d: selected.phone || t('pos.no_phone'), c: '#2C2A29', bg: '#FFFFFF' },
              { l: t('pos.lifetime_visits'), v: selected.visitsCount ?? 0, d: t('pos.total_salon_check_ins'), c: '#2C2A29', bg: '#FFFFFF' },
              { l: t('pos.appointments_on_record'), v: appts ? appts.length : '—', d: t('pos.past_upcoming'), c: '#B5821F', bg: '#FDFBF7' }
            ].map((k, i) => (
              <div key={i} style={{ background: k.bg, padding: '24px 20px', borderRadius: 20, border: '1px solid #F1ECE4', boxShadow: '0 4px 16px rgba(0,0,0,0.02)', textAlign: 'center' }}>
                <div style={{ color: '#8A7A6D', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>{k.l}</div>
                <div style={{ color: k.c, fontSize: 24, fontWeight: 700, fontFamily: '"Playfair Display", serif', marginBottom: 4 }}>{k.v}</div>
                <div style={{ color: '#A09388', fontSize: 13 }}>{k.d}</div>
              </div>
            ))}
          </div>

          <section style={{ background: '#FFFFFF', borderRadius: 24, border: '1px solid #F1ECE4', boxShadow: '0 8px 24px rgba(0,0,0,0.02)', overflow: 'hidden' }}>
            <div style={{ fontFamily: '"Playfair Display", serif', fontSize: 24, color: '#2C2A29', padding: '32px 32px 24px', borderBottom: '1px solid #EFEAE1', background: '#FAFAF9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <span>{t('pos.appointment_history')}</span>
            </div>

            {loading ? <div style={{ padding: 60, textAlign: 'center', color: '#8A7A6D', fontSize: 16 }}>{t('pos.loading_history')}</div>
              : !appts || appts.length === 0 ? <div style={{ padding: 60, textAlign: 'center', color: '#8A7A6D', fontSize: 16 }}>{t('pos.no_appointments_on_record_for_this_13o5')}</div>
              : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#FFFFFF', color: '#A09388', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '2px solid #F1ECE4' }}>
                    <th style={{ padding: '20px 32px', textAlign: 'left', fontWeight: 600 }}>{t('pos.date_time')}</th>
                    <th style={{ padding: '20px 32px', textAlign: 'left', fontWeight: 600 }}>{t('pos.service_provided')}</th>
                    <th style={{ padding: '20px 32px', textAlign: 'left', fontWeight: 600 }}>{t('pos.technician')}</th>
                    <th style={{ padding: '20px 32px', textAlign: 'right', fontWeight: 600 }}>{t('pos.status')}</th>
                  </tr>
                </thead>
                <tbody>{appts.map((a, idx) => (
                  <React.Fragment key={a.appointmentId}>
                    <tr onClick={() => setExpandedId(expandedId === a.appointmentId ? null : a.appointmentId)} style={{ borderBottom: expandedId === a.appointmentId ? 'none' : (idx === appts.length - 1 ? 'none' : '1px solid #F1ECE4'), transition: 'background 0.2s', cursor: 'pointer' }} onMouseOver={e => e.currentTarget.style.background = '#FDFCFB'} onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '20px 32px', color: '#5A514A', whiteSpace: 'nowrap', fontSize: 15 }}>{fmtDateTime(a.startsAt)}</td>
                      <td style={{ padding: '20px 32px', color: '#2C2A29', fontWeight: 600, fontSize: 15 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12, color: '#B5821F' }}>{expandedId === a.appointmentId ? '▼' : '▶'}</span>
                          {a.serviceName || '—'}
                        </div>
                      </td>
                      <td style={{ padding: '20px 32px', color: '#5A514A', fontSize: 15 }}>{a.technicianName ? <span style={{ background: '#F8F6F3', padding: '4px 10px', borderRadius: 20, border: '1px solid #EFEAE1' }}>{a.technicianName}</span> : '—'}</td>
                      <td style={{ padding: '20px 32px', textAlign: 'right' }}>{statusChip(a.status)}</td>
                    </tr>
                    {expandedId === a.appointmentId && (
                      <tr style={{ borderBottom: idx === appts.length - 1 ? 'none' : '1px solid #F1ECE4' }}>
                        <td colSpan={4} style={{ padding: 0 }}>
                          <div style={{ padding: '24px 32px', background: '#FAFAF9', borderTop: '1px dashed #EADBB6', borderBottom: '1px dashed #EADBB6', animation: 'fadeIn 0.2s ease-out' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24 }}>
                              <div>
                                <div style={{ fontSize: 12, color: '#8A7A6D', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{t('pos.financials')}</div>
                                <div style={{ fontSize: 14, color: '#2C2A29', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('pos.original_price')}</span> <span>{money(a.originalPriceCents || 0)}</span></div>
                                  {a.discountsCents ? <div style={{ display: 'flex', justifyContent: 'space-between', color: '#2E7D32' }}><span>{t('pos.discount')}</span> <span>-{money(a.discountsCents)}</span></div> : null}
                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('pos.tax_2')}</span> <span>{money(a.taxCents || 0)}</span></div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('pos.tip_2')}</span> <span>{money(a.tipCents || 0)}</span></div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, paddingTop: 4, borderTop: '1px solid #EADBB6', marginTop: 4 }}><span>{t('pos.total_2')}</span> <span>{money(a.totalCents || 0)}</span></div>
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: 12, color: '#8A7A6D', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{t('pos.details')}</div>
                                <div style={{ fontSize: 14, color: '#2C2A29', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('pos.branch_2')}</span> <span>{a.branchName || '—'}</span></div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('pos.source_2')}</span> <span><span style={{ background: '#F0F9FF', color: '#0284C7', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>{statusLabel('source', a.source)}</span></span></div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('pos.duration_2')}</span> <span>{a.scheduledDurationMinutes || 0} {t('pos.mins_sched')}{' '}{a.actualDurationMinutes || 0} {t('pos.mins_act')}</span></div>
                                  {a.paymentMethodMasked ? <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('pos.payment_2')}</span> <span>{a.paymentMethodMasked}</span></div> : null}
                                  {a.refundStatus ? <div style={{ display: 'flex', justifyContent: 'space-between', color: '#C0392B', fontWeight: 600 }}><span>{t('pos.refund_2')}</span> <span>{a.refundStatus}</span></div> : null}
                                  {a.loyaltyPointsEarned ? <div style={{ display: 'flex', justifyContent: 'space-between', color: '#2D6CBF' }}><span>{t('pos.loyalty_earned')}</span> <span>+{a.loyaltyPointsEarned} {t('pos.pts')}</span></div> : null}
                                  {a.loyaltyPointsRedeemed ? <div style={{ display: 'flex', justifyContent: 'space-between', color: '#2D6CBF' }}><span>{t('pos.loyalty_used')}</span> <span>-{a.loyaltyPointsRedeemed} {t('pos.pts')}</span></div> : null}
                                  {a.giftCardUsageCents ? <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('pos.gift_card')}</span> <span>{money(a.giftCardUsageCents)}</span></div> : null}
                                  {a.membershipBenefitUsage ? <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('pos.membership_3')}</span> <span>{a.membershipBenefitUsage}</span></div> : null}
                                  {a.rebooked ? <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('pos.rebooked_2')}</span> <span>{t('pos.yes')}</span></div> : null}
                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('pos.photos_2')}</span> <span style={{ color: '#8A7A6D' }}>{t('pos.no_photos_available_consent_required')}</span></div>
                                </div>
                              </div>
                              {(a.notes || a.cancelReason) ? (
                                <div>
                                  <div style={{ fontSize: 12, color: '#8A7A6D', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{t('pos.notes_exceptions')}</div>
                                  <div style={{ fontSize: 14, color: '#2C2A29', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {a.notes ? <div><span style={{ fontWeight: 600 }}>{t('pos.notes_2')}</span> {a.notes}</div> : null}
                                    {a.cancelReason ? <div><span style={{ fontWeight: 600, color: '#C0392B' }}>{t('pos.cancel_reason')}</span> {a.cancelReason}</div> : null}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}</tbody>
              </table>
            )}
          </section>
        </div>
      )}
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
