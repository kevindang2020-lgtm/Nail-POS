// useCheckoutStream.test — Constitution 9 §174/§191-193 for the Tap-to-Pay app.
import { describe, it, expect } from 'vitest';
import { CHECKOUT_QUEUE_EVENTS } from './useCheckoutStream';

describe('which events refresh the checkout queue', () => {
  it('ticket_paid is included — THE case that made a stale list dangerous', () => {
    // A manager could otherwise tap a ticket the front desk already took payment for.
    expect(CHECKOUT_QUEUE_EVENTS).toContain('ticket_paid');
  });

  it('a ticket entering the queue refreshes it', () => {
    expect(CHECKOUT_QUEUE_EVENTS).toContain('ticket_ready_checkout');
  });

  it('a total changing under the manager refreshes it', () => {
    expect(CHECKOUT_QUEUE_EVENTS).toContain('checkout_total_recalculated');
  });

  it('payment outcomes refresh it', () => {
    expect(CHECKOUT_QUEUE_EVENTS).toContain('payment_approved');
    expect(CHECKOUT_QUEUE_EVENTS).toContain('payment_failed');
  });

  it('it is NOT "every tenant event" — a payment screen must not flicker for a cash drawer in another room', () => {
    expect(CHECKOUT_QUEUE_EVENTS).not.toContain('cash_drawer_movement');
    expect(CHECKOUT_QUEUE_EVENTS).not.toContain('reports_updated');
    expect(CHECKOUT_QUEUE_EVENTS).not.toContain('settings_updated');
    expect(CHECKOUT_QUEUE_EVENTS).not.toContain('appointment_created');
  });

  it('every name is a real registry event, not a typo that would silently never fire', async () => {
    // A misspelled event name is invisible at runtime: it simply never matches. Pin them against the source
    // of truth rather than trusting the strings.
    const core = await import('@aipowersalon/realtime-contracts');   // the one event registry (moved to the package in Constitution 13 Phase 5; this path had broken)
    const known = new Set(Object.values(core.EVENTS as Record<string, string>));
    for (const e of CHECKOUT_QUEUE_EVENTS) expect(known, `unknown event: ${e}`).toContain(e);
  });
});

describe('the stream it subscribes to', () => {
  const read = async () => {
    const [fs, path] = await Promise.all([import('node:fs'), import('node:path')]);
    return fs.readFileSync(path.resolve(process.cwd(), 'src/lib/useCheckoutStream.ts'), 'utf8');
  };

  it('reuses the EXISTING POS stream rather than adding a seventh SSE endpoint', async () => {
    const src = await read();
    expect(src).toContain("streamPath: apiUrl('/realtime/stream')");   // BUILD_PLAN Phase 12: /api/v1/realtime/stream
    expect(src).not.toMatch(/streamPath: '\/mobile-checkout/);
  });

  it('uses the shared client, not a hand-rolled EventSource', async () => {
    const src = await read();
    expect(src).toContain('@aipowersalon/realtime-client');
    expect(src).not.toContain('new EventSource');
  });
});
