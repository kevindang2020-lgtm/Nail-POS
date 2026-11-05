import type { FollowUpTaskView, FollowUpStatus } from '../api/posFollowUpApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from './codeLabel';
import { fmtTime as fmtTimeZ } from '../i18n/format';

// The manager Follow-Up Queue task table (rendered as a desktop-fit internal-scroll list, matching the POS idiom). Shows
// each completed-service follow-up with its main technician, customer, completion time, status, and the message that
// will be / was sent. Manager can Send or Skip a pending task; sent/skipped rows are read-only. No fabricated data —
// everything is server-truth passed in via props.
const fmtTime = (iso: string | null) => { if (!iso) return '—'; try { return fmtTimeZ(iso); } catch { return iso; } };
// a follow-up status → its label, read at render (admin.followUp.status.<code>)
const statusText = (s: FollowUpStatus) => codeLabel('admin.followUp.status', s);
const tone = (s: FollowUpStatus) => (s === 'sent' || s === 'customer_replied' || s === 'rebooked' ? ' ok' : s === 'pending' || s === 'pending_manager_approval' ? ' warn' : '');

export function FollowUpTaskTable({ tasks, busy, onSend, onSkip, onApprove }: {
  tasks: FollowUpTaskView[]; busy: string | null;
  onSend: (t: FollowUpTaskView) => void; onSkip: (t: FollowUpTaskView) => void; onApprove?: (t: FollowUpTaskView) => void;
}) {
  if (tasks.length === 0) return <div className="muted" style={{ padding: '8px 2px' }}>{tx('pos.no_follow_ups_for_this_filter')}</div>;
  return (
    <div className="list" style={{ maxHeight: 'calc(100vh - 360px)' }} aria-label={tx('pos.follow_up_tasks')}>
      {tasks.map((t) => (
        <div className="row" key={t.id} style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="t">{t.customerName} {t.customerHasApp ? '' : <span className="muted" style={{ fontWeight: 600 }}>{tx('pos.no_app')}</span>}</div>
            <div className="s">{t.serviceName} · {t.technicianName} {tx('pos.completed')}{' '}{fmtTime(t.completedAt)}</div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 4, whiteSpace: 'pre-wrap' }}>{t.status === 'sent' && t.sentMessage ? t.sentMessage : t.suggestedMessage}</div>
            {t.status === 'skipped' && t.skipReason ? <div className="s" style={{ marginTop: 2 }}>{tx('pos.skip_reason')}{' '}{t.skipReason}</div> : null}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className={'pill' + tone(t.status)}>{statusText(t.status)}</span>
            {t.status === 'pending' ? (
              <>
                <button className="btn" disabled={busy === t.id} onClick={() => onSend(t)}>{busy === t.id ? '…' : tx('pos.send')}</button>
                <button className="btn ghost" disabled={busy === t.id} onClick={() => onSkip(t)}>{tx('pos.skip')}</button>
              </>
            ) : t.status === 'pending_manager_approval' ? (
              <>
                <button className="btn" disabled={busy === t.id} onClick={() => onApprove?.(t)}>{busy === t.id ? '…' : tx('pos.approve_send')}</button>
                <button className="btn ghost" disabled={busy === t.id} onClick={() => onSkip(t)}>{tx('pos.skip')}</button>
              </>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
