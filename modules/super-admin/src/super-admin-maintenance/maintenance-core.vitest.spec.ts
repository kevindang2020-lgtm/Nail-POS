import { describe, it, expect } from 'vitest';
import { maintenanceDecision, validateSchedule, windowsOverlap, durationMinutes, formatDuration, canTransitionMaint, type MaintenanceState } from './maintenance-core';

const ACTIVE: MaintenanceState = { active: true, mode: 'full', message: 'Back soon', expectedRestoration: null, allowedRoles: [] };

describe('maintenanceDecision — enforcement + no-lockout guarantee', () => {
  it('allows everything when maintenance is inactive', () => {
    expect(maintenanceDecision({ ...ACTIVE, active: false }, { role: 'MANAGER', method: 'POST', path: '/x' }).allow).toBe(true);
  });
  it('ALWAYS allows SUPER_ADMIN during maintenance (emergency access — cannot be locked out)', () => {
    expect(maintenanceDecision(ACTIVE, { role: 'SUPER_ADMIN', method: 'POST', path: '/super-admin/settings/general/maintenance/disable' }).allow).toBe(true);
  });
  it('allows unauthenticated entry points (login/health/public) during maintenance', () => {
    expect(maintenanceDecision(ACTIVE, { role: null, method: 'POST', path: '/auth/login' }).allow).toBe(true);
  });
  it('allows explicitly-allowed roles', () => {
    expect(maintenanceDecision({ ...ACTIVE, allowedRoles: ['OWNER'] }, { role: 'OWNER', method: 'POST', path: '/x' }).allow).toBe(true);
  });
  it('blocks a normal authenticated user in full mode with a 503 payload', () => {
    const d = maintenanceDecision(ACTIVE, { role: 'MANAGER', method: 'GET', path: '/pos/state' });
    expect(d.allow).toBe(false);
    if (!d.allow) { expect(d.status).toBe(503); expect(d.body.maintenance).toBe(true); expect(d.body.message).toBe('Back soon'); }
  });
  it('read_only mode allows GETs but blocks mutations for normal users', () => {
    const ro: MaintenanceState = { ...ACTIVE, mode: 'read_only' };
    expect(maintenanceDecision(ro, { role: 'MANAGER', method: 'GET', path: '/x' }).allow).toBe(true);
    expect(maintenanceDecision(ro, { role: 'MANAGER', method: 'POST', path: '/x' }).allow).toBe(false);
  });
});

describe('scheduling', () => {
  const soon = () => new Date(Date.now() + 86400000).toISOString();
  const later = () => new Date(Date.now() + 90000000).toISOString();
  it('validates windows', () => {
    expect(validateSchedule({ startsAt: soon(), endsAt: later() })).toBeNull();
    expect(validateSchedule({ startsAt: later(), endsAt: soon() })).toMatch(/after start/i);
    expect(validateSchedule({ startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: later() })).toMatch(/future/i);
    expect(validateSchedule({ startsAt: 'nope', endsAt: later() })).toMatch(/valid dates/i);
  });
  it('detects overlap', () => {
    const a = { startsAt: '2026-06-01T00:00:00Z', endsAt: '2026-06-01T02:00:00Z' };
    expect(windowsOverlap(a, { startsAt: '2026-06-01T01:00:00Z', endsAt: '2026-06-01T03:00:00Z' })).toBe(true);
    expect(windowsOverlap(a, { startsAt: '2026-06-01T02:00:00Z', endsAt: '2026-06-01T03:00:00Z' })).toBe(false); // adjacent
  });
  it('computes + formats duration', () => {
    expect(durationMinutes({ startsAt: '2026-06-01T00:00:00Z', endsAt: '2026-06-01T02:00:00Z' })).toBe(120);
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(0)).toBe('—');
  });
});

describe('event transitions', () => {
  it('allows the sane transitions only', () => {
    expect(canTransitionMaint('scheduled', 'cancelled')).toBe(true);
    expect(canTransitionMaint('scheduled', 'in_progress')).toBe(true);
    expect(canTransitionMaint('scheduled', 'completed')).toBe(false);
    expect(canTransitionMaint('in_progress', 'completed')).toBe(true);
    expect(canTransitionMaint('completed', 'in_progress')).toBe(false);
  });
});
