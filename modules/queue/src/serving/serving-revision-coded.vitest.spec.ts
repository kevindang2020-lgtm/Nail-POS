// serving-revision-coded.vitest.spec.ts — Vietnamese POS §21 (Oct 27 2026): a serving revision's English summary is also
// returned as code + vars, derived at read time from the stored action + before / after (so OLD revisions are worded in
// the cashier's language too). Mirrors the English the service writes.
import { describe, it, expect } from 'vitest';
import { revisionSummaryCoded } from './serving.service';

describe('revisionSummaryCoded', () => {
  it('codes every action the service records', () => {
    expect(revisionSummaryCoded('service_added', null, { serviceName: 'Sơn gel' }, 'Added Sơn gel')).toEqual({ code: 'SERVING_REV.ADDED', vars: { service: 'Sơn gel' } });
    expect(revisionSummaryCoded('service_removed', JSON.stringify({ serviceName: 'Pedicure' }), null, null)).toEqual({ code: 'SERVING_REV.REMOVED', vars: { service: 'Pedicure' } });
    expect(revisionSummaryCoded('technician_assigned', { technicianName: null }, { technicianName: 'Trần Mỹ Linh' }, null)).toEqual({ code: 'SERVING_REV.TECHNICIAN', vars: { from: '—', to: 'Trần Mỹ Linh' } });
    expect(revisionSummaryCoded('helper_assigned', { technicianName: 'A' }, { technicianName: 'B' }, null)?.code).toBe('SERVING_REV.HELPER');
    expect(revisionSummaryCoded('service_started', null, {}, 'Service started')).toEqual({ code: 'SERVING_REV.STARTED' });
    expect(revisionSummaryCoded('service_resumed', null, {}, null)).toEqual({ code: 'SERVING_REV.RESUMED' });
    expect(revisionSummaryCoded('service_paused', null, { elapsedMinutes: 12 }, null)).toEqual({ code: 'SERVING_REV.PAUSED', vars: { minutes: 12 } });
    expect(revisionSummaryCoded('service_marked_done', null, { elapsedMinutes: 40 }, null)).toEqual({ code: 'SERVING_REV.MARKED_DONE', vars: { minutes: 40 } });
    expect(revisionSummaryCoded('service_done_locked', null, { lockedTotalCents: 9500 }, null)).toEqual({ code: 'SERVING_REV.LOCKED', vars: { cents: 9500 } });
    expect(revisionSummaryCoded('service_done_reopened', {}, { reason: 'khách đổi màu' }, null)).toEqual({ code: 'SERVING_REV.REOPENED', vars: { reason: 'khách đổi màu' } });
  });
  it('an update lists its changed parts as nested "@key#pN" references', () => {
    const c = revisionSummaryCoded('service_updated', { serviceName: 'Gel', priceCents: 4500, technicianName: 'A', status: 'assigned' }, { serviceName: 'Gel', priceCents: 5000, technicianName: 'A', status: 'serving' }, null)!;
    expect(c.code).toBe('SERVING_REV.UPDATED_PARTS_2');
    expect(c.vars).toMatchObject({ service: 'Gel', p0: '@srv.SERVING_REV.PART_PRICE#p0', p0_from: 4500, p0_to: 5000, p1: '@srv.SERVING_REV.PART_STATUS#p1', p1_from: '@status.techTicket.assigned', p1_to: '@status.techTicket.serving' });
    expect(revisionSummaryCoded('service_updated', { serviceName: 'Gel', priceCents: 1 }, { serviceName: 'Gel', priceCents: 1 }, null)).toEqual({ code: 'SERVING_REV.UPDATED', vars: { service: 'Gel' } });
  });
  it('unknown actions and unreadable data → null (the POS shows the stored English)', () => {
    expect(revisionSummaryCoded('something_else', null, null, 'x')).toBeNull();
    expect(revisionSummaryCoded('service_paused', null, '{not json', null)).toBeNull();
  });
});
