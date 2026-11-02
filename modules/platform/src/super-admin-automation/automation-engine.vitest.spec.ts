import { describe, it, expect } from 'vitest';
import { RecordingDispatcher, AutomationEngineService } from './automation-engine.service';
import { automationSchedulerCronEnabled } from './automation-scheduler';

describe('automation engine — dispatcher + safety', () => {
  it('RecordingDispatcher flags notification actions and records intent', async () => {
    const d = new RecordingDispatcher();
    expect((await d.dispatch({ type: 'send_platform_notification' })).notification).toBe(true);
    expect((await d.dispatch({ type: 'send_email' })).notification).toBe(true);
    expect((await d.dispatch({ type: 'create_support_ticket' })).notification).toBeFalsy();
    expect((await d.dispatch({ type: 'create_audit_event' })).ok).toBe(true);
  });
  it('ingestEvent is a no-op without a DB and ignores unknown triggers', async () => {
    const eng = new AutomationEngineService(null);
    const r = await eng.ingestEvent({ eventId: 'e1', type: 'TENANT_PAYMENT_FAILED' });
    expect(r).toEqual({ ok: true, created: 0, duplicates: 0, skipped: 0, suppressed: 0, ruleIds: [] });
    const bad = await eng.ingestEvent({ eventId: 'e2', type: 'DROP TABLE' as any });
    expect(bad.created).toBe(0);
  });
  it('runDueEvaluations is a safe no-op without a DB', async () => {
    const r = await new AutomationEngineService(null).runDueEvaluations(new Date());
    expect(r).toEqual({ evaluated: 0, fired: 0, rolled: 0, skipped: 0 });
  });
  it('scheduler cron flag parses truthy strings and is off by default', () => {
    expect(automationSchedulerCronEnabled({} as any)).toBe(false);
    expect(automationSchedulerCronEnabled({ AUTOMATION_SCHEDULER_CRON_ENABLED: 'true' } as any)).toBe(true);
    expect(automationSchedulerCronEnabled({ AUTOMATION_SCHEDULER_CRON_ENABLED: '1' } as any)).toBe(true);
    expect(automationSchedulerCronEnabled({ AUTOMATION_SCHEDULER_CRON_ENABLED: 'off' } as any)).toBe(false);
  });
});
