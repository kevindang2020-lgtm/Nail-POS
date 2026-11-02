import type { FollowUpTaskView } from '../api/posFollowUpApi';
import { t as tx, enPlural } from '@aipowersalon/mobile-sdk/i18n';

// Per-technician rollup for the manager Follow-Up Queue. Pure presentational: groups the branch's tasks by their main
// technician (the line owner) and shows pending/sent/skipped counts so a manager can see at a glance who still has
// follow-ups to send. Clicking a tech filters the table above via onPick.
export interface TechRollup { technicianId: string; technicianName: string; pending: number; sent: number; skipped: number; total: number }

export function rollupByTech(tasks: FollowUpTaskView[]): TechRollup[] {
  const m = new Map<string, TechRollup>();
  for (const t of tasks) {
    const r = m.get(t.technicianId) ?? { technicianId: t.technicianId, technicianName: t.technicianName, pending: 0, sent: 0, skipped: 0, total: 0 };
    r.total += 1;
    if (t.status === 'pending') r.pending += 1;
    else if (t.status === 'sent' || t.status === 'customer_replied' || t.status === 'rebooked') r.sent += 1;
    else r.skipped += 1;
    m.set(t.technicianId, r);
  }
  return [...m.values()].sort((a, b) => b.pending - a.pending || a.technicianName.localeCompare(b.technicianName));
}

export function FollowUpTechnicianSummary({ tasks, activeTech, onPick }: { tasks: FollowUpTaskView[]; activeTech?: string; onPick: (technicianId: string | undefined) => void }) {
  const rows = rollupByTech(tasks);
  if (rows.length === 0) return null;
  return (
    <div className="list" style={{ maxHeight: 200 }} aria-label={tx('pos.follow_ups_by_technician')}>
      {rows.map((r) => {
        const active = activeTech === r.technicianId;
        return (
          <div className="row" key={r.technicianId} style={active ? { borderColor: 'var(--ok)', background: 'var(--ok-bg)', cursor: 'pointer' } : { cursor: 'pointer' }}
            onClick={() => onPick(active ? undefined : r.technicianId)} role="button" tabIndex={0}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div className="t">{r.technicianName}</div>
              <div className="s">{r.total} {tx('pos.client')}{enPlural(r.total === 1 ? '' : 's')} {tx('pos.today')}</div>
            </div>
            <span className={'pill' + (r.pending > 0 ? ' warn' : '')}>{r.pending} {tx('pos.pending_2')}</span>
            <span className="pill ok" style={{ marginLeft: 6 }}>{r.sent} {tx('pos.sent_2')}</span>
            {r.skipped > 0 ? <span className="pill" style={{ marginLeft: 6 }}>{r.skipped} {tx('pos.skipped_2')}</span> : null}
          </div>
        );
      })}
    </div>
  );
}
