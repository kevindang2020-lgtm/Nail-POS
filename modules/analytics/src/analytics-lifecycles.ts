// analytics-lifecycles.ts — BUILD_PLAN Phase 12 (#27): the analytics module's status lifecycles, ONE transition table each.
import { defineStateMachine } from '@aipowersalon/database';

/** ai_business_report_jobs.status — a generated report: queued → running → completed | failed. A job whose
 *  markRunning write was lost may still finish from queued (today's flow). A finished report never moves again (before,
 *  the complete / fail writes were unconditional: a late failure could overwrite a completed report). */
export const AI_BUSINESS_REPORT_JOB = defineStateMachine({
  name: 'ai_business_report_job', table: 'ai_business_report_jobs', column: 'status',
  states: ['queued', 'running', 'completed', 'failed'],
  transitions: { queued: ['running', 'completed', 'failed'], running: ['completed', 'failed'] },
  initial: ['queued'],
});

/** owner_alerts.status — an owner alert: new / in_progress → acknowledged → resolved | dismissed. Acknowledging,
 *  resolving or dismissing twice is a no-op repeat (allowed, as today). A resolved or dismissed alert is closed: it can
 *  no longer be re-opened to acknowledged nor flipped between resolved and dismissed (today's write was unconditional). */
export const OWNER_ALERT = defineStateMachine({
  name: 'owner_alert', table: 'owner_alerts', column: 'status',
  states: ['new', 'in_progress', 'acknowledged', 'resolved', 'dismissed'],
  transitions: {
    new: ['acknowledged', 'resolved', 'dismissed'],
    in_progress: ['acknowledged', 'resolved', 'dismissed'],
    acknowledged: ['acknowledged', 'resolved', 'dismissed'],
    resolved: ['resolved'],
    dismissed: ['dismissed'],
  },
  initial: ['new'],
});
