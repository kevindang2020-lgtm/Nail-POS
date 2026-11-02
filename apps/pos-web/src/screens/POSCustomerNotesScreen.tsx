// POSCustomerNotesScreen.tsx — Customers → Notes. Search a customer, then view/edit their salon notes
// (allergies, warnings, preferences). Reuses /pos/customers/search + /pos/customers/:id/notes
// (pos.customers.notes.view to read, pos.customers.notes.edit to save). Notes are sensitive.
import { useCallback, useEffect, useRef, useState } from 'react';
import { posCustomersApi } from '../api/posCustomersApi';
import { reportError } from './reportsCommon';
import { saveDraft, isOfflineFailure } from '../api/offline-drafts';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type CustomerItem = { customerId: string; fullName: string; phone: string; visitsCount: number };
type Notes = { salonNotes: string; allergyNotes: string; preferredStyle: string; preferredTechnician: string; servicePreferences: string; warnings: string; customerVisible: boolean };

const EMPTY: Notes = { salonNotes: '', allergyNotes: '', preferredStyle: '', preferredTechnician: '', servicePreferences: '', warnings: '', customerVisible: false };
const field = (label: string, value: string, onChange: (v: string) => void, rows = 2, hint?: string) => (
  <label style={{ display: 'block', fontSize: 13, marginBottom: 20 }}>
    <span style={{ fontWeight: 600, color: '#2C2A29', display: 'flex', alignItems: 'baseline', gap: 8 }}>{label}{hint ? <span style={{ color: '#8A7A6D', fontSize: 12, fontWeight: 400 }}>— {hint}</span> : null}</span>
    <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} style={{ width: '100%', padding: '12px 16px', marginTop: 8, resize: 'vertical', border: '1px solid #EFEAE1', borderRadius: 12, fontSize: 14, background: '#FAFAF9', outline: 'none', transition: 'border-color 0.2s', fontFamily: 'inherit' }} onFocus={(e) => e.target.style.borderColor = '#D4AF37'} onBlur={(e) => e.target.style.borderColor = '#EFEAE1'} />
  </label>
);

const SearchIcon = () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>;

