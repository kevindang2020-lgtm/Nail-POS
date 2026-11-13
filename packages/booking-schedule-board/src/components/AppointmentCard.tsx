import { memo, type PointerEvent as ReactPointerEvent } from 'react';
import type { Appointment } from '../domain/scheduleTypes';
import { technicianAccent } from '../domain/technicianColor';
import { CheckIcon } from './icons';
import { useBoardText } from '../i18n/boardText';

/** Every status has an icon as well as its colour (spec §36, addendum §10); the words come from `status.<code>`. */
export const STATUS_GLYPH: Record<Appointment['status'], string> = {
  scheduled: '○',
  confirmed: '✓',
  arrived: '●',
  in_service: '◐',
  completed: '✓',
  cancelled: '×',
  no_show: '!',
  rescheduled: '↻',
};

export function serviceSummary(a: Appointment): string {
  if (a.items.length === 0) return '—';
  const first = a.items[0];
  const name = a.items.length > 1 ? `${first.name} +${a.items.length - 1}` : first.name;
  return name;
}

export interface AppointmentCardProps {
  appointment: Appointment;
  top: number;
  height: number;
  durationMinutes: number;
  dragging: boolean;
  pending: boolean;
  draggable: boolean;
  onOpen: (a: Appointment) => void;
  onPointerDown: (e: ReactPointerEvent, a: Appointment) => void;
}

export const AppointmentCard = memo(function AppointmentCard({ appointment: a, top, height, durationMinutes, dragging, pending, draggable, onOpen, onPointerDown }: AppointmentCardProps) {
  const { t } = useBoardText();
  const glyph = STATUS_GLYPH[a.status];
  const statusText = t(`status.${a.status}`);
  const isWalkIn = a.source === 'walk_in';
  const locked = !draggable || ['completed', 'cancelled', 'in_service', 'no_show'].includes(a.status);
  const accent = technicianAccent(a.tenantId, a.technicianId);   // identity rail; the status keeps its own fill + icon
  const title = [a.customerName, a.items.map((i) => i.name).join(' + '), t('card.min', { n: durationMinutes }), statusText,
    ...(isWalkIn ? [t('card.walkIn')] : []), ...(a.protected ? [t('card.protected')] : []), ...(a.requestedTechnician ? [t('card.requested')] : [])].join(' · ') + (a.notes ? `\n${a.notes}` : '');
  return (
    <div
      className={`bsb-card${height < 26 ? ' is-short' : ''}${dragging ? ' is-dragging' : ''}${pending ? ' is-pending' : ''}${a.protected ? ' is-protected' : ''}${locked ? ' is-locked' : ''}`}
      style={{ top, height: Math.max(height - 2, 12), ['--bsb-tech' as string]: accent }}
      data-accent={accent}
      data-status={a.status}
      data-source={a.source}
      data-testid={`bsb-appt-${a.id}`}
      role="button"
      tabIndex={0}
      aria-label={title.replace('\n', ' — ')}
      title={title}
      onClick={() => onOpen(a)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(a); } }}
      onPointerDown={(e) => { if (!locked) onPointerDown(e, a); }}
    >
      <span className="bsb-card-rail" aria-hidden="true" data-testid={`bsb-rail-${a.id}`} />
      <span className="bsb-card-name">
        <span className="bsb-status" aria-hidden="true">{a.status === 'confirmed' || a.status === 'completed' ? <CheckIcon /> : glyph}</span>
        <span className="bsb-sr">{statusText}:</span>
        {isWalkIn ? t('card.walkInName', { name: a.customerName }) : a.customerName}
      </span>
      <span className="bsb-card-svc">{serviceSummary(a)} · {t('card.minShort', { n: durationMinutes })}</span>
      {a.protected && <span className="bsb-card-flag" aria-hidden="true">🔒</span>}
    </div>
  );
});
