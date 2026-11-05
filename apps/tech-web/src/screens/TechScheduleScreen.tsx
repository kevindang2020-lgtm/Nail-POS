import { useCallback, useEffect, useMemo, useState } from 'react';
import { techApi, type TechScheduleItem, type TechWorkingHoursDay } from '../api/techApi';
import { clock, statusLabel, statusKind, initials, longDate } from '../lib/tech';

// Module 2 — Schedule / Appointments (1:1 with the reference). The signed-in technician's appointments for the SELECTED
// day (GET /tech/schedule?date=). The week strip is fully navigable — tapping any day loads that day's real schedule.
// Each row shows the appointment duration; the lunch block comes from the technician's real working-hours row (today only).
const Cal = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>);
const Filter = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h18M6 12h12M10 19h4" /></svg>);
const FILTERS = ['All', 'Upcoming', 'In Service', 'Completed'] as const;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function TechScheduleScreen() {
  const [items, setItems] = useState<TechScheduleItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<typeof FILTERS[number]>('All');
  const [lunch, setLunch] = useState<{ start: Date; end: Date } | null>(null);
  const [selected, setSelected] = useState<Date>(() => new Date());

  const todayKey = new Date().toDateString();
  const isToday = selected.toDateString() === todayKey;

  const load = useCallback((d: Date) => {
    setItems(null);
    techApi.schedule(ymd(d)).then((r) => { setItems(r); setError(null); }).catch((e: any) => setError(e?.message || 'Failed to load your schedule.'));
  }, []);
  useEffect(() => { load(selected); }, [selected, load]);

  useEffect(() => {
    // lunch window from the technician's real working-hours row (today only; absent → no banner)
    techApi.workingHours().then((days: TechWorkingHoursDay[]) => {
      const today = days.find((dd) => dd.dayOfWeek === new Date().getDay());
      if (today?.isWorking && today.lunchStartTime && today.lunchEndTime) {
        const at = (t: string) => { const [h, m] = t.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d; };
        setLunch({ start: at(today.lunchStartTime), end: at(today.lunchEndTime) });
      } else setLunch(null);
    }).catch(() => setLunch(null));
  }, []);

  const week = useMemo(() => {
    const now = new Date(); const dow = (now.getDay() + 6) % 7; // Mon=0
    const mon = new Date(now); mon.setDate(now.getDate() - dow);
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d; });
  }, []);

  const visible = useMemo(() => {
    if (!items) return [];
    return items.filter((i) => {
      const v = (i.status || '').toLowerCase();
      if (filter === 'All') return true;
      if (filter === 'Upcoming') return !['completed', 'cancelled', 'no_show', 'in_service', 'serving'].includes(v);
      if (filter === 'In Service') return v === 'in_service' || v === 'serving';
      return v === 'completed';
    });
  }, [items, filter]);

  const showLunch = lunch && isToday && filter === 'All';
  const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  return (
    <div>
      <div className="tech-tab-header" style={{ marginBottom: 32 }}>
        <div className="tech-tab-header__inner">
          <div className="t-title">My Schedule</div>
          <button className="tech-iconbtn" style={{ marginLeft: 'auto' }} aria-label="Refresh" onClick={() => load(selected)}><Cal /></button>
          <button className="tech-iconbtn" aria-label="Filter" onClick={() => setFilter((f) => FILTERS[(FILTERS.indexOf(f) + 1) % FILTERS.length])}><Filter /></button>
        </div>
      </div>
<div className="tech-main-2">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="tech-section-title">{isToday ? 'Today' : longDate(selected)}</div>
        <span className="tech-chip neutral">{filter}</span>
      </div>

      <div className="tech-week" style={{ marginBottom: 14 }}>
        {week.map((d) => {
          const isSel = d.toDateString() === selected.toDateString();
          return (
            <button key={d.toISOString()} className={isSel ? 'sel' : ''} aria-current={isSel ? 'date' : undefined} onClick={() => { setNote(null); setSelected(new Date(d)); }}>
              <span className="wd">{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
              <span className="dd">{d.getDate()}</span>
            </button>
          );
        })}
      </div>

      {note ? <div className="tech-card" style={{ marginBottom: 12, padding: 12, fontSize: 13 }} role="status">{note}</div> : null}

      {error ? <div className="tech-state" role="alert" style={{ color: 'var(--tech-danger)' }}>{error}</div>
        : !items ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="tech-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14 }}>
                <div className="tech-skel" style={{ width: 60, height: 16 }} />
                <div className="tech-skel" style={{ width: 38, height: 38, borderRadius: '50%' }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="tech-skel" style={{ width: '40%', height: 16 }} />
                  <div className="tech-skel" style={{ width: '60%', height: 14 }} />
                </div>
                <div className="tech-skel" style={{ width: 60, height: 24, borderRadius: 12 }} />
              </div>
            ))}
          </div>
        )
          : visible.length === 0 && !showLunch ? (
            <div
              className="tech-card tech-state"
              style={{
                minHeight: 240,
                padding: '36px 16px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                boxShadow: 'none',
              }}
            >
              <div
                aria-hidden
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #FBF3E4 0%, #EFE1C9 100%)',
                  border: '1px solid #DBCAB0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 28,
                  marginBottom: 12,
                }}
              >
                📅
              </div>
              <div style={{ fontSize: 14, color: 'var(--tech-text-muted, #7A6F62)', maxWidth: 280, lineHeight: 1.45 }}>
                No appointments scheduled for {isToday ? 'today' : longDate(selected)}.
              </div>
            </div>
          )
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {visible.map((i, idx) => {
                  const lunchBefore = showLunch && new Date(i.startTime).getTime() >= lunch!.start.getTime()
                    && (idx === 0 || new Date(visible[idx - 1].startTime).getTime() < lunch!.start.getTime());
                  return (
                    <div key={i.appointmentId} style={{ display: 'contents' }}>
                      {lunchBefore ? (
                        <div className="tech-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, background: 'linear-gradient(180deg, #F7E8C8, #F1DCAE)', border: '1px solid var(--tech-gold-soft)' }}>
                          <div style={{ width: 60, fontWeight: 700, fontSize: 13, color: 'var(--tech-primary-dark)' }}>{fmt(lunch!.start)}</div>
                          <div style={{ flex: 1, fontWeight: 700, color: 'var(--tech-primary-dark)' }}>Lunch Break <span className="tech-muted" style={{ fontWeight: 600 }}>· until {fmt(lunch!.end)}</span></div>
                          <span className="tech-chip neutral">Break</span>
                        </div>
                      ) : null}
                      <div className="tech-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14 }}>
                        <div style={{ width: 60, fontWeight: 700, fontSize: 13 }}>{clock(i.startTime) || '—'}</div>
                        <div className="tech-avatar" style={{ width: 38, height: 38 }}>{i.customerInitials || initials(i.customerName)}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                            {i.customerName || 'Guest'}
                            {i.vip ? <span className="tech-chip" style={{ background: 'var(--tech-primary-light)', color: 'var(--tech-primary-dark)', padding: '1px 7px' }}>VIP</span> : null}
                          </div>
                          <div className="tech-label">{i.serviceName || '—'}{i.durationMinutes ? ` · ${i.durationMinutes} min` : ''}</div>
                        </div>
                        {i.inspirationPhotoUrl ? <img src={i.inspirationPhotoUrl} alt="Booked inspiration look" title="Customer booked this look" style={{ width: 38, height: 38, borderRadius: 8, objectFit: 'cover', flex: 'none', border: '1px solid var(--tech-gold-soft)' }} /> : null}
                        <span className={'tech-chip ' + statusKind(i.status)}>{statusLabel(i.status)}</span>
                      </div>
                    </div>
                  );
                })}
                {showLunch && (visible.length === 0 || new Date(visible[visible.length - 1].startTime).getTime() < lunch!.start.getTime()) ? (
                  <div className="tech-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, background: 'linear-gradient(180deg, #F7E8C8, #F1DCAE)', border: '1px solid var(--tech-gold-soft)' }}>
                    <div style={{ width: 60, fontWeight: 700, fontSize: 13, color: 'var(--tech-primary-dark)' }}>{fmt(lunch!.start)}</div>
                    <div style={{ flex: 1, fontWeight: 700, color: 'var(--tech-primary-dark)' }}>Lunch Break <span className="tech-muted" style={{ fontWeight: 600 }}>· until {fmt(lunch!.end)}</span></div>
                    <span className="tech-chip neutral">Break</span>
                  </div>
                ) : null}
                <button className="tech-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, cursor: 'pointer', border: '1px dashed var(--tech-border)' }}
                  onClick={() => setNote('To add a walk-in or block time, contact the front desk.')}>
                  <div style={{ width: 60, fontWeight: 700, fontSize: 13 }} className="tech-muted">Open</div>
                  <div style={{ flex: 1, fontWeight: 600 }} className="tech-muted">Open Slot</div>
                  <span style={{ fontSize: 20, color: 'var(--tech-primary)' }}>＋</span>
                </button>
              </div>
            )}
    </div>
    </div>
  );
}
