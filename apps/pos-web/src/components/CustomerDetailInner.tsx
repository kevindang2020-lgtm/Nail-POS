// CustomerDetailInner.tsx — the customer full-view content for the shared iPad Pro modal.
// Loads the REAL customer profile (GET /pos/customers/:id) plus appointment history and notes in
// parallel (posCustomersApi.getDetail / appointments / getNotes) — never mock data. Shows profile,
// contact, opt-ins, visit stats, lifetime/average spend, loyalty tier + points, membership, tags,
// recent appointments and notes. Sub-resources fail open (a notes-permission denial just hides notes;
// the server enforces permission + tenant on every read).
import { useCallback, useEffect, useRef, useState } from 'react';
import { posCustomersApi } from '../api/posCustomersApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { customerLanguageName } from './customerLanguage';

const V = (n: string) => `var(--${n})`;

export interface CustomerRow {
  customerId: string; firstName?: string; lastName?: string; displayName: string; phone?: string; email?: string; avatarUrl?: string; isPhoneVerified?: boolean;
  preferredName?: string | null; preferredLanguage?: string | null;   // Decision 1 — profile fields, visible without notes permission
  status?: string; source?: string; visitCount?: number; lastVisitAt?: string | null; nextAppointmentAt?: string | null;
  totalSpendCents?: number; averageSpendCents?: number; loyaltyPoints?: number; loyaltyTier?: string; isVip?: boolean;
  tags?: string[]; marketingOptIn?: boolean; smsOptIn?: boolean; emailOptIn?: boolean;
}
type ApptLite = { appointmentId?: string; id?: string; serviceSummary?: string; services?: { serviceName: string }[]; technicianName?: string; startTime?: string; date?: string; status?: string };

