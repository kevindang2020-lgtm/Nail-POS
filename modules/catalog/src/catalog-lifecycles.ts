// catalog-lifecycles.ts — BUILD_PLAN Phase 12 (#27): service_categories.status as a state machine (super-admin imports it).
import { defineStateMachine } from '@aipowersalon/database';

/** service_categories.status — an owner's flag (active / inactive / archived, restorable); a MERGED category is gone into
 *  another one and never comes back. */
export const SERVICE_CATEGORY = defineStateMachine({
  name: 'service_category', table: 'service_categories', column: 'status',
  states: ['active', 'inactive', 'archived', 'merged'],
  transitions: { active: ['active', 'inactive', 'archived', 'merged'], inactive: ['active', 'inactive', 'archived', 'merged'], archived: ['active', 'inactive', 'archived'], merged: ['merged'] },
  initial: ['active'],
});
