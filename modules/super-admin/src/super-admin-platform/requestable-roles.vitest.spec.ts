// batch 8 decision 6 (Nov 9 2026): requestable roles come from ONE policy, never a platform role
import { describe, it, expect } from 'vitest';
import { requestableRoles, SELF_REQUESTABLE_ROLES } from './access-request-core';

describe('requestable roles policy', () => {
  it('marks the held role, an open request, high risk — and never offers a platform role', () => {
    const r = requestableRoles('technician', ['MANAGER']);
    expect(r.map((x) => x.role)).toEqual([...SELF_REQUESTABLE_ROLES]);
    expect(r.find((x) => x.role === 'TECHNICIAN')?.state).toBe('held');
    expect(r.find((x) => x.role === 'MANAGER')?.state).toBe('open_request');
    expect(r.find((x) => x.role === 'OWNER')).toEqual({ role: 'OWNER', highRisk: true, state: 'available' });
    expect(r.some((x) => x.role === 'SUPER_ADMIN')).toBe(false);
  });
});
