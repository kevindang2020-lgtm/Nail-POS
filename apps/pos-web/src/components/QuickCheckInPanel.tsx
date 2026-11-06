// QuickCheckInPanel.tsx — T03 Check-In centerpiece. Three tabs (Existing Customer / New Customer / Walk-In) that all
// resolve to the real /pos/check-in/walk-in endpoint (it links-or-creates the customer server-side). Service chips come
// from the live check-in state's service catalog. No mock data — empty catalog shows an honest message. On success it
// calls onComplete() to reload the screen state.
// 200-technician §2 (Oct 27 2026): the requested technician is picked through the server-paged picker (approved for the
// chosen services, working today) — the Check-In state no longer ships the roster for a <select>.
import { useEffect, useMemo, useRef, useState } from 'react';
import { posCheckInApi } from '../api/posCheckInApi';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { TechnicianPickerButton } from './TechnicianPickerButton';
import { statusLabel } from '../i18n/status-label';
import { fmtMoney, fmtNumber } from '../i18n/format';
import { msg as note, renderMsg, type Msg } from '../i18n/notice';

type ServiceOpt = { serviceId: string; name: string; durationMinutes?: number; isAddon?: boolean; priceCents?: number };
type TechOpt = { technicianId: string; displayName: string; status?: string };
/** booking sources the front desk records (codes; labelled at render) */
const SOURCES = ['in_person', 'staff_booking', 'phone', 'website', 'customer_app', 'ai_receptionist', 'kiosk', 'walk_in'] as const;
type FoundCustomer = { customerId: string; fullName: string; phone?: string; totalVisits?: number };
// Rich guest passed from the live check-in state (state.selectedGuest). Extra profile fields render only when present.
type InitialGuest = {
  customerId: string; fullName: string; phone?: string; email?: string; isLoyaltyMember?: boolean; totalVisits?: number; totalSpentCents?: number;
  loyaltyPoints?: number; lastVisitLabel?: string; birthdayLabel?: string; preferredTech?: string; favoriteService?: string; notes?: string; allergies?: string;
  appointment?: { bookingSource?: string };
};

const GOLD = '#A96F22';
// Check-In 27-inch mandate §22, §67 (Oct 28 2026): inputs, tabs and buttons are 40–44 px finger targets (were 34)
const input: React.CSSProperties = { height: 40, border: '1px solid #E7DCC8', borderRadius: 8, padding: '0 10px', background: '#fff', fontFamily: 'inherit', fontSize: 13, width: '100%', boxSizing: 'border-box' };
const tabBtn = (active: boolean): React.CSSProperties => ({ flex: 1, height: 40, border: 'none', borderBottom: '2px solid ' + (active ? GOLD : 'transparent'), background: 'transparent', color: active ? GOLD : '#6A5C45', fontWeight: 700, fontSize: 13, cursor: 'pointer' });
const chip = (on: boolean): React.CSSProperties => ({ minHeight: 34, padding: '5px 11px', borderRadius: 999, border: '1px solid ' + (on ? GOLD : '#E7DCC8'), background: on ? GOLD : '#fff', color: on ? '#fff' : '#4A4032', fontSize: 12, cursor: 'pointer' });

