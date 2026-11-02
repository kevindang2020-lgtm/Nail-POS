// incident-lifecycle.ts — BUILD_PLAN Phase 12 (#27): a platform incident (status_incidents.status) moves forward only —
// investigating → identified → mitigating → monitoring → resolved (a step may be skipped; a repeat is a no-op) — the rule
// system-status-core isValidIncidentTransition already stated; both writers now move the row through this table.
import { defineStateMachine } from '@aipowersalon/database';

export const STATUS_INCIDENT = defineStateMachine({
  name: 'status_incident', table: 'status_incidents', column: 'status',
  states: ['investigating', 'identified', 'mitigating', 'monitoring', 'resolved'],
  transitions: {
    investigating: ['investigating', 'identified', 'mitigating', 'monitoring', 'resolved'],
    identified: ['identified', 'mitigating', 'monitoring', 'resolved'],
    mitigating: ['mitigating', 'monitoring', 'resolved'],
    monitoring: ['monitoring', 'resolved'],
    resolved: ['resolved'],
  },
  initial: ['investigating'],
});
