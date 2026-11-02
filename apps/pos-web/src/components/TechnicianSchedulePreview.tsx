// TechnicianSchedulePreview.tsx — ONE technician's complete day for the shared iPad Pro full view.
// Exports: `TechnicianScheduleInner` (the schedule content only — plugs into IPadViewProvider),
// `technicianScheduleMeta` (header props for the shell), and `TechnicianSchedulePreview`
// (the full modal = shell + inner, kept for existing direct callers). Uses the SAME real records as
// the Live Technician Schedule board / Booking day-grid. No fabricated data.
import { useMemo } from 'react';
import { IPadProFullViewModal, type IPadViewStatus } from './IPadProFullViewModal';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { fmtMoney, fmtYmd } from '../i18n/format';
import { clockOfHHMM } from '../screens/opsClock';

import { statusLabel } from '../i18n/status-label';
const V = (n: string) => `var(--${n})`;

type Appt = { appointmentId: string; customerName: string; customerInitials?: string; serviceSummary: string; startTime: string; endTime: string; status: string; source?: string; ticketId?: string };
type OpenSlot = { slotId: string; startTime: string; endTime: string; durationMinutes: number; reason?: string };
type Block = { blockId: string; startTime: string; endTime: string; reason?: string; note?: string };
export interface TechScheduleData {
  technicianId: string; fullName: string; initials: string; roleLabel: string; status: string;
  shift?: { startTime: string; endTime: string; breakStartTime?: string; breakEndTime?: string };
  skills?: string[]; appointments: Appt[]; openSlots: OpenSlot[]; blocks?: Block[];
  activeTicket?: { ticketId: string; serviceSummary: string; customerName: string };
  bookedHours: number; utilizationPercent: number;
  phone?: string; nextAppointment?: Appt; salesTodayCents?: number; tipsTodayCents?: number;
}

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  available: { get label() { return t('pos.available'); }, bg: V('ok-bg'), fg: V('ok') },
  assigned: { get label() { return t('pos.assigned'); }, bg: V('warn-bg'), fg: V('warn') },
  checked_in_waiting: { get label() { return t('pos.waiting_2'); }, bg: V('warn-bg'), fg: V('warn') },
  in_service: { get label() { return t('pos.in_service_3'); }, bg: '#EEF6FF', fg: V('info') },
  service_done: { get label() { return t('pos.service_done'); }, bg: V('ok-bg'), fg: V('ok') },
  on_break: { get label() { return t('pos.on_break_2'); }, bg: '#F4EDFF', fg: '#8E6AD8' },
  lunch: { get label() { return t('pos.lunch'); }, bg: '#F4EDFF', fg: '#8E6AD8' },
  off_shift: { get label() { return t('pos.off_shift_2'); }, bg: '#F1ECE4', fg: V('muted') },
  blocked: { get label() { return t('pos.blocked_2'); }, bg: '#FFF0ED', fg: V('danger') },
  offline: { get label() { return t('pos.offline_4'); }, bg: '#F1ECE4', fg: V('muted') },
  confirmed: { get label() { return t('pos.confirmed'); }, bg: V('ok-bg'), fg: V('ok') },
  arriving_soon: { get label() { return t('pos.arriving_soon'); }, bg: '#EEF6FF', fg: V('info') },
  waiting: { get label() { return t('pos.waiting_2'); }, bg: V('warn-bg'), fg: V('warn') },
};
const statusOf = (k: string) => STATUS[k] || STATUS.offline;

const to12 = (hhmm: string) => clockOfHHMM(hhmm);   // the user's clock ("2:30 PM" / "14:30")
const money = (c?: number) => fmtMoney(c || 0);
const mins = (hhmm: string) => { const [h, m] = (hhmm || '').split(':').map((x) => parseInt(x, 10)); return Number.isNaN(h) ? 0 : h * 60 + m; };
const dateLabel = (iso: string) => fmtYmd(iso, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }, iso);

type Row =
  | { kind: 'appt'; start: string; a: Appt }
  | { kind: 'open'; start: string; o: OpenSlot }
  | { kind: 'block'; start: string; b: Block };

const LEGEND: { k: string; label: string }[] = [
  { k: 'confirmed', get label() { return t('pos.confirmed'); } }, { k: 'arriving_soon', get label() { return t('pos.arriving_soon'); } },
  { k: 'in_service', get label() { return t('pos.in_service_3'); } }, { k: 'waiting', get label() { return t('pos.waiting_2'); } }, { k: 'available', get label() { return t('pos.available'); } },
];

