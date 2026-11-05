// ai-scheduling-audit.vitest.spec.ts — BUILD_PLAN Phase 7 integration: the optimizer's audit rows name what was audited
// (not "recommendation" for a settings save or a run), and a job / automation / Super Admin context ('system:…' ref) does
// not put a non-uuid into audit_events.actor_user_id — which made the write fail and the audit row vanish.
import { describe, it, expect } from 'vitest';
import { schedAuditUserId, schedAuditResourceType } from './ai-scheduling.module';

describe('optimizer audit mapping', () => {
  it('keeps a real user id and drops a system ref', () => {
    expect(schedAuditUserId('5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f')).toBe('5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f');
    expect(schedAuditUserId('system:ai_scheduling_jobs')).toBeNull();
    expect(schedAuditUserId(undefined)).toBeNull();
  });
  it('derives the resource type from the action', () => {
    expect(schedAuditResourceType('settings.updated')).toBe('scheduling_settings');
    expect(schedAuditResourceType('run.completed')).toBe('schedule_optimization_run');
    expect(schedAuditResourceType('automation.after_run_failed')).toBe('schedule_optimization_run');
    expect(schedAuditResourceType('hold.released')).toBe('booking_hold');
    expect(schedAuditResourceType('time_off.created')).toBe('technician_time_off');
    expect(schedAuditResourceType('recommendation.accept')).toBe('scheduling_recommendation');
  });
});
