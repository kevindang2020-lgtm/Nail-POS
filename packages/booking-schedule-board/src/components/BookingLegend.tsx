import type { ReactNode } from 'react';
import { useBoardText } from '../i18n/boardText';
import { BlockIcon } from './icons';

export interface BookingLegendProps {
  canBlockTime: boolean;
  onBlockTime: () => void;
  /** Extra host-provided actions rendered in the action slot, left of Block time. Never a schedule-print action
   *  (owner rule: schedules are never printed — enforced by the no-print gates, addendum §10). */
  actions?: ReactNode;
}

/** Status legend: identification never relies on colour alone (spec §36). Block time is the only built-in action. */
export function BookingLegend({ canBlockTime, onBlockTime, actions }: BookingLegendProps) {
  const { t } = useBoardText();
  return (
    <div className="bsb-legend" data-testid="bsb-legend">
      <span className="bsb-key"><span className="bsb-swatch" style={{ background: 'var(--bsb-confirmed)' }} /> {t('status.confirmed')}</span>
      <span className="bsb-key"><span className="bsb-swatch" style={{ background: 'var(--bsb-arrived)' }} /> {t('status.arrived')}</span>
      <span className="bsb-key"><span className="bsb-swatch" style={{ background: 'var(--bsb-inservice)' }} /> {t('status.in_service')}</span>
      <span className="bsb-key"><span className="bsb-swatch" style={{ background: 'var(--bsb-walkin)' }} /> {t('legend.walkIn')}</span>
      <span className="bsb-key"><span className="bsb-swatch is-open" /> {t('legend.open')}</span>
      <span className="bsb-key"><span className="bsb-swatch is-break" /> {t('legend.break')}</span>
      <span className="bsb-key"><span className="bsb-swatch is-blocked" /> {t('legend.blocked')}</span>
      <span className="bsb-actions">
        {actions}
        {canBlockTime && <button type="button" className="bsb-btn" onClick={onBlockTime} data-testid="bsb-block-time-action"><BlockIcon /> {t('legend.blockTime')}</button>}
      </span>
    </div>
  );
}