/** Header props for the iPad shell for a given technician + date (reused by direct + provider paths). */
export function technicianScheduleMeta(tech: TechScheduleData, date: string): {
  initials: string; title: string; subtitle: string; status: IPadViewStatus; ariaLabel: string; footer: JSX.Element;
} {
  const st = statusOf(tech.status);
  return {
    initials: tech.initials,
    title: tech.fullName,
    subtitle: `${tech.roleLabel}${tech.phone ? ` · ${tech.phone}` : ''} · ${dateLabel(date)}`,
    status: { label: st.label, bg: st.bg, fg: st.fg },
    ariaLabel: `${tech.fullName} schedule`,
    footer: (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 11 }}>
        {LEGEND.map((l) => { const c = statusOf(l.k); return (
          <span key={l.k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: V('muted'), fontWeight: 600 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: c.fg, display: 'inline-block' }} />{l.label}
          </span>
        ); })}
      </div>
    ),
  };
}

/** The schedule content only (no iPad frame) — stat strip (fixed) + services + chronological timeline (scrolls). */
export function TechnicianScheduleInner({ tech, onBookSlot }: { tech: TechScheduleData; onBookSlot?: (slot: OpenSlot) => void }) {
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    (tech.appointments || []).forEach((a) => out.push({ kind: 'appt', start: a.startTime, a }));
    (tech.openSlots || []).forEach((o) => out.push({ kind: 'open', start: o.startTime, o }));
    (tech.blocks || []).forEach((b) => out.push({ kind: 'block', start: b.startTime, b }));
    if (tech.shift?.breakStartTime) out.push({ kind: 'block', start: tech.shift.breakStartTime, b: { blockId: 'lunch', startTime: tech.shift.breakStartTime, endTime: tech.shift.breakEndTime || tech.shift.breakStartTime, reason: t('ops.schedule.lunchBreak') } });
    return out.sort((x, y) => mins(x.start) - mins(y.start));
  }, [tech]);
  const shiftLabel = tech.shift ? `${to12(tech.shift.startTime)} – ${to12(tech.shift.endTime)}` : t('pos.off_shift_3');

  return (
    <>
      <div style={{ flexShrink: 0, display: 'flex', gap: 0, borderBottom: `1px solid ${V('line')}`, background: V('card') }}>
        {[
          { l: t('pos.working_hours'), v: shiftLabel },
          { l: t('pos.utilization'), v: `${tech.utilizationPercent}%` },
          { l: t('pos.booked'), v: `${tech.bookedHours}h` },
          ...(tech.salesTodayCents != null ? [{ l: t('pos.sales_today'), v: money(tech.salesTodayCents) }] : []),
          ...(tech.tipsTodayCents != null ? [{ l: t('pos.tips_today'), v: money(tech.tipsTodayCents) }] : []),
        ].map((c, i) => (
          <div key={i} style={{ flex: 1, padding: '9px 14px', borderLeft: i ? `1px solid ${V('line')}` : 'none', minWidth: 0 }}>
            <div style={{ fontSize: 10, color: V('muted'), fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.l}</div>
            <div style={{ fontSize: 14, fontWeight: 800, whiteSpace: 'nowrap' }}>{c.v}</div>
          </div>
        ))}
      </div>

      {(tech.skills && tech.skills.length > 0) && (
        <div style={{ flexShrink: 0, padding: '8px 18px', display: 'flex', flexWrap: 'wrap', gap: 6, borderBottom: `1px solid ${V('line')}`, background: V('page') }}>
          <span style={{ fontSize: 10.5, color: V('muted'), fontWeight: 700, alignSelf: 'center' }}>{t('pos.services_2')}</span>
          {tech.skills.map((sk) => <span key={sk} style={{ fontSize: 10.5, fontWeight: 700, color: V('g7'), background: '#FFF7EA', border: `1px solid ${V('gline')}`, borderRadius: 999, padding: '2px 9px' }}>{sk}</span>)}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 18px', display: 'grid', gap: 9, alignContent: 'start' }}>
        {rows.length === 0 && (
          <div style={{ textAlign: 'center', color: V('muted'), fontSize: 13, padding: '40px 0' }}>{t('pos.no_appointments_open_slots_or_breaks_xdux')}</div>
        )}
        {rows.map((r, i) => {
          if (r.kind === 'appt') {
            const a = r.a; const c = statusOf(a.status);
            return (
              <div key={'a' + i} style={{ display: 'flex', gap: 12, alignItems: 'stretch', background: V('card'), border: `1px solid ${V('line')}`, borderLeft: `4px solid ${c.fg}`, borderRadius: 12, padding: '10px 13px' }}>
                <div style={{ width: 92, flexShrink: 0, fontSize: 12.5, fontWeight: 800 }}>{to12(a.startTime)}<div style={{ fontSize: 10.5, color: V('muted'), fontWeight: 600 }}>{to12(a.endTime)}</div></div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.customerName}</div>
                  <div style={{ fontSize: 12, color: V('soft'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.serviceSummary}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                  <span style={{ background: c.bg, color: c.fg, fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}>{c.label}</span>
                  {a.source && <span style={{ fontSize: 10, color: V('muted') }}>{statusLabel('source', a.source)}</span>}
                </div>
              </div>
            );
          }
          if (r.kind === 'open') {
            const o = r.o;
            const inner = (
              <>
                <div style={{ width: 92, flexShrink: 0, fontSize: 12.5, fontWeight: 800, color: V('g7') }}>{to12(o.startTime)}<div style={{ fontSize: 10.5, color: V('muted'), fontWeight: 600 }}>{to12(o.endTime)}</div></div>
                <div style={{ minWidth: 0, flex: 1, fontSize: 12.5, fontWeight: 700, color: V('g7') }}>{t('pos.available')}{o.reason ? ` · ${statusLabel('scheduleBlock', o.reason)}` : ''}<div style={{ fontSize: 11, color: V('muted'), fontWeight: 600 }}>{o.durationMinutes} {t('pos.min_open')}</div></div>
                <span style={{ fontSize: 11, fontWeight: 800, color: V('g7'), flexShrink: 0 }}>{onBookSlot ? t('pos.book_2') : t('pos.open')}</span>
              </>
            );
            return onBookSlot ? (
              <button key={'o' + i} onClick={() => onBookSlot(o)} style={{ display: 'flex', gap: 12, alignItems: 'center', textAlign: 'left', width: '100%', border: `1.5px dashed ${V('gline')}`, background: '#FFFBF2', borderRadius: 12, padding: '10px 13px', cursor: 'pointer', font: 'inherit' }}>{inner}</button>
            ) : (
              <div key={'o' + i} style={{ display: 'flex', gap: 12, alignItems: 'center', border: `1.5px dashed ${V('gline')}`, background: '#FFFBF2', borderRadius: 12, padding: '10px 13px' }}>{inner}</div>
            );
          }
          const b = r.b; const isLunch = /lunch|break/i.test(b.reason || '');
          return (
            <div key={'b' + i} style={{ display: 'flex', gap: 12, alignItems: 'center', background: isLunch ? '#F4EDFF' : '#FFF0ED', border: `1px solid ${isLunch ? '#E5DAFB' : '#F6D9D2'}`, borderRadius: 12, padding: '10px 13px' }}>
              <div style={{ width: 92, flexShrink: 0, fontSize: 12.5, fontWeight: 800, color: isLunch ? '#8E6AD8' : V('danger') }}>{to12(b.startTime)}<div style={{ fontSize: 10.5, color: V('muted'), fontWeight: 600 }}>{to12(b.endTime)}</div></div>
              <div style={{ minWidth: 0, flex: 1, fontSize: 12.5, fontWeight: 700, color: isLunch ? '#8E6AD8' : V('danger') }}>{isLunch ? t('pos.lunch_break') : (b.reason ? statusLabel('scheduleBlock', b.reason) : statusLabel('scheduleBlock', 'blocked'))}{b.note ? <span style={{ color: V('muted'), fontWeight: 600 }}> · {b.note}</span> : null}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Full modal (shell + inner) — kept for existing direct callers (Live Schedule, Booking). */
export function TechnicianSchedulePreview({ tech, date, onClose, onBookSlot }: {
  tech: TechScheduleData; date: string; onClose: () => void; onBookSlot?: (slot: OpenSlot) => void;
}) {
  const meta = technicianScheduleMeta(tech, date);
  return (
    <IPadProFullViewModal
      isOpen onClose={onClose}
      initials={meta.initials} title={meta.title} subtitle={meta.subtitle} status={meta.status}
      ariaLabel={meta.ariaLabel} closeLabel={t('pos.close_preview')} footer={meta.footer}
    >
      <TechnicianScheduleInner tech={tech} onBookSlot={onBookSlot} />
    </IPadProFullViewModal>
  );
}
