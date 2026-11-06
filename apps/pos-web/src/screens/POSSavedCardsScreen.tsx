// POSSavedCardsScreen.tsx — Customers → Saved Cards. Search a customer, then view the cards they have on
// file (read-only). Reuses /pos/customers/search + /pos/customers/:id/payment-methods (pos.customers.view).
// Card management (add/remove/default) is the customer's own action in the customer app (PCI scope).
import { useCallback, useEffect, useRef, useState } from 'react';
import { posCustomersApi } from '../api/posCustomersApi';
import { posSavedCardsApi, type WalletTopUp } from '../api/posSavedCardsApi';
import { reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { fmtInZone } from '../i18n/format';   // the location's clock (not the device's)

type CustomerItem = { customerId: string; fullName: string; phone: string; visitsCount: number };
type Card = { id: string; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null; isDefault: boolean };

const brandGlyph = (brand: string | null) => {
  const b = (brand || '').toLowerCase();
  if (b.includes('visa')) return 'Visa';
  if (b.includes('master')) return 'Mastercard';
  if (b.includes('amex') || b.includes('american')) return 'Amex';
  if (b.includes('disc')) return 'Discover';
  return brand || t('glossary.checkout.card');
};
const expText = (m: number | null, y: number | null) => (m && y ? `${String(m).padStart(2, '0')}/${String(y).slice(-2)}` : '—');

const SearchIcon = () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>;

export function POSSavedCardsScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerItem[]>([]);
  const [selected, setSelected] = useState<CustomerItem | null>(null);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    if (selected) return;
    timer.current = setTimeout(() => runSearch(query), 250);
    return () => timer.current && clearTimeout(timer.current);
  }, [query, selected, runSearch]);

  const [topUps, setTopUps] = useState<WalletTopUp[]>([]);
  const [topUpNote, setTopUpNote] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const loadTopUps = async (customerId: string) => {
    try { const r = await posSavedCardsApi.topUps(customerId); setTopUps(r.items.filter((x) => x.status === 'UNKNOWN' || x.status === 'PROCESSING')); }
    catch (e: any) { if (e?.status === 403) setTopUps([]); else setTopUpNote(reportError(e, t('admin.savedCards.noun.topUps'))); }   // no checkout access (a technician): the section is simply not shown
  };
  const pick = async (c: CustomerItem) => {
    setSelected(c); setResults([]); setQuery(c.fullName); setLoading(true); setError(null); setCards(null); setTopUps([]); setTopUpNote(null);
    try { const r = await posSavedCardsApi.forCustomer(c.customerId); setCards((r?.cards || []) as Card[]); }
    catch (e: any) { setError(reportError(e, t('admin.savedCards.noun.cards'))); }
    finally { setLoading(false); }
    await loadTopUps(c.customerId);
  };
  // B-79: a staff Verify asks the processor for its record of the top-up (never a charge) and settles it
  const verifyTopUp = async (intentId: string) => {
    if (!selected) return;
    setVerifying(intentId); setTopUpNote(null);
    try { const r = await posSavedCardsApi.verifyTopUp(selected.customerId, intentId); setTopUpNote(r.ok ? t('pos.top_up_verified_approved') : (r.message || t('pos.skip_line_verify_pending'))); await loadTopUps(selected.customerId); }
    catch (e: any) { setTopUpNote(reportError(e, t('admin.savedCards.noun.verify'))); }
    finally { setVerifying(null); }
  };
  const reset = () => { setSelected(null); setCards(null); setQuery(''); setResults([]); setError(null); };

  return (
    <div className="work no-scrollbar" style={{ width: '100%', maxWidth: 1600, margin: '0 auto', padding: '32px 40px', background: 'transparent' }}>
      {/* Header */}
      <div className="mb-6 flex flex-col xl:flex-row gap-3 justify-between ">
        <div >
          <h1 style={{ fontFamily: '"Playfair Display", serif', fontSize: 24, color: '#2C2A29', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: '#DCAB39', fontSize: 24 }}>★</span> {t('pos.saved_cards')}{' '}<span style={{ color: '#DCAB39', fontSize: 24 }}>★</span>
          </h1>
          <div style={{ color: '#8A7A6D', fontSize: 16 }}>{t('pos.cards_a_customer_has_on_file')}</div>
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

          <div style={{ maxWidth: 840, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 24 }}>
               <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg, #FDFBF7 0%, #F5E5C6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#B5821F', fontWeight: 800, fontSize: 28, border: '2px solid #EADBB6', boxShadow: '0 4px 12px rgba(181,130,31,0.1)' }}>
                 {selected.fullName?.charAt(0).toUpperCase() || '?'}
               </div>
               <div>
                  <h2 style={{ fontFamily: '"Playfair Display", serif', fontSize: 32, margin: 0, color: '#2C2A29' }}>{selected.fullName}</h2>
                  <div style={{ fontSize: 14, color: '#8A7A6D', marginTop: 4 }}>{selected.phone || t('pos.no_phone')}</div>
               </div>
            </div>

            <section style={{ background: '#FFFFFF', padding: 40, borderRadius: 24, border: '1px solid #F1ECE4', boxShadow: '0 8px 24px rgba(0,0,0,0.02)' }}>
              {loading ? <div style={{ textAlign: 'center', padding: 40, color: '#8A7A6D' }}>{t('pos.loading_cards')}</div> : cards && cards.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#8A7A6D', fontSize: 16 }}>{t('pos.no_cards_on_file_the_customer_n9ur')}</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
                  {cards?.map((c) => (
                    <div key={c.id} style={{ position: 'relative', background: '#FAFAF9', padding: '24px', borderRadius: 20, border: '1px dashed #D2C4B3', display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {c.isDefault ? (
                        <div style={{ position: 'absolute', top: 20, right: 20 }}>
                          <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 800, background: 'linear-gradient(135deg, #FDFBF7 0%, #F5E5C6 100%)', color: '#B5821F', border: '1px solid #EADBB6', letterSpacing: '0.05em' }}>{t('pos.default_2')}</span>
                        </div>
                      ) : null}
                      <div style={{ fontWeight: 800, fontSize: 18, color: '#2C2A29', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{brandGlyph(c.brand)}</div>
                      <div style={{ fontFamily: 'monospace', fontSize: 24, letterSpacing: '2px', color: '#5A514A', background: '#FFFFFF', padding: '6px 12px', borderRadius: 8, border: '1px solid #EFEAE1', alignSelf: 'flex-start' }}>
                        •••• {c.last4 || '••••'}
                      </div>
                      <div style={{ fontSize: 13, color: '#8A7A6D', marginTop: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {t('pos.expires')}{' '}{expText(c.expMonth, c.expYear)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {topUps.length || topUpNote ? (
                <div style={{ marginTop: 24 }} data-testid="topups-unconfirmed">
                  <div style={{ fontWeight: 700, color: '#2C2A29', marginBottom: 8 }}>{t('pos.wallet_top_ups_being_confirmed')}</div>
                  {topUpNote ? <div role="status" style={{ fontSize: 13, color: '#9A6700', marginBottom: 8 }}>{topUpNote}</div> : null}
                  {topUps.map((x) => (
                    <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid #EFEAE1', borderRadius: 12, marginBottom: 8 }}>
                      <span style={{ flex: 1, fontSize: 14 }}>{`$${(x.amountCents / 100).toFixed(2)}`} · {fmtInZone(x.createdAt, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                      <button className="btn" disabled={verifying === x.id} onClick={() => verifyTopUp(x.id)}>{t('pos.verify_payment')}</button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div style={{ marginTop: 32, paddingTop: 20, borderTop: '1px solid #EFEAE1', fontSize: 13, color: '#A09388', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#D4AF37', fontSize: 16 }}>🔒</span> {t('pos.card_details_are_tokenized_only_the_pgtk')}
              </div>
            </section>
          </div>
        </div>
      )}
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
