import { describe, it, expect } from 'vitest';
import { validateAnnouncementInput, canTransition, initialStatus } from './platform-announcement-core';

const NOW = Date.parse('2026-05-06T00:00:00Z');
const future = '2026-06-01T00:00:00Z';
const past = '2026-01-01T00:00:00Z';

describe('platform-announcement engine', () => {
  it('requires title, valid channel/scope, and targets for selected-tenants', () => {
    const e = validateAnnouncementInput({ title: '', channel: 'fax', audienceScope: 'selected_tenants', tenantIds: [] }, { now: NOW });
    expect(e.errors).toContain('A title is required.');
    expect(e.errors.some((x) => x.includes('Channel must be'))).toBe(true);
    expect(e.errors.some((x) => x.includes('Select at least one tenant'))).toBe(true);
  });

  it('accepts a valid all-tenants announcement without targets', () => {
    const e = validateAnnouncementInput({ title: 'Holiday Notice', channel: 'email', audienceScope: 'all_tenants' }, { now: NOW });
    expect(e.errors).toHaveLength(0);
  });

  it('validates scheduled time is a valid future date', () => {
    expect(validateAnnouncementInput({ title: 'X', audienceScope: 'all_tenants', scheduledAt: past }, { now: NOW }).errors.some((x) => x.includes('future'))).toBe(true);
    expect(validateAnnouncementInput({ title: 'X', audienceScope: 'all_tenants', scheduledAt: 'not-a-date' }, { now: NOW }).errors.some((x) => x.includes('valid date'))).toBe(true);
    expect(validateAnnouncementInput({ title: 'X', audienceScope: 'all_tenants', scheduledAt: future }, { now: NOW }).errors).toHaveLength(0);
  });

  it('derives initial status and gates lifecycle transitions', () => {
    expect(initialStatus({ title: 'X' })).toBe('draft');
    expect(initialStatus({ title: 'X', scheduledAt: future })).toBe('scheduled');
    expect(canTransition('draft', 'sending')).toBe(true);
    expect(canTransition('scheduled', 'cancelled')).toBe(true);
    expect(canTransition('sent', 'cancelled')).toBe(false);
    expect(canTransition('cancelled', 'sending')).toBe(false);
  });
});
