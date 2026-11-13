import { useMemo, useState } from 'react';
import type { CreateBlockedTimeInput } from '../adapters/BookingDataAdapter';
import type { ID, ISODate, Technician } from '../domain/scheduleTypes';
import { formatClock, minutesToHHmm, toISO } from '../domain/time';
import { SidePanel } from './primitives';
import { useBoardText } from '../i18n/boardText';

export interface BlockTimeDialogProps {
  tenantId: ID;
  branchId: ID;
  date: ISODate;
  timezone: string;
  technicians: Technician[];
  dayStart: number;
  dayEnd: number;
  initialTechnicianId?: ID;
  initialStartMinute?: number;
  busy: boolean;
  error: string | null;
  onSubmit: (input: Omit<CreateBlockedTimeInput, 'idempotencyKey'>) => void;
  onClose: () => void;
}

const REASONS = ['training', 'supply', 'personal', 'cleaning', 'meeting', 'other'] as const;

/** Block Time (spec §31) — inline panel; never a native prompt. */
export function BlockTimeDialog(p: BlockTimeDialogProps) {
  const { t } = useBoardText();
  const [technicianId, setTechnicianId] = useState(p.initialTechnicianId ?? p.technicians[0]?.id ?? '');
  const [start, setStart] = useState(p.initialStartMinute ?? p.dayStart);
  const [duration, setDuration] = useState(60);
  const [reason, setReason] = useState<(typeof REASONS)[number]>(REASONS[0]);
  const [notes, setNotes] = useState('');
  const options = useMemo(() => { const o: number[] = []; for (let m = p.dayStart; m < p.dayEnd; m += 15) o.push(m); return o; }, [p.dayStart, p.dayEnd]);
  const end = start + duration;
  const valid = technicianId && duration >= 15 && end <= p.dayEnd;
  return (
    <SidePanel title={t('block.title')} onClose={p.onClose} testId="bsb-block-time"
      footer={<>
        <button type="button" className="bsb-btn" onClick={p.onClose}>{t('block.cancel')}</button>
        <button type="button" className="bsb-btn is-primary" disabled={!valid || p.busy} onClick={() => p.onSubmit({
          tenantId: p.tenantId, branchId: p.branchId, technicianId, date: p.date,
          startAt: toISO(p.date, start, p.timezone), endAt: toISO(p.date, end, p.timezone), reason: t(`block.reason.${reason}`), notes: notes || null,
        })}>{p.busy ? t('block.busy') : t('block.submit')}</button>
      </>}
    >
      {p.error && <div className="bsb-error" role="alert">{p.error}</div>}
      <label className="bsb-field">{t('block.technician')}
        <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
          {p.technicians.map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}
        </select>
      </label>
      <div className="bsb-field-row">
        <label className="bsb-field">{t('block.date')}<input type="date" value={p.date} readOnly /></label>
        <label className="bsb-field">{t('block.start')}
          <select value={start} onChange={(e) => setStart(Number(e.target.value))}>
            {options.map((m) => <option key={m} value={m}>{formatClock(m)}</option>)}
          </select>
        </label>
      </div>
      <div className="bsb-field-row">
        <label className="bsb-field">{t('block.duration')}
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {[15, 30, 45, 60, 90, 120, 180, 240].map((d) => <option key={d} value={d}>{t('block.durationOption', { n: d })}</option>)}
          </select>
        </label>
        <label className="bsb-field">{t('block.end')}<input type="time" value={minutesToHHmm(Math.min(end, 1439))} readOnly /></label>
      </div>
      <label className="bsb-field">{t('block.reason')}
        <select value={reason} onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])}>
          {REASONS.map((r) => <option key={r} value={r}>{t(`block.reason.${r}`)}</option>)}
        </select>
      </label>
      <label className="bsb-field">{t('block.notes')}<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('block.optional')} /></label>
      <p className="bsb-muted">{t('block.help')}</p>
    </SidePanel>
  );
}
