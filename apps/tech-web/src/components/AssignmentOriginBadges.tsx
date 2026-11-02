// AssignmentOriginBadges.tsx — BUILD_PLAN Phase 6 (ai_queue_assignment): the small chips on the technician's queue and
// ticket that say how a guest came to them — "Suggested by AI", "Auto-assigned", "Locked to you" (and "Guest chose you"
// after an accept-another-technician). Renders nothing when the server sent no source / lock.
import { assignmentOrigin, type AssignmentOriginFields } from '../lib/assignmentOrigin';

const TONE: Record<string, { background: string; color: string }> = {
  ai: { background: 'var(--tech-primary-light)', color: 'var(--tech-primary-dark)' },
  auto: { background: 'var(--tech-primary-light)', color: 'var(--tech-primary-dark)' },
  customer: { background: 'var(--tech-primary-light)', color: 'var(--tech-primary-dark)' },
  locked: { background: 'var(--tech-warning-bg)', color: 'var(--tech-warning)' },
};

export function AssignmentOriginBadges({ entry, myTechnicianId }: { entry: AssignmentOriginFields; myTechnicianId?: string | null }) {
  const badges = assignmentOrigin(entry, myTechnicianId);
  if (!badges.length) return null;
  return (
    <span data-testid="assignment-origin" style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {badges.map((b) => (
        <span key={b.key} className="tech-chip" title={b.title} data-origin={b.key} style={{ ...TONE[b.key], padding: '1px 7px', fontSize: 11 }}>
          {b.key === 'locked' ? '🔒 ' : ''}{b.label}
        </span>
      ))}
    </span>
  );
}