type Tab = 'existing' | 'new' | 'walkin';
export function QuickCheckInPanel({ services, technicians = [], initialGuest, onComplete, tabRequest, bare = false }: { services: ServiceOpt[]; /** names already on screen (seed only; picking pages from the server) */ technicians?: TechOpt[]; initialGuest?: InitialGuest; onComplete: () => void;
  /** Check-In Quick Actions (New Check-In / Walk-In) open a tab here — `n` changes on every tap */ tabRequest?: { tab: Tab; n: number };
  /** the screen's card already shows the title */ bare?: boolean }) {
  const [tab, setTab] = useState<Tab>('existing');
  const [phone, setPhone] = useState('');
  const [results, setResults] = useState<FoundCustomer[] | null>(null);
  const [selected, setSelected] = useState<FoundCustomer | null>(initialGuest ? { customerId: initialGuest.customerId, fullName: initialGuest.fullName, phone: initialGuest.phone, totalVisits: initialGuest.totalVisits } : null);
  const [searching, setSearching] = useState(false);
  const [nc, setNc] = useState({ first: '', last: '', phone: '', email: '', sms: false });
  const [wi, setWi] = useState({ name: '', notes: '' });
  const [svc, setSvc] = useState<Set<string>>(new Set(initialGuest && services[0] ? [services[0].serviceId] : []));
  const [showAllSvc, setShowAllSvc] = useState(false);
  const [techId, setTechId] = useState('');
  const [source, setSource] = useState('in_person');
  const [busy, setBusy] = useState(false);
  const [techName, setTechName] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: Msg } | null>(null);   // a key, translated at render
  const guest = selected && initialGuest && selected.customerId === initialGuest.customerId ? initialGuest : null;

  const toggleSvc = (id: string) => setSvc((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const estMinutes = useMemo(() => services.filter((s) => svc.has(s.serviceId)).reduce((a, s) => a + (s.durationMinutes || 0), 0), [services, svc]);

  // §28: ONE idempotency key per check-in attempt (kept across repeated taps and retries, renewed after success or a
  // reset) + an in-flight guard — three fast taps on Complete Check-In are one request, one visit, one queue entry
  const attemptKey = useRef<string | null>(null); const inFlight = useRef(false);
  const reset = () => { setPhone(''); setResults(null); setSelected(null); setNc({ first: '', last: '', phone: '', email: '', sms: false }); setWi({ name: '', notes: '' }); setSvc(new Set()); setTechId(''); setTechName(''); setSource('in_person'); attemptKey.current = null; };
  // §27: explicit state boundaries — switching Existing → New → Walk-In starts a clean form (nothing incompatible carries over)
  const switchTab = (t: Tab) => { if (t !== tab) reset(); setTab(t); setMsg(null); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per tab request (its counter n); switchTab is recreated every render
  useEffect(() => { if (tabRequest) switchTab(tabRequest.tab);   }, [tabRequest?.n]);

  const search = async () => {
    if (!phone.trim()) return;
    setSearching(true); setMsg(null); setSelected(null);
    try { setResults(await posCheckInApi.searchCustomers(phone.trim())); }
    catch (e: any) { setMsg({ kind: 'err', text: e?.message || note('pos.search_failed') }); }
    finally { setSearching(false); }
  };

  const complete = async () => {
    setMsg(null);
    if (svc.size === 0) { setMsg({ kind: 'err', text: note('pos.select_at_least_one_service') }); return; }
    if (inFlight.current) return;
    const idempotencyKey = attemptKey.current ?? (attemptKey.current = (globalThis.crypto?.randomUUID?.() || `ci-${Date.now()}-${Math.random().toString(36).slice(2)}`));
    let body: Record<string, unknown>;
    if (tab === 'existing') {
      if (!selected) { setMsg({ kind: 'err', text: note('pos.find_and_select_a_customer_first') }); return; }
      body = { customerId: selected.customerId, customerName: selected.fullName, customerPhone: selected.phone, serviceIds: [...svc], technicianId: techId || undefined, source: source, idempotencyKey };
    } else if (tab === 'new') {
      // §25: first / last name, phone, optional email and the SMS consent all reach the new customer record
      const name = [nc.first.trim(), nc.last.trim()].filter(Boolean).join(' ');
      if (!nc.first.trim()) { setMsg({ kind: 'err', text: note('pos.customer_name_is_required') }); return; }
      body = { customerName: name, customerPhone: nc.phone || undefined, customerEmail: nc.email.trim() || undefined, smsOptIn: nc.sms, serviceIds: [...svc], technicianId: techId || undefined, isNewCustomer: true, source: source, idempotencyKey };
    } else {
      if (!wi.name.trim()) { setMsg({ kind: 'err', text: note('pos.guest_name_is_required') }); return; }
      body = { customerName: wi.name.trim(), serviceIds: [...svc], technicianId: techId || undefined, notes: wi.notes.trim() || undefined, source: source, idempotencyKey };
    }
    inFlight.current = true; setBusy(true);
    try { await posCheckInApi.walkIn(body); setMsg({ kind: 'ok', text: note('pos.checked_in') }); reset(); onComplete(); }
    catch (e: any) { setMsg({ kind: 'err', text: e?.message || note('pos.check_in_failed') }); }
    finally { inFlight.current = false; setBusy(false); }
  };

  // plain render helpers (not components declared inside this one — those remount on every keystroke; the picker inside
  // lost its open state). Overlay/remount lesson from the Serving / Service Done / Queue mandates.
  const serviceChips = () => {
    const roots = services.filter((s) => !s.isAddon);
    const addons = services.filter((s) => s.isAddon);
    const shown = showAllSvc ? roots : roots.slice(0, 12);
    const hidden = roots.length - shown.length;
    return (
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6A5C45', margin: '4px 0 6px' }}>{tx('pos.select_service')}{estMinutes ? tx('pos.estminutes_min', { estMinutes: String(estMinutes) }) : ''}</div>
        {services.length === 0 ? <div style={{ fontSize: 12, color: '#8A7A66' }}>{tx('pos.no_services_configured')}</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {shown.map((s) => <button key={s.serviceId} style={chip(svc.has(s.serviceId))} onClick={() => toggleSvc(s.serviceId)}>{s.name}</button>)}
              {hidden > 0 ? <button title={tx('pos.show_hidden_more_service_plural', { hidden: String(hidden), plural: String(hidden === 1 ? '' : 's') })} style={{ ...chip(false), width: 30, padding: 0, fontWeight: 800 }} onClick={() => setShowAllSvc(true)}>+{hidden}</button> : null}
              {showAllSvc && roots.length > 12 ? <button title={tx('pos.show_fewer')} style={{ ...chip(false), padding: '5px 10px', fontWeight: 700 }} onClick={() => setShowAllSvc(false)}>{tx('pos.less')}</button> : null}
            </div>
            {addons.length > 0 && Array.from(svc).some(id => !services.find(x => x.serviceId === id)?.isAddon) && (
              <div style={{ padding: '8px 12px', background: '#FFF9F0', borderRadius: 8, border: '1px dashed #E7DCC8' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#8A7A66', marginBottom: 6 }}>{tx('pos.suggested_add_ons')}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {addons.map((s) => <button key={s.serviceId} style={{ ...chip(svc.has(s.serviceId)), fontSize: 11, padding: '3px 8px' }} onClick={() => toggleSvc(s.serviceId)}>+ {s.name}</button>)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };
  const assignRow = () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 9, color: '#8A7A66', fontWeight: 700 }}>{tx('pos.requested_technician')}</span>
        <TechnicianPickerButton value={techId} valueName={techName || technicians.find((t) => t.technicianId === techId)?.displayName}
          emptyLabel={tx('pos.any_available_technician')} anyLabel={tx('pos.any_available_technician')} ariaLabel={tx('pos.requested_technician')}
          serviceIds={[...svc]} workingOnlyDefault onChange={(id, t) => { setTechId(id); setTechName(t?.name || ''); }}
          style={{ height: 40, width: '100%', minWidth: 0, maxWidth: '100%' }} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 9, color: '#8A7A66', fontWeight: 700 }}>{tx('pos.est_duration')}</span>
        <div style={{ ...input, display: 'flex', alignItems: 'center', color: '#4A4032' }}>{estMinutes ? tx('pos.estminutes_min_2', { estMinutes: String(estMinutes) }) : '—'}</div>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 9, color: '#8A7A66', fontWeight: 700 }}>{tx('pos.appointment_source')}</span>
        <select style={input} value={source} onChange={(e) => setSource(e.target.value)}>
          {SOURCES.map((v) => <option key={v} value={v}>{v === 'in_person' ? tx('ops.checkIn.source.inPerson') : v === 'staff_booking' ? tx('ops.checkIn.source.staffBooking') : statusLabel('source', v)}</option>)}
        </select>
      </label>
    </div>
  );
  const completeBtn = () => (
    <button onClick={complete} disabled={busy} style={{ height: 44, flex: 'none', borderRadius: 10, border: 'none', background: GOLD, color: '#fff', fontWeight: 800, fontSize: 14, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}>
      {busy ? tx('pos.checking_in') : tx('pos.complete_check_in')}
    </button>
  );

  return (
    <section className="qci" data-testid="quick-check-in" style={{  padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0, height: bare ? '100%' : undefined }}>
      {bare ? null : <div style={{ padding: '10px 14px 0' }}><h2 style={{ margin: 0, fontSize: 15 }}>{tx('pos.quick_check_in_panel')}</h2></div>}
      <div role="tablist" style={{ display: 'flex', borderBottom: '1px solid #E7DCC8', margin: bare ? 0 : '6px 0 0', flex: 'none' }}>
        <button role="tab" aria-selected={tab === 'existing'} style={tabBtn(tab === 'existing')} onClick={() => switchTab('existing')}>{tx('pos.existing_customer')}</button>
        <button role="tab" aria-selected={tab === 'new'} style={tabBtn(tab === 'new')} onClick={() => switchTab('new')}>{tx('pos.new_customer')}</button>
        <button role="tab" aria-selected={tab === 'walkin'} style={tabBtn(tab === 'walkin')} onClick={() => switchTab('walkin')}>{tx('pos.walk_in')}</button>
      </div>

      <div className="qci-b" style={{ padding: bare ? '8px 2px 4px' : 14, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto', minHeight: 0, flex: '1 1 auto', overscrollBehavior: 'contain' }}>
        {tab === 'existing' && (
          <>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="tel" inputMode="tel" style={{ ...input, minWidth: 0 }} placeholder={tx('pos.search_by_phone_number_e_g_1oqh')} value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
              <button onClick={search} disabled={searching} style={{ height: 40, padding: '0 16px', flex: 'none', whiteSpace: 'nowrap', borderRadius: 8, border: '1px solid ' + GOLD, background: '#fff', color: GOLD, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>{searching ? '…' : tx('pos.search')}</button>
            </div>
            {results && results.length === 0 ? <div style={{ fontSize: 12, color: '#8A7A66' }}>{tx('pos.no_customer_found_try_the_new_rxen')}</div> : null}
            {results && results.length > 0 && !selected ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {results.slice(0, 5).map((c) => (
                  <button key={c.customerId} onClick={() => setSelected(c)} style={{ textAlign: 'left', border: '1px solid #E7DCC8', borderRadius: 8, background: '#fff', padding: '6px 10px', minHeight: 40, cursor: 'pointer', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    <b style={{ fontSize: 13 }}>{c.fullName}</b> <span style={{ color: '#8A7A66', fontSize: 12 }}>{c.phone || ''}{c.totalVisits != null ? tx('pos.totalvisits_visits', { totalVisits: String(c.totalVisits) }) : ''}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {selected ? (
              <div style={{ border: '1px solid ' + GOLD, borderRadius: 10, padding: 10, background: '#FBF6EC' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ProfileAvatarWithPreview name={selected.fullName} url={(selected as any).avatarUrl} size={34} type="customer" subtitle={selected.phone || undefined} />
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontWeight: 800, fontSize: 13 }}>{selected.fullName}</span>{(guest?.isLoyaltyMember) ? <span style={{ background: '#F3D58C', color: '#7A5512', borderRadius: 5, padding: '1px 6px', fontSize: 9, fontWeight: 800 }}>{statusLabel('priority', 'vip')}</span> : null}</div>
                    <div style={{ fontSize: 11, color: '#6A5C45' }}>{selected.phone || ''}{guest?.email ? ` · ${guest.email}` : ''}</div>
                  </div>
                  <button onClick={() => { setSelected(null); setSvc(new Set()); }} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: GOLD, fontSize: 11, cursor: 'pointer', padding: 0 }}>{tx('pos.change')}</button>
                </div>
                {guest ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginTop: 8 }}>
                      {[[tx('pos.loyalty_points'), guest.loyaltyPoints != null ? fmtNumber(guest.loyaltyPoints) : '—'], [tx('pos.total_visits_2'), guest.totalVisits ?? '—'], [tx('pos.total_spent_2'), guest.totalSpentCents != null ? fmtMoney(guest.totalSpentCents) : '—']].map(([l, v], i) => (
                        <div key={i} style={{ background: '#fff', border: '1px solid #EFE4CF', borderRadius: 8, padding: '5px 7px', textAlign: 'center' }}><div style={{ fontSize: 8.5, color: '#8A7A66', fontWeight: 700 }}>{l}</div><div style={{ fontSize: 12, fontWeight: 800, color: '#4A4032' }}>{v}</div></div>
                      ))}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '2px 10px', marginTop: 7, fontSize: 10 }}>
                      {[[tx('pos.last_visit_3'), guest.lastVisitLabel], [tx('pos.birthday'), guest.birthdayLabel], [tx('pos.preferred_tech'), guest.preferredTech], [tx('ops.customer.favoriteService'), guest.favoriteService]].filter(([, v]) => v).map(([l, v], i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}><span style={{ color: '#8A7A66' }}>{l}</span><span style={{ fontWeight: 700, color: '#4A4032' }}>{v}</span></div>
                      ))}
                    </div>
                    {guest.notes ? <div style={{ fontSize: 10, marginTop: 6 }}><span style={{ color: '#8A7A66', fontWeight: 700 }}>{tx('pos.notes_2')}{' '}</span>{guest.notes}</div> : null}
                    {guest.allergies ? <div style={{ fontSize: 10, marginTop: 3, color: '#B23B3B', fontWeight: 600 }}><span style={{ fontWeight: 800 }}>{tx('pos.allergies_preferences')}{' '}</span>{guest.allergies}</div> : null}
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: '#6A5C45', marginTop: 2 }}>{selected.totalVisits != null ? tx('pos.totalvisits_total_visits', { totalVisits: String(selected.totalVisits) }) : tx('pos.returning_customer')}</div>
                )}
              </div>
            ) : null}
            {selected ? <>{serviceChips()}{assignRow()}{completeBtn()}</> : null}
          </>
        )}

        {tab === 'new' && (
          <>
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={input} aria-label={tx('pos.first_name')} placeholder={tx('pos.first_name')} value={nc.first} onChange={(e) => setNc({ ...nc, first: e.target.value })} />
              <input style={input} aria-label={tx('pos.last_name')} placeholder={tx('pos.last_name')} value={nc.last} onChange={(e) => setNc({ ...nc, last: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="tel" inputMode="tel" style={input} aria-label={tx('pos.phone')} placeholder={tx('pos.phone')} value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} />
              <input type="email" style={input} aria-label={tx('pos.email_optional')} placeholder={tx('pos.email_optional')} value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, fontSize: 12, color: '#4A4032', cursor: 'pointer' }}>
              <input type="checkbox" checked={nc.sms} onChange={(e) => setNc({ ...nc, sms: e.target.checked })} style={{ width: 20, height: 20, accentColor: GOLD }} />{tx('ops.checkIn.smsConsent')}
            </label>
            {serviceChips()}{assignRow()}{completeBtn()}
          </>
        )}

        {tab === 'walkin' && (
          <>
            <input style={input} aria-label={tx('pos.guest_name')} placeholder={tx('pos.guest_name')} value={wi.name} onChange={(e) => setWi({ ...wi, name: e.target.value })} />
            {serviceChips()}{assignRow()}
            <input style={input} aria-label={tx('pos.notes_optional')} placeholder={tx('pos.notes_optional')} value={wi.notes} onChange={(e) => setWi({ ...wi, notes: e.target.value })} />
            {completeBtn()}
          </>
        )}

        {msg ? <div style={{ fontSize: 12, fontWeight: 600, color: msg.kind === 'ok' ? '#2E7D32' : '#B23B3B' }}>{renderMsg(msg.text)}</div> : null}
      </div>
    </section>
  );
}
