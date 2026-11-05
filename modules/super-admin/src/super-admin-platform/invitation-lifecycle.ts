// invitation-lifecycle.ts — BUILD_PLAN Phase 12 (#27): user_invitations.status as ONE state machine. An invitation is
// pending until it is accepted (single use), cancelled by the platform, or expires — the moves the repository has always
// made, each conditional on 'pending'; the writes now carry canMoveToSql(USER_INVITATION, to).
import { defineStateMachine } from '@aipowersalon/database';

export const USER_INVITATION = defineStateMachine({
  name: 'user_invitation', table: 'user_invitations', column: 'status',
  states: ['pending', 'accepted', 'cancelled', 'expired'],
  transitions: { pending: ['accepted', 'cancelled', 'expired'] },
  initial: ['pending'],
});
