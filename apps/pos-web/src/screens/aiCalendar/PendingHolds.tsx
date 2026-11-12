// Pending Verification Queue (Extras backlog · AI Calendar 04): every live slot hold — the ones waiting for the
// customer's code and the ones about to lapse — soonest to expire first, with the minutes left as of the server's read.
// Read-only: retrying a code or releasing a hold stays a permissioned staff action in Booking.
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { posAiCalendarApi } from '../../api/posAiCalendarApi';
import { FitDialog, Empty } from '../../components/FitKit';
import { useLoad, StateBlock } from '../../components/FinanceKit';
import { fmtInZone } from '../../i18n/format';
import { codeLabel } from '../../components/codeLabel';

export function PendingHolds({ onClose, onBooking }: { onClose: () => void; onBooking: (date: string) => void }) {
  const d = useLoad(() => posAiCalendarApi.pendingHolds(), []);
  const q = d.data;
  return (
    <FitDialog wide title={t('aical.pq.title')} subtitle={q ? t('aical.pq.sub', { n: q.items.length, c: q.pendingCode, s: q.expiringSoon, at: fmtInZone(q.asOf, { hour: 'numeric', minute: '2-digit' }) }) : undefined} onClose={onClose} testId="aic-pending"
      footer={<><button className="btn ghost" onClick={d.reload} data-testid="aic-pq-refresh">{t('aical.refresh')}</button><button className="btn" onClick={onClose}>{t('aical.close')}</button></>}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !q ? <div className="aic-muted">{t('aical.loading')}</div> : !q.items.length ? <Empty title={t('aical.pq.none')} /> : (
        <table className="aic-table" data-testid="aic-pq-table">
          <thead><tr><th>{t('aical.pq.slot')}</th><th>{t('aical.col.technician')}</th><th>{t('aical.pq.state')}</th><th>{t('aical.pq.left')}</th><th /></tr></thead>
          <tbody>{q.items.map((h) => (
            <tr key={h.id} data-testid="aic-pq-row" className={h.expiringSoon ? 'aic-soon' : ''}>
              <td>{h.date} {h.start}–{h.end}</td><td>{h.technicianName ?? '—'}</td>
              <td>{h.pendingCode ? t('aical.holdPendingCode') : t('aical.hold')}{h.channel ? <div className="aic-muted">{codeLabel('aical.channel', h.channel)}</div> : null}</td>
              <td data-testid="aic-pq-left">{t('aical.pq.minutes', { n: h.minutesLeft })}{h.expiringSoon ? <div className="aic-muted">{t('aical.pq.soon')}</div> : null}</td>
              <td><button className="aic-link" onClick={() => onBooking(h.date)} data-testid="aic-pq-booking">{t('aical.openBooking')}</button></td>
            </tr>))}</tbody>
        </table>)}
      <div className="aic-muted">{t('aical.pq.note')}</div>
    </FitDialog>
  );
}
