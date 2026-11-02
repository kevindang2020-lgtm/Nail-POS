// serving-lifecycles.vitest.spec — PAY merge (Oct 12 2026): the two durable Serving vocabularies are state machines and
// every write is guarded by canMoveToSql (check:state-transitions). Pins the moves the code makes and the ones it refuses.
import { describe, it, expect } from 'vitest';
import { TICKET_SERVICE_SESSION, SERVING_DELAY } from '../queue-lifecycles';

describe('ticket_service_sessions.status (586)', () => {
  it('STARTED ⇄ PAUSED, both complete; a COMPLETED session only re-opens to STARTED (Service Done reopen)', () => {
    expect(TICKET_SERVICE_SESSION.can('STARTED', 'PAUSED')).toBe(true);
    expect(TICKET_SERVICE_SESSION.can('PAUSED', 'STARTED')).toBe(true);
    expect(TICKET_SERVICE_SESSION.can('STARTED', 'COMPLETED')).toBe(true);
    expect(TICKET_SERVICE_SESSION.can('PAUSED', 'COMPLETED')).toBe(true);
    expect(TICKET_SERVICE_SESSION.can('COMPLETED', 'STARTED')).toBe(true);
    expect(TICKET_SERVICE_SESSION.can('COMPLETED', 'PAUSED')).toBe(false);
    expect(TICKET_SERVICE_SESSION.sourcesOf('PAUSED')).toEqual(['STARTED']);
  });
});
describe('tickets.serving_delay_status (586)', () => {
  it('any level may move to any other (a delay is re-reported or cleared freely); unknown levels are refused', () => {
    for (const a of ['none', 'warning', 'late', 'critical']) for (const b of ['none', 'warning', 'late', 'critical']) expect(SERVING_DELAY.can(a, b)).toBe(true);
    expect(SERVING_DELAY.can('none', 'severe' as any)).toBe(false);
  });
});
