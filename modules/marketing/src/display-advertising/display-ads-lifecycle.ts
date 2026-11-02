// display-ads-lifecycle.ts — BUILD_PLAN Phase 12 (#27): the display advertisement lifecycle as ONE transition table.
// Reproduces display-ads-core transition() exactly (publish: draft|paused → published; pause: published → paused;
// archive: any live state → archived; restore: archived → draft). The repository's setStatus asserts the move and keeps
// its conditional update (`where status = <the state read> and version = <expected>`), so a concurrent writer gets a
// conflict instead of a lost update.
import { defineStateMachine } from '@aipowersalon/database';

export const DISPLAY_AD_LIFECYCLE = defineStateMachine({
  name: 'display_ad', table: 'display_ads', column: 'status',
  states: ['draft', 'published', 'paused', 'archived'],
  transitions: { draft: ['published', 'archived'], published: ['paused', 'archived'], paused: ['published', 'archived'], archived: ['draft'] },
  initial: ['draft'],
});
