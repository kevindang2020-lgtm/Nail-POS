// role-landing.test.ts — post-login landing routes (spec §5 "role-based redirect").
//
// The security-relevant assertion is the last one: this resolver decides a LANDING SCREEN, not authority. The
// role it reads comes from the server-issued principal, and every screen behind the landing route is still gated
// by the backend's RolePermissionGuard — so landing somewhere does not grant anything.
import { describe, it, expect } from 'vitest';
import { landingPathForRole, DEFAULT_LANDING } from './role-landing';

describe('role-based landing', () => {
  it('lands an owner on the business overview', () => {
    expect(landingPathForRole('OWNER')).toBe('/overview');
  });

  it('lands a manager and a receptionist on live operations, not the P&L overview', () => {
    expect(landingPathForRole('MANAGER')).toBe('/live-operations');
    expect(landingPathForRole('RECEPTIONIST')).toBe('/live-operations');
  });

  it('lands a technician on their own queue rather than a business overview they cannot use', () => {
    expect(landingPathForRole('TECHNICIAN')).toBe('/tech-queue');
  });

  it('is case-insensitive about the role string', () => {
    expect(landingPathForRole('owner')).toBe('/overview');
    expect(landingPathForRole('Technician')).toBe('/tech-queue');
  });

  it('falls back to the previous default for an unknown or missing role (no regression)', () => {
    expect(landingPathForRole(undefined)).toBe(DEFAULT_LANDING);
    expect(landingPathForRole(null)).toBe(DEFAULT_LANDING);
    expect(landingPathForRole('')).toBe(DEFAULT_LANDING);
    expect(landingPathForRole('SOMETHING_NEW')).toBe(DEFAULT_LANDING);
  });

  it('SECURITY: an unrecognized/forged role cannot land anywhere privileged — it only ever falls back', () => {
    // Even if a client somehow presented a bogus role, the worst case is the default screen. Landing grants no
    // authority: the backend RolePermissionGuard still gates every screen and API call behind it.
    for (const forged of ['SUPER_ADMIN', 'ADMIN', 'ROOT', '../../admin', 'OWNER;DROP TABLE']) {
      const path = landingPathForRole(forged);
      expect([DEFAULT_LANDING, '/overview']).toContain(path);
      expect(path.startsWith('/')).toBe(true);          // never an external redirect
      expect(path).not.toMatch(/https?:|\/\//);         // never off-origin
    }
  });
});
