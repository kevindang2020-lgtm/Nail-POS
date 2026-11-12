import { describe, it, expect } from 'vitest';
import { locationNextSteps, validPin } from './nextSteps';

const ready = { latitude: 39.95, longitude: -75.05, map_pin_confirmed_at: '2026-01-01', address: '123 Main', phone: '+18565550100', verification_status: 'manager_confirmed', is_public: false };
describe('locationNextSteps — mirrors the server publish check', () => {
  it('a complete, unpublished location is ready to publish', () => expect(locationNextSteps(ready)).toEqual(['publish']));
  it('a bare draft lists every missing step in order, never "publish"', () => {
    expect(locationNextSteps({ verification_status: 'draft' })).toEqual(['set_pin', 'add_address', 'add_contact']);
  });
  it('a pin that is set but not confirmed asks to confirm it; 0,0 counts as no pin', () => {
    expect(locationNextSteps({ ...ready, map_pin_confirmed_at: null })).toEqual(['confirm_pin']);
    expect(locationNextSteps({ ...ready, latitude: 0, longitude: 0 })).toEqual(['set_pin']);
    expect(validPin('39.9', '-75')).toBe(true); expect(validPin(null, -75)).toBe(false); expect(validPin(91, 0)).toBe(false);
  });
  it('email is enough contact; suspended/rejected blocks publishing', () => {
    expect(locationNextSteps({ ...ready, phone: null, public_email: 'a@b.co' })).toEqual(['publish']);
    expect(locationNextSteps({ ...ready, verification_status: 'rejected' })).toEqual(['blocked_by_review']);
  });
  it('published: verified needs nothing; otherwise it is waiting for verification (not shown as verified)', () => {
    expect(locationNextSteps({ ...ready, is_public: true, verification_status: 'verified' })).toEqual([]);
    expect(locationNextSteps({ ...ready, is_public: true, verification_status: 'pending_review' })).toEqual(['awaiting_review']);
  });
});
