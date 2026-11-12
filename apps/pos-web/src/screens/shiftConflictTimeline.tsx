// shiftConflictTimeline.tsx — extras (Finish the Five Unfinished Features 10): Booking Conflict Timeline for the Edit Shift
// for Selected Date overlay. One time axis with three lanes — the shift(s), the breaks, the bookings — where every block
// carries BOTH a colour and its words (what it is, its times, and for a booking the conflict the SERVER reported for it).
// Nothing here decides a conflict: overlaps come only from the server preview (preview.conflicts, matched by appointment
// id); before the manager presses View conflicts the bookings say "not checked yet", never "OK". Read-only, writes nothing.
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { hm12, apptStatus } from './teamShared';

interface TlDay { isWorking?: boolean | null; startTime?: string | null; endTime?: string | null; lunchStartTime?: string | null; lunchEndTime?: string | null;
  shifts?: { startTime: string; endTime: string }[] | null; breaks?: { startTime: string; endTime: string; type?: string | null }[] | null }
interface TlBooking { id: string; date: string; startTime: string; endTime: string; status: string; customer?: string | null }
interface TlConflict { kind: string; appointmentId?: string | null }
export interface TlBlock { lane: 'shift' | 'break' | 'booking'; tone: 'shift' | 'break' | 'ok' | 'conflict' | 'unchecked'; start: number; end: number; label: string; note: string }

const mins = (t: string | null | undefined) => {
  const m = /^(\d{2}):(\d{2})/.exec(String(t ?? '')); if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
};
const endTxt = (t: string) => (t === '24:00' ? tx('so.midnight') : hm12(t));

/** the blocks of one day — shift / break windows from the day schedule, bookings on the edited date with the server's verdict */
export function timelineBlocks(day: TlDay | null | undefined, bookings: TlBooking[], date: string, conflicts: TlConflict[] | null): TlBlock[] {
  const out: TlBlock[] = [];
  if (day && day.isWorking !== false) {
    const shifts = day.shifts?.length ? day.shifts : day.startTime && day.endTime ? [{ startTime: day.startTime, endTime: day.endTime }] : [];
    for (const s of shifts) {
      const a = mins(s.startTime), b = mins(s.endTime);
      if (Number.isFinite(a) && Number.isFinite(b) && b > a) out.push({ lane: 'shift', tone: 'shift', start: a, end: b, label: tx('so.tl.shift'), note: `${hm12(s.startTime)} – ${endTxt(s.endTime)}` });
    }
    const brks = day.breaks?.length ? day.breaks : day.lunchStartTime && day.lunchEndTime ? [{ startTime: day.lunchStartTime, endTime: day.lunchEndTime, type: 'lunch' }] : [];
    for (const k of brks) {
      const a = mins(k.startTime), b = mins(k.endTime);
      if (Number.isFinite(a) && Number.isFinite(b) && b > a) out.push({ lane: 'break', tone: 'break', start: a, end: b, label: tx('so.b.' + (k.type ?? 'unpaid')), note: `${hm12(k.startTime)} – ${endTxt(k.endTime)}` });
    }
  }
  for (const bk of bookings) {
    if (bk.date !== date) continue;
    const a = mins(bk.startTime); let b = mins(bk.endTime);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (b <= a) b = 1440;   // runs past midnight: drawn to the end of this day
    const kinds = conflicts ? [...new Set(conflicts.filter((c) => c.appointmentId === bk.id).map((c) => c.kind))] : null;
    const verdict = kinds == null ? tx('so.tl.unchecked') : kinds.length ? kinds.map((k) => tx('so.c.' + k)).join(' · ') : tx('so.tl.noConflict');
    out.push({ lane: 'booking', tone: kinds == null ? 'unchecked' : kinds.length ? 'conflict' : 'ok', start: a, end: b,
      label: `${tx('so.tl.booking')} · ${bk.customer ?? '—'}`, note: `${hm12(bk.startTime)} – ${endTxt(bk.endTime)} · ${apptStatus(bk.status)} — ${verdict}` });
  }
  return out;
}

export function ShiftConflictTimeline({ day, bookings, date, conflicts }: { day: TlDay | null | undefined; bookings: TlBooking[]; date: string; conflicts: TlConflict[] | null }) {
  const blocks = timelineBlocks(day, bookings, date, conflicts);
  if (!blocks.length) return <p className="fk-hint" data-testid="so-tl-empty">{tx('so.tl.empty')}</p>;
  const lo = Math.max(0, Math.floor(Math.min(...blocks.map((b) => b.start)) / 60) * 60);
  const hi = Math.min(1440, Math.ceil(Math.max(...blocks.map((b) => b.end)) / 60) * 60);
  const span = Math.max(60, hi - lo);
  const pct = (m: number) => `${(((Math.min(Math.max(m, lo), hi) - lo) / span) * 100).toFixed(2)}%`;
  const hours: number[] = []; for (let h = lo; h <= hi; h += 60) hours.push(h);
  const lanes: TlBlock['lane'][] = ['shift', 'break', 'booking'];
  return (
    <div className="so-tl" data-testid="so-timeline">
      <h3 className="fk-h3">{tx('so.tl.title')}</h3>
      <p className="fk-hint">{conflicts ? tx('so.tl.fromCheck') : tx('so.tl.checkFirst')}</p>
      <div className="so-tl-axis" aria-hidden="true">{hours.map((h) => <span key={h} style={{ left: pct(h) }}>{hm12(`${String(Math.floor(h / 60) % 24).padStart(2, '0')}:00`)}</span>)}</div>
      {lanes.map((ln) => (
        <div key={ln} className="so-tl-lane">
          <span className="so-tl-name">{tx('so.tl.lane.' + ln)}</span>
          <div className="so-tl-track">
            {blocks.filter((b) => b.lane === ln).map((b, i) => (
              <span key={i} className={'so-tl-b ' + b.tone} style={{ left: pct(b.start), width: `calc(${pct(b.end)} - ${pct(b.start)})` }} title={`${b.label} ${b.note}`} data-testid={'so-tl-' + b.tone}>
                {b.label}
              </span>))}
          </div>
        </div>))}
      <ul className="so-tl-list">
        {blocks.map((b, i) => <li key={i} data-testid="so-tl-row"><span className={'so-tl-dot ' + b.tone} aria-hidden="true" /><b>{b.label}</b> {b.note}</li>)}
      </ul>
    </div>
  );
}
