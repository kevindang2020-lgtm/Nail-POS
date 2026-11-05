// POSAICalendarScreen.tsx — the AI Receptionist Calendar (spec Page 4). This is NOT a second calendar: it reuses the
// exact same /pos/booking/day-grid data the POS Booking screen uses, as a read-focused day view that highlights
// AI-created appointments. All editing/drag-drop stays in POS Booking (the single source of truth) via a deep link,
// so there is no duplicate booking-mutation logic. Champagne Gold via existing tokens.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { posBookingApi } from '../api/posBookingApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from '../i18n/status-label';

const cardBox: React.CSSProperties = { background: '#FFFCF6', border: '1px solid var(--line)', borderRadius: 14, padding: 14 };
const headStyle: React.CSSProperties = { fontWeight: 800, fontSize: 13.5, marginBottom: 10, fontFamily: 'var(--aps-font-head, Playfair Display)' };
const GOLD = '#A96F22';
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#6C6965', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' };
const navBtn: React.CSSProperties = { height: 30, padding: '0 10px', borderRadius: 8, border: '1px solid var(--line)', background: '#FFFCF6', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' };
const isAi = (s?: string) => (s || '').toLowerCase().includes('ai') || (s || '').toLowerCase() === 'voice' || (s || '').toLowerCase() === 'receptionist';
const shiftDate = (d: string, days: number) => { const dt = new Date(d + 'T00:00:00'); dt.setDate(dt.getDate() + days); return dt.toISOString().slice(0, 10); };
const todayStr = () => new Date().toISOString().slice(0, 10);

export function POSAICalendarScreen() {
  const nav = useNavigate();
  const [date, setDate] = useState(todayStr());
  const [grid, setGrid] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGrid(null); setError(null);
    posBookingApi.dayGrid(date).then(setGrid).catch((e: any) => setError(e?.message || t('pos.failed_to_load_the_calendar')));
  }, [date]);

  const appts: any[] = grid?.appointments ?? [];
  const aiCount = appts.filter((a) => isAi(a.source)).length;
  const columns: any[] = grid?.columns ?? [];

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="vh flex flex-col sm:flex-row gap-3 justify-between">
        <div>
        <div>
          <h1>{t('pos.calendar')}</h1>
        <div className="sub mb-3">{t('pos.the_same_appointments_as_pos_booking_1ig2')}</div>
        </div></div>
        <button className="btn w-fit whitespace-nowrap"  onClick={() => nav('/booking')}>{t('pos.open_in_pos_booking')}</button>
      </div>

      <section style={cardBox}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn w-fit whitespace-nowrap"  onClick={() => setDate(shiftDate(date, -1))}>{t('pos.u2039_prev')}</button>
          <button className="btn w-fit whitespace-nowrap"  onClick={() => setDate(todayStr())}>{t('pos.today_2')}</button>
          <button className="btn w-fit whitespace-nowrap"  onClick={() => setDate(shiftDate(date, 1))}>{t('pos.next_u203a')}</button>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value || todayStr())} style={{ ...navBtn, height: 30 }} />
          <span style={{ fontSize: 12, color: '#8A7A66' }}>{grid ? `${grid.openTime}\u2013${grid.closeTime}` : ''}</span>
        </div>
      </section>

      {error ? <div className="err">{error} <button style={{ ...linkBtn, color: GOLD }} onClick={() => setDate(date)}>{t('pos.retry')}</button></div>
        : grid === null ? <div className="state">{t('pos.loading_calendar_u2026')}</div>
        : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3" style={{gap: 10 }}>
              {[
                { l: t('pos.appointments'), v: String(appts.length) },
                { l: t('pos.ai_created'), v: String(aiCount) },
                { l: t('pos.open_slots'), v: String(grid.totalOpenSlots ?? '\u2014') },
                { l: t('pos.technicians_on'), v: String(columns.filter((c) => c.available).length) },
              ].map((m) => (
                <div key={m.l} style={{ ...cardBox, padding: 12 }}><div style={{ fontSize: 11, color: '#8A7A66' }}>{m.l}</div><div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--aps-font-head, Playfair Display)' }}>{m.v}</div></div>
              ))}
            </div>

            <section style={cardBox}>
              <div style={headStyle}>{t('pos.appointments_u2014')}{' '}{date}</div>
              {appts.length === 0 ? (
                <div style={{ fontSize: 12.5, color: '#9B8B78' }}>{t('pos.no_appointments_on_this_day')}</div>
              ) : (
                <div className="overflow-x-auto w-full"><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }} className="w-full min-w-max">
                  <thead><tr style={{ textAlign: 'left', color: '#8A7A66' }}><th style={{ padding: '6px 8px' }}>{t('pos.time')}</th><th style={{ padding: '6px 8px' }}>{t('pos.customer')}</th><th style={{ padding: '6px 8px' }}>{t('pos.service_3')}</th><th style={{ padding: '6px 8px' }}>{t('pos.status')}</th><th style={{ padding: '6px 8px' }}>{t('pos.source')}</th></tr></thead>
                  <tbody>
                    {appts.slice().sort((a, b) => String(a.startTime).localeCompare(String(b.startTime))).map((a) => (
                      <tr key={a.appointmentId} style={{ borderTop: '1px solid var(--line)', background: isAi(a.source) ? '#FBF3E4' : 'transparent' }}>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{a.startTime}\u2013{a.endTime}</td>
                        <td style={{ padding: '6px 8px' }}>{a.customerName || '\u2014'}{a.isVip ? ' \u2605' : ''}</td>
                        <td style={{ padding: '6px 8px' }}>{(a.services ?? []).map((s: any) => s.serviceName).join(', ') || '\u2014'}</td>
                        <td style={{ padding: '6px 8px', textTransform: 'capitalize' }}>{statusLabel('appointment', a.status)}</td>
                        <td style={{ padding: '6px 8px' }}>{isAi(a.source) ? <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: '#F0D4AB', color: '#7A5518' }}>AI</span> : <span style={{ color: '#9B8B78', textTransform: 'capitalize' }}>{a.source || 'manual'}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
              <div style={{ fontSize: 11.5, color: '#9B8B78', marginTop: 10 }}>{t('pos.to_create_move_or_edit_appointments_ub6m')}{' '}<button style={{ ...linkBtn, color: GOLD }} onClick={() => nav('/booking')}>{t('pos.pos_booking')}</button> {t('pos.u2014_it_u2019s_the_single_source_amkr')}</div>
            </section>
          </>
        )}
    </div>
  );
}
