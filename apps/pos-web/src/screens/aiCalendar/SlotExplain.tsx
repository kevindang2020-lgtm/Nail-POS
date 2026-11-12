// SlotExplain.tsx — AI Calendar extras #05 Conflict Explanation Drawer. Pick a technician, a start time and a length and
// it lists every reason that time cannot be booked — salon hours, no working hours today, outside her shift, approved
// time off, a blocked time, a live hold or an appointment — from the day view already on screen (Booking's own reads).
// Read-only: nothing is held or booked here; POS Booking stays the place to book and makes the final check.
import { useState } from 'react';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { FitDialog } from '../../components/FitKit';
import { codeLabel } from '../../components/codeLabel';
import { statusLabel } from '../../i18n/status-label';
import { explainSlot, type SlotReason } from './slotExplain';

const LENGTHS = [15, 30, 45, 60, 90, 120];

function reasonText(r: SlotReason): string {
  const span = { start: r.start ?? '—', end: r.end ?? '—' };
  switch (r.code) {
    case 'OUTSIDE_HOURS': return t('aical.why.outsideHours', span);
    case 'OFF_TODAY': return t('aical.why.offToday');
    case 'OUTSIDE_SHIFT': return t('aical.why.outsideShift', { windows: r.reason ?? '—' });
    case 'TIME_OFF': return t('aical.why.timeOff', { ...span, reason: codeLabel('aical.why.reason', r.reason) || '—' });
    case 'BLOCKED': return t('aical.why.blocked', { ...span, reason: codeLabel('aical.why.reason', r.reason) || '—' });
    case 'HOLD': return t(r.pendingCode ? 'aical.why.holdCode' : 'aical.why.hold', span);
    case 'APPOINTMENT': return t('aical.why.appointment', { ...span, status: statusLabel(['appointment', 'booking'], r.status ?? '') });
    default: return '—';
  }
}

type SlotDay = Parameters<typeof explainSlot>[0];
type SlotTech = NonNullable<SlotDay['technicians']>[number] & { name: string };

export function SlotExplain({ day, onClose }: { day: Omit<SlotDay, 'technicians'> & { technicians: SlotTech[] }; onClose: () => void }) {
  const [tech, setTech] = useState<string>(day.technicians[0]?.id ?? '');
  const [start, setStart] = useState<string>(day.hours?.open ?? '09:00');
  const [len, setLen] = useState<number>(45);
  const r = explainSlot(day, tech, start, len);
  return (
    <FitDialog side title={t('aical.why.title')} subtitle={t('aical.why.sub')} onClose={onClose} testId="aic-why"
      footer={<button className="btn" onClick={onClose}>{t('aical.close')}</button>}>
      <div className="aic-row">
        <label>{t('aical.col.technician')}
          <select value={tech} onChange={(e) => setTech(e.target.value)} data-testid="aic-why-tech">
            {day.technicians.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <label>{t('aical.why.start')}<input type="time" value={start} onChange={(e) => setStart(e.target.value)} data-testid="aic-why-start" /></label>
        <label>{t('aical.why.length')}
          <select value={len} onChange={(e) => setLen(Number(e.target.value))} data-testid="aic-why-len">
            {LENGTHS.map((m) => <option key={m} value={m}>{t('aical.why.minutes', { n: m })}</option>)}
          </select>
        </label>
      </div>
      {!r ? <div className="aic-muted" data-testid="aic-why-pick">{t('aical.why.pick')}</div> : r.bookable ? (
        <div className="aic-ok" data-testid="aic-why-free">{t('aical.why.free', { start: r.start, end: r.end })}</div>
      ) : (
        <ul data-testid="aic-why-reasons">{r.reasons.map((x, i) => <li key={i} data-testid="aic-why-reason" data-code={x.code}>{reasonText(x)}</li>)}</ul>
      )}
      <div className="aic-muted">{t('aical.why.note')}</div>
    </FitDialog>
  );
}
