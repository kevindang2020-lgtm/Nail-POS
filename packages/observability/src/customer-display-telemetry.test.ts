import { describe, it, expect } from 'vitest';
import { customerDisplayEvents, customerDisplayStateSeconds, recordDisplayEvent, observeDisplayState, CUSTOMER_DISPLAY_EVENTS } from './customer-display-telemetry';

// Dual-Screen mandate §108: the customer display's counters — bounded vocabularies, no tenant or device label (those
// belong in the log lines, §107), never throwing into a display request.
describe('customer display telemetry (§108)', () => {
  const val = (event: string) => customerDisplayEvents.snapshot().find((e) => e.labels.event === event)?.value ?? 0;
  it('counts each event, by name, by the amount given', () => {
    const c0 = val('check_in'); const a0 = val('ad_impression');
    recordDisplayEvent('check_in'); recordDisplayEvent('check_in'); recordDisplayEvent('ad_impression', 12);
    expect(val('check_in') - c0).toBe(2);
    expect(val('ad_impression') - a0).toBe(12);
  });
  it('an unknown event is dropped, never a new series; nothing throws', () => {
    const before = customerDisplayEvents.snapshot().length;
    expect(() => recordDisplayEvent('tenant-abc' as any)).not.toThrow();
    expect(() => recordDisplayEvent('check_in', Number.NaN)).not.toThrow();
    expect(customerDisplayEvents.snapshot().every((e) => (CUSTOMER_DISPLAY_EVENTS as readonly string[]).includes(String(e.labels.event)))).toBe(true);
    expect(customerDisplayEvents.snapshot().length).toBeLessThanOrEqual(Math.max(before, CUSTOMER_DISPLAY_EVENTS.length));
  });
  it('observes how long a display state took to build, by its coarse mode', () => {
    const count = () => customerDisplayStateSeconds.snapshot().filter((e) => e.labels.mode === 'checkout').reduce((n, e: any) => n + (e.value?.count ?? 0), 0);
    const n0 = count();
    observeDisplayState('checkout', 0.042);
    expect(count() - n0).toBe(1);
    expect(() => observeDisplayState('nonsense' as any, 1)).not.toThrow();
  });
});