const money = (c?: number | null) => '$' + ((c ?? 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateShort = (iso?: string | null) => { if (!iso) return '—'; const d = new Date(iso.includes('T') ? iso : iso + 'T00:00:00'); return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
const asList = (v: any): any[] => (Array.isArray(v) ? v : Array.isArray(v?.items) ? v.items : Array.isArray(v?.appointments) ? v.appointments : []);


export function CustomerDetailInner({ customerId, initial }: { customerId: string; initial?: CustomerRow }) {
  const [row, setRow] = useState<CustomerRow | null>(initial || null);
  const [appts, setAppts] = useState<ApptLite[]>([]);
  const [notes, setNotes] = useState<any>(null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [d, a, n] = await Promise.allSettled([
      posCustomersApi.getDetail(customerId),
      posCustomersApi.appointments(customerId),
      posCustomersApi.getNotes(customerId),
    ]);
    if (!alive.current) return;
    if (d.status === 'fulfilled') setRow(d.value as CustomerRow);
    else setError((d.reason as any)?.message || tx('pos.could_not_load_this_customer'));
    setAppts(a.status === 'fulfilled' ? asList(a.value).slice(0, 8) : []);
    setNotes(n.status === 'fulfilled' ? n.value : null);
    setLoading(false);
  }, [customerId]);

  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);

  if (loading && !row) return <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: V('muted'), fontSize: 13 }} aria-busy="true">{tx('pos.loading_customer')}</div>;
  if (error && !row) return <div role="alert" style={{ flex: 1, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 40 }}><div><div style={{ fontSize: 24 }}>⚠️</div><div style={{ color: V('danger'), fontWeight: 700, marginTop: 6 }}>{error}</div></div></div>;
  if (!row) return null;

  const stat = (l: string, v: React.ReactNode) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, color: V('muted'), fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' }}>{l}</div>
      <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2, whiteSpace: 'nowrap' }}>{v}</div>
    </div>
  );
  const card: React.CSSProperties = { background: V('card'), border: `1px solid ${V('line')}`, borderRadius: 12, padding: 14 };
  const head: React.CSSProperties = { fontSize: 11, color: V('muted'), fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 18px', display: 'grid', gap: 14, alignContent: 'start' }}>
      {/* contact + membership */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 14 }}>
        <div style={card}>
          <div style={head}>{tx('pos.contact')}</div>
          <div style={{ display: 'grid', gap: 4, fontSize: 13.5 }}>
            <div><b>{tx('pos.phone')}</b> · {row.phone || '—'} {row.isPhoneVerified && <span style={{ color: '#2E9E54', fontWeight: 700, fontSize: 11, marginLeft: 4 }}>✓</span>}</div>
            <div><b>{tx('pos.email')}</b> · {row.email || '—'}</div>
            {row.preferredName ? <div><b>{tx('pos.preferred_name')}</b> · {row.preferredName}</div> : null}
            {row.preferredLanguage ? <div><b>{tx('pos.language')}</b> · {customerLanguageName(row.preferredLanguage)}</div> : null}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              {[['SMS', row.smsOptIn], [tx('pos.email'), row.emailOptIn], [tx('pos.marketing'), row.marketingOptIn]].map(([l, on]) => (
                <span key={String(l)} style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '2px 9px', background: on ? V('ok-bg') : '#F1ECE4', color: on ? V('ok') : V('muted') }}>{l as string} {on ? '✓' : '✕'}</span>
              ))}
            </div>
          </div>
        </div>
        <div style={card}>
          <div style={head}>{tx('pos.membership_loyalty')}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'Playfair Display', serif", color: V('gold') }}>{row.loyaltyTier || tx('pos.standard')}</div>
            {row.isVip && <span style={{ fontSize: 11, fontWeight: 800, color: V('gold') }}>{tx('pos.vip')}</span>}
          </div>
          <div style={{ fontSize: 13, color: V('muted'), marginTop: 4 }}>{(row.loyaltyPoints ?? 0).toLocaleString()} {tx('pos.points')}</div>
        </div>
      </div>

      {/* stats */}
      <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        {stat(tx('pos.visits'), row.visitCount ?? 0)}
        {stat(tx('pos.last_visit_3'), dateShort(row.lastVisitAt))}
        {stat(tx('people.customer.stat.nextAppt'), dateShort(row.nextAppointmentAt))}
        {stat(tx('pos.lifetime'), money(row.totalSpendCents))}
        {stat(tx('pos.avg_ticket'), money(row.averageSpendCents))}
      </div>

      {row.tags && row.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 10.5, color: V('muted'), fontWeight: 700 }}>{tx('pos.tags')}</span>
          {row.tags.map((t) => <span key={t} style={{ fontSize: 10.5, fontWeight: 700, color: V('g7'), background: '#FFF7EA', border: `1px solid ${V('gline')}`, borderRadius: 999, padding: '2px 9px' }}>{t}</span>)}
        </div>
      )}

      {/* recent appointments */}
      <div style={card}>
        <div style={head}>{tx('pos.recent_appointments')}</div>
        {appts.length === 0 ? <div style={{ fontSize: 12.5, color: V('muted') }}>{tx('pos.no_appointment_history')}</div> : appts.map((a, i) => {
          const svc = a.serviceSummary || (a.services || []).map((s) => s.serviceName).join(', ') || tx('glossary.booking.appointment');
          return (
            <div key={a.appointmentId || a.id || i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderBottom: i < appts.length - 1 ? `1px solid #F4EEE1` : 'none', fontSize: 12.5 }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><b>{svc}</b>{a.technicianName ? <span style={{ color: V('muted') }}> · {a.technicianName}</span> : null}</span>
              <span style={{ color: V('muted'), flexShrink: 0 }}>{dateShort(a.startTime || a.date)}</span>
            </div>
          );
        })}
      </div>

      {(notes?.salonNotes || notes?.preferredName || notes?.allergyNotes || notes?.preferredStyle || notes?.preferredNailShapeColor || notes?.favoriteProducts || notes?.appointmentPreferences || notes?.warnings) && (
        <div style={{ ...card, background: V('page') }}>
          <div style={head}>{tx('pos.notes_preferences')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, fontSize: 13, lineHeight: 1.4 }}>
            {notes.salonNotes && <div><b style={{ color: V('muted'), textTransform: 'uppercase', fontSize: 10 }}>{tx('pos.salon_notes')}</b><br/>{notes.salonNotes}</div>}
            {notes.preferredName && !row?.preferredName && <div><b style={{ color: V('muted'), textTransform: 'uppercase', fontSize: 10 }}>{tx('pos.preferred_name_2')}</b><br/>{notes.preferredName}</div>}
            {notes.preferredStyle && <div><b style={{ color: V('muted'), textTransform: 'uppercase', fontSize: 10 }}>{tx('pos.preferred_style')}</b><br/>{notes.preferredStyle}</div>}
            {notes.preferredNailShapeColor && <div><b style={{ color: V('muted'), textTransform: 'uppercase', fontSize: 10 }}>{tx('pos.nail_shape_color')}</b><br/>{notes.preferredNailShapeColor}</div>}
            {notes.favoriteProducts && <div><b style={{ color: V('muted'), textTransform: 'uppercase', fontSize: 10 }}>{tx('pos.favorite_products')}</b><br/>{notes.favoriteProducts}</div>}
            {notes.appointmentPreferences && <div><b style={{ color: V('muted'), textTransform: 'uppercase', fontSize: 10 }}>{tx('pos.appt_prefs')}</b><br/>{notes.appointmentPreferences}</div>}
            {notes.allergyNotes && <div><b style={{ color: V('danger'), textTransform: 'uppercase', fontSize: 10 }}>{tx('pos.allergies')}</b><br/>{notes.allergyNotes}</div>}
            {notes.warnings && <div><b style={{ color: V('danger'), textTransform: 'uppercase', fontSize: 10 }}>{tx('pos.warnings')}</b><br/>{notes.warnings}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
