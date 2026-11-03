// posBookingApi — retired client methods stay retired (Nov 2 2026): integrationStatus() had no caller; the booking board reads
// integrationStatus from the booking payload.
import { describe, it, expect } from 'vitest';
import { posBookingApi } from './posBookingApi';

describe('posBookingApi retired methods', () => {
  it('integrationStatus is gone', () => { expect((posBookingApi as Record<string, unknown>).integrationStatus).toBeUndefined(); });
});
