// status-component-lifecycle.ts — BUILD_PLAN Phase 12 (#27): a status-page component (status_components.status). The
// health aggregator recomputes it every tick from live signals, so every state may follow every other; the one rule —
// a human's MAINTENANCE is never overridden by the computed verdict — stays in the upsert's CASE. The machine makes the
// vocabulary and the single writer explicit.
import { defineStateMachine } from '@aipowersalon/database';

const ALL = ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance', 'unknown'] as const;
export const STATUS_COMPONENT = defineStateMachine({
  name: 'status_component', table: 'status_components', column: 'status',
  states: ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance', 'unknown'],
  transitions: Object.fromEntries(ALL.map((s) => [s, [...ALL]])) as any,
  initial: ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance', 'unknown'],
});
