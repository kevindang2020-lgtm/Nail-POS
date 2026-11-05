import { initials } from '../lib/tech';
import type { FollowUpTaskView, FollowUpStatus } from '../api/techFollowUpApi';

// One follow-up client card in the technician's "Today's Follow-Ups" list. Shows the customer, the service completed,
// and the time; pending tasks offer Send (opens the message modal) and Skip. Sent/skipped tasks are read-only with a
// status chip. Server-truth only.
const fmtTime = (iso: string | null) => { if (!iso) return ''; try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
const CHIP: Record<FollowUpStatus, { label: string; tone: string }> = {
  pending: { label: 'Ready', tone: 'warn' }, pending_manager_approval: { label: 'Awaiting approval', tone: 'warn' },
  sent: { label: 'Sent', tone: 'ok' }, customer_replied: { label: 'Replied', tone: 'ok' },
  rebooked: { label: 'Rebooked', tone: 'ok' }, skipped: { label: 'Skipped', tone: 'neutral' }, dismissed: { label: 'Dismissed', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'danger' }, customer_not_available: { label: 'No app', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
};

export function TechFollowUpCard({ task, busy, onSend, onSkip }: {
  task: FollowUpTaskView; busy: boolean; onSend: (t: FollowUpTaskView) => void; onSkip: (t: FollowUpTaskView) => void;
}) {
  const chip = CHIP[task.status];
  const t = fmtTime(task.completedAt);
  return (
    <div className="tech-card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="tech-avatar" style={{ width: 40, height: 40 }}>{initials(task.customerName)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{task.customerName}</div>
          <div className="tech-muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.serviceName}{t ? ` · ${t}` : ''}</div>
        </div>
        <span className={'tech-chip ' + chip.tone}>{chip.label}</span>
      </div>

      {task.status === 'pending' ? (
        <>
          {task.suggestedMessage ? (
            <div className="tech-muted" style={{ marginTop: 10, padding: '10px 12px', background: 'var(--tech-surface-soft)', borderRadius: 10, fontSize: 12.5, whiteSpace: 'pre-wrap' }}>“{task.suggestedMessage}”</div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="tech-btn gold" style={{ height: 44, fontSize: 14, flex: 1 }} disabled={busy} onClick={() => onSend(task)}>Send Follow-Up</button>
            <button className="tech-btn outline" style={{ height: 44, fontSize: 14, width: 96 }} disabled={busy} onClick={() => onSkip(task)}>Skip</button>
          </div>
          <div className="tech-muted" style={{ fontSize: 11, marginTop: 8 }}>{task.customerHasApp ? 'Sends in the customer app' : task.customerPhone ? 'Sends as a text message' : 'No contact method on file'}</div>
        </>
      ) : task.status === 'sent' && task.sentMessage ? (
        <div className="tech-muted" style={{ fontSize: 12, marginTop: 10, whiteSpace: 'pre-wrap' }}>“{task.sentMessage}”</div>
      ) : task.status === 'skipped' && task.skipReason ? (
        <div className="tech-muted" style={{ fontSize: 12, marginTop: 10 }}>Skipped — {task.skipReason}</div>
      ) : null}
    </div>
  );
}
