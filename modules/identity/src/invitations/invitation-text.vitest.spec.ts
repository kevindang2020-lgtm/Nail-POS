// C3 audit (Nov 4 2026): the staff invitation named "technician" for every role.
import { describe, it, expect } from 'vitest';
import { inviteSmsBody, inviteEmail } from './invitation-delivery.service';

describe('invitation text names the role', () => {
  it('a technician (or no role) keeps the technician text', () => {
    expect(inviteSmsBody('L')).toContain('technician account');
    expect(inviteSmsBody('L', 'TECHNICIAN')).toContain('technician account');
    expect(inviteEmail('L', 'technician').body).toContain('as a technician');
  });
  it('a receptionist / manager is never told to set up a technician account', () => {
    expect(inviteSmsBody('L', 'RECEPTIONIST')).toBe('AIPowerSalon: you have been invited to join a salon team as a receptionist. Set up your account here: L');
    const m = inviteEmail('L', 'OWNER_ADMIN');
    expect(m.body).toContain('as an owner admin'); expect(m.body).not.toMatch(/technician/i);
  });
});
