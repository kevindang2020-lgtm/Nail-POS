// workforce-lifecycles-team-round2 — the Team Management round-2 machines (Oct 30 2026 gap sweep): the moves the screens'
// action tables allow are allowed; the deliberate refusals stay refused.
import { describe, it, expect } from 'vitest';
import {
  COMMISSION_DISCREPANCY_REVIEW, TEAM_DATA_ALERT, COMMISSION_DISCREPANCY_SCAN_RUN, TEAM_DATA_ALERT_RUN, TEAM_DATA_NIGHTLY_RUN,
  TEAM_TRAINING_COURSE, TEAM_TRAINING_ASSIGNMENT, TEAM_STAFF_CERTIFICATION,
} from './workforce-lifecycles';
import { TRANSITIONS } from './team-screens/commission-review.repository';
import { ALERT_TRANSITIONS } from './team-screens/team-data-alerts.repository';
import { TRAINING_TRANSITIONS } from './team-staff/team-training.repository';

describe('review workflows: the machine allows exactly what the screen action tables allow', () => {
  it('commission findings and team data alerts', () => {
    for (const [m, table] of [[COMMISSION_DISCREPANCY_REVIEW, TRANSITIONS], [TEAM_DATA_ALERT, ALERT_TRANSITIONS]] as const) {
      for (const [action, t] of Object.entries(table)) for (const from of t.from) {
        const to = t.to(from as never);
        if (action === 'note') continue;                     // a note does not change the status
        expect(m.can(from, to), `${m.name} ${action}: ${from} → ${to}`).toBe(true);
      }
      expect(m.can('RESOLVED', 'DISMISSED')).toBe(false); expect(m.can('DISMISSED', 'RESOLVED')).toBe(false);
    }
  });
});

describe('runs, training and certifications', () => {
  it('a finished scan run is never flipped; a succeeded nightly run is never re-claimed, a failed one may retry', () => {
    for (const m of [COMMISSION_DISCREPANCY_SCAN_RUN, TEAM_DATA_ALERT_RUN]) { expect(m.can('running', 'succeeded')).toBe(true); expect(m.can('failed', 'succeeded')).toBe(false); expect(m.can('succeeded', 'failed')).toBe(false); }
    expect(TEAM_DATA_NIGHTLY_RUN.can('failed', 'running')).toBe(true); expect(TEAM_DATA_NIGHTLY_RUN.can('succeeded', 'running')).toBe(false);
  });
  it('training assignments follow TRAINING_TRANSITIONS; an archived course stays archived', () => {
    for (const t of Object.values(TRAINING_TRANSITIONS)) for (const from of t.from) expect(TEAM_TRAINING_ASSIGNMENT.can(from, t.to)).toBe(true);
    expect(TEAM_TRAINING_ASSIGNMENT.can('completed', 'assigned')).toBe(false); expect(TEAM_TRAINING_COURSE.can('archived', 'active')).toBe(false);
  });
  it('a staff certification is decided once; only a verified one is revoked', () => {
    expect(TEAM_STAFF_CERTIFICATION.can('UNVERIFIED', 'VERIFIED')).toBe(true); expect(TEAM_STAFF_CERTIFICATION.can('VERIFIED', 'REVOKED')).toBe(true);
    expect(TEAM_STAFF_CERTIFICATION.can('REJECTED', 'VERIFIED')).toBe(false); expect(TEAM_STAFF_CERTIFICATION.can('UNVERIFIED', 'REVOKED')).toBe(false);
  });
});
