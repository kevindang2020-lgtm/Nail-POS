import { useCallback, useEffect, useMemo, useState } from 'react';
import { techApi, type TechScheduleItem, type TechWorkingHoursDay } from '../api/techApi';
import { clock, statusLabel, statusKind, initials, longDate } from '../lib/tech';
import { techAiScheduleApi, type SchedTechChange } from '../api/techAiScheduleApi';
import { fmtTime } from '@aipowersalon/mobile-sdk';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

// BUILD_PLAN Phase 7 (ai_scheduling_optimizer): what the optimizer proposed or changed for me on this day. Proposed =
// still waiting on a manager / the customer (nothing has moved); applied = the booking really changed. Rolled back,
// rejected, expired and superseded suggestions are not shown.
const HIDDEN = new Set(['rolled_back', 'rejected', 'expired', 'superseded', 'needs_revision']);
const hm = (t?: string | null) => { const m = t ? /^(\d{1,2}):(\d{2})/.exec(t) : null; if (!m) return '—'; const h = Number(m[1]); return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`; };
const badgeText = (c: SchedTechChange) => (c.status === 'applied' ? `Moved to ${hm(c.to?.startTime)}` : `Proposed: ${hm(c.to?.startTime)}`);
function changeLine(c: SchedTechChange): string {
  const who = c.customerFirstName || 'A guest';
  const proposed = c.status !== 'applied';
  if (c.movesToMe) return proposed ? `${who} may move to you at ${hm(c.to?.startTime)} (proposed)` : `${who} moved to you at ${hm(c.to?.startTime)}`;
  if (c.movesAwayFromMe) return proposed ? `${who} may move to another technician (proposed)` : `${who} moved to another technician`;
  return proposed ? `${who}: proposed move to ${hm(c.to?.startTime)}` : `${who} moved to ${hm(c.to?.startTime)}`;
}

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
  const [changes, setChanges] = useState<SchedTechChange[]>([]);

  const todayKey = new Date().toDateString();
  const isToday = selected.toDateString() === todayKey;

  const load = useCallback((d: Date) => {
    setItems(null);
    techApi.schedule(ymd(d)).then((r) => { setItems(r); setError(null); }).catch((e: any) => setError(e?.message || 'Failed to load your schedule.'));
  }, []);
  useEffect(() => { load(selected); }, [selected, load]);
  useEffect(() => {
    let live = true;
    techAiScheduleApi.changes(ymd(selected)).then((c) => { if (live) setChanges(c.filter((x) => !HIDDEN.has(x.status))); }).catch(() => { if (live) setChanges([]); });
    return () => { live = false; };
  }, [selected]);
  const changeByAppt = useMemo(() => { const m = new Map<string, SchedTechChange>(); for (const c of changes) if (c.appointmentId && !m.has(c.appointmentId)) m.set(c.appointmentId, c); return m; }, [changes]);
  const offList = useMemo(() => changes.filter((c) => !c.appointmentId || !(items || []).some((i) => i.appointmentId === c.appointmentId)), [changes, items]);

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
  const fmt = (d: Date) => fmtTime(d);

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
      {offList.length > 0 ? (
        <div className="tech-card" data-testid="ai-changes" style={{ marginBottom: 12, padding: 12, fontSize: 13, display: 'grid', gap: 4 }}>
          <div style={{ fontWeight: 700 }}>Schedule changes</div>
          {offList.map((c) => <div key={c.recommendationId} data-testid={`ai-change-row-${c.recommendationId}`}>{changeLine(c)}</div>)}
        </div>
      ) : null}

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
          : visible.length === 0 && !showLunch ? <div className="tech-card tech-state" style={{ boxShadow: 'none' }}>No appointments scheduled for {isToday ? 'today' : longDate(selected)}.</div>
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
                        {changeByAppt.get(i.appointmentId) ? (
                          <span className="tech-chip" data-testid={`ai-change-${i.appointmentId}`} title={changeLine(changeByAppt.get(i.appointmentId)!)}
                            style={{ background: changeByAppt.get(i.appointmentId)!.status === 'applied' ? 'var(--tech-primary-light)' : '#FBEEDD', color: changeByAppt.get(i.appointmentId)!.status === 'applied' ? 'var(--tech-primary-dark)' : '#9B6B1E', padding: '1px 7px' }}>
                            {badgeText(changeByAppt.get(i.appointmentId)!)}
                          </span>
                        ) : null}
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