export function POSCustomerNotesScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerItem[]>([]);
  const [selected, setSelected] = useState<CustomerItem | null>(null);
  const [notes, setNotes] = useState<Notes | null>(null);
  const [base, setBase] = useState<Notes | null>(null);   // Decision 33: the notes as loaded — an offline draft is checked against them
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
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

  const pick = async (c: CustomerItem) => {
    setSelected(c); setResults([]); setQuery(c.fullName); setLoading(true); setError(null); setNote(null); setNotes(null);
    try { const n = await posCustomersApi.getNotes(c.customerId); setNotes({ ...EMPTY, ...(n || {}) }); setBase({ ...EMPTY, ...(n || {}) }); }
    catch (e: any) { setError(reportError(e, 'these notes')); }
    finally { setLoading(false); }
  };
  const reset = () => { setSelected(null); setNotes(null); setBase(null); setQuery(''); setResults([]); setError(null); setNote(null); };
  const save = async () => {
    if (!selected || !notes) return;
    setSaving(true); setNote(null);
    try { const saved = await posCustomersApi.setNotes(selected.customerId, notes as any); setNotes({ ...EMPTY, ...(saved || notes) }); setBase({ ...EMPTY, ...(saved || notes) }); setNote('Notes saved.'); }
    catch (e: any) {
      // Decision 33: offline, the note is kept on this device as a DRAFT — checked against the server and applied by a
      // person when the connection is back (never sent or applied offline).
      if (isOfflineFailure(e) && saveDraft({ kind: 'customer_notes', targetId: selected.customerId, label: selected.fullName, payload: notes as any, base: (base ?? EMPTY) as any })) {
        setNote(t('pos.you_re_offline_these_notes_are_1uh7'));
      } else setNote(e?.message || t('pos.could_not_save_notes_you_may_1din'));
    }
    finally { setSaving(false); }
  };

  const up = (k: keyof Notes) => (v: string) => setNotes((n) => (n ? { ...n, [k]: v } : n));

  return (
    <div className="work no-scrollbar" style={{ width: '100%', maxWidth: 1600, margin: '0 auto', padding: '32px 40px', background: 'transparent' }}>
      {/* Header */}
      <div className="mb-6 flex flex-col xl:flex-row gap-3 justify-between ">
        <div >
          <h1 style={{ fontFamily: '"Playfair Display", serif', fontSize: 24, color: '#2C2A29', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: '#DCAB39', fontSize: 24 }}>★</span> {t('pos.customer_notes')}{' '}<span style={{ color: '#DCAB39', fontSize: 24 }}>★</span>
          </h1>
          <div style={{ color: '#8A7A6D', fontSize: 16 }}>{t('pos.allergies_warnings_and_preferences_handle_with_1g67')}</div>
        </div>
        {/* Search Bar */}
        <div className="flex " style={{ position: 'relative' }}>
          <div className="relative w-full max-w-[500px]">
            <div className="absolute left-3 top-6 z-10 -translate-y-1/2 text-[#B5821F]">
              <SearchIcon />
            </div>
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(e) => {
                setSelected(null);
                setQuery(e.target.value);
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

      {selected && notes && (
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
              {loading ? <div style={{ textAlign: 'center', padding: 40, color: '#8A7A6D' }}>{t('pos.loading_notes')}</div> : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                    {field(t('pos.warnings'), notes.warnings, up('warnings'), 2, t('people.customer.notes.warningsHint'))}
                    {field(t('pos.allergies'), notes.allergyNotes, up('allergyNotes'), 2)}
                    {field(t('pos.salon_notes'), notes.salonNotes, up('salonNotes'), 3)}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 8 }}>
                    {field(t('pos.preferred_style'), notes.preferredStyle, up('preferredStyle'), 2)}
                    {field(t('people.customer.notes.servicePreferencesTitle'), notes.servicePreferences, up('servicePreferences'), 2)}
                  </div>
                  {field(t('people.customer.notes.preferredTechnicianTitle'), notes.preferredTechnician, up('preferredTechnician'), 1)}
                  
                  <div style={{ marginTop: 24, padding: '20px 24px', background: '#FAFAF9', borderRadius: 16, border: '1px solid #EFEAE1', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 700, color: '#2C2A29', fontSize: 15 }}>{t('pos.visible_to_the_customer')}</div>
                      <div style={{ fontSize: 13, color: '#8A7A6D', marginTop: 4 }}>{t('pos.if_checked_the_customer_can_view_ynoe')}</div>
                    </div>
                    <label style={{ cursor: 'pointer' }}>
                      <input type="checkbox" checked={notes.customerVisible} onChange={(e) => setNotes({ ...notes, customerVisible: e.target.checked })} style={{ width: 24, height: 24, accentColor: '#D4AF37', cursor: 'pointer' }} />
                    </label>
                  </div>

                  <div style={{ marginTop: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    {note ? (
                      <div style={{ fontSize: 14, fontWeight: 600, padding: '10px 16px', borderRadius: 20, background: note === 'Notes saved.' ? '#EEF7EF' : '#FDF0EE', color: note === 'Notes saved.' ? '#2E7D32' : '#C0392B', border: `1px solid ${note === 'Notes saved.' ? '#A5D6A7' : '#FCA5A5'}` }}>
                        {note === 'Notes saved.' ? '✓ ' : '⚠ '} {note}
                      </div>
                    ) : <div></div>}
                    <button style={{ background: '#2C2A29', color: '#FFFFFF', border: 'none', borderRadius: 24, padding: '12px 32px', fontSize: 15, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} disabled={saving} onClick={save} onMouseOver={e => e.currentTarget.style.transform = 'translateY(-1px)'} onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}>
                      {saving ? t('pos.saving_2') : t('pos.save_notes')}
                    </button>
                  </div>
                </>
              )}
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
