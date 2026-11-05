// A2 (Nov 5 2026): the scheduled evaluator runs as the rule's creator with that role's session permissions.
import { describe, it, expect } from 'vitest';
import { sessionPermissionsForRole } from './business-alerts-schedule.job';

describe('session permissions for a role', () => {
  it('an owner can use AI Business; a technician cannot; an unknown role has nothing', () => {
    expect(sessionPermissionsForRole('OWNER')).toContain('pos.ai_business.view');
    expect(sessionPermissionsForRole('TECHNICIAN')).not.toContain('pos.ai_business.view');
    expect(sessionPermissionsForRole('NOT_A_ROLE')).toEqual([]);
  });
});
