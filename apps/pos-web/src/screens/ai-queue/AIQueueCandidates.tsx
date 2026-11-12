// AI Queue Assignment 05 (extras Nov 11 2026): every candidate the engine sees for this guest — availability, the next
// committed appointment, current load against capacity, shift end, the guest's preference (asked for / last time) and,
// for anyone a hard rule removed, the plain reason. Straight from the panel's candidates (the engine's live view).
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import type { QueueAssignmentPanelCandidate } from '@aipowersalon/api-contracts/tenant';
import { muted, pill, mins } from './aiQueueUi';
import { fmtNumber } from '../../i18n/format';

export function CandidateTable({ candidates }: { candidates: QueueAssignmentPanelCandidate[] }) {
  const rows = [...candidates].sort((a, b) => Number(b.eligible) - Number(a.eligible) || (b.matchScore ?? -1) - (a.matchScore ?? -1));
  return (
    <details data-testid="aq-candidates" open={rows.length <= 6}>
      <summary style={muted}>{tx('growth.aiQueue.cand.title', { n: rows.filter((c) => c.eligible).length, total: rows.length })}</summary>
      <table className="aq-cand-table" style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse', marginTop: 4 }}>
        <thead><tr style={{ textAlign: 'left' }}><th>{tx('growth.aiQueue.cand.tech')}</th><th>{tx('growth.aiQueue.cand.now')}</th><th>{tx('growth.aiQueue.cand.next')}</th><th>{tx('growth.aiQueue.cand.load')}</th><th>{tx('growth.aiQueue.cand.score')}</th></tr></thead>
        <tbody>{rows.map((c) => (
          <tr key={c.technicianId} data-testid="aq-cand-row" style={{ opacity: c.eligible ? 1 : 0.65, borderTop: '1px solid var(--line)' }}>
            <td><b>{c.name}</b>{c.isRequested ? <span style={{ ...pill('#E9F1FA', '#3C7FB6'), marginLeft: 4 }}>{tx('growth.aiQueue.cand.asked')}</span> : null}{c.isPrevious ? <span style={{ ...pill('#F3ECE1', '#6C6965'), marginLeft: 4 }}>{tx('growth.aiQueue.cand.last')}</span> : null}
              {!c.eligible ? <div style={muted} data-testid="aq-cand-why">{c.reasons.join(' · ') || tx('pos.not_eligible_2')}</div> : null}</td>
            <td data-testid="aq-cand-now">{c.onBreak ? tx('growth.aiQueue.cand.break') : c.blocked ? tx('growth.aiQueue.cand.blocked') : c.available ? tx('growth.aiQueue.cand.free') : c.availableInMinutes != null ? tx('growth.aiQueue.cand.freeIn', { m: mins(c.availableInMinutes) }) : '—'}
              {c.shiftEndsInMinutes != null ? <div style={muted}>{tx('growth.aiQueue.cand.shiftEnds', { m: mins(c.shiftEndsInMinutes) })}</div> : null}</td>
            <td data-testid="aq-cand-next">{c.nextAppointmentInMinutes != null ? tx('growth.aiQueue.cand.inM', { m: mins(c.nextAppointmentInMinutes) }) : tx('growth.aiQueue.cand.noneBooked')}</td>
            <td>{c.activeAssignments}/{c.maxConcurrent}</td>
            <td>{c.matchScore != null ? fmtNumber(Math.round(c.matchScore)) : '—'}</td>
          </tr>))}</tbody>
      </table>
    </details>
  );
}
