// aiBookingSupportReport.test.ts — Extras AI Booking Assistant 14 "Evidence Export": the report keeps the trace and drops the private.
import { describe, it, expect } from 'vitest';
import { buildSupportReport, redactFreeText } from './aiBookingSupportReport';

const D: any = {
  requestId: 'req-0001-abcdef', status: 'failed', source: 'AI_PHONE_RECEPTIONIST', createdAt: '2026-11-03T15:00:00Z', updatedAt: '2026-11-03T15:02:00Z', customerName: 'Thảo Nguyễn', maskedPhone: '••• 1234', customerId: 'c1',
  branchId: 'b1', appointmentId: null, appointmentDate: null, appointmentTime: null, appointmentStatus: null, attempts: 2,
  customer: { customerId: 'c1', name: 'Thảo Nguyễn', maskedPhone: '••• 1234', verified: false, appointments: [] }, serviceLines: [],
  timeline: [{ stage: 'BOOKING_INTENT_DETECTED', outcome: null, failureReason: null, appointmentId: null, latencyMs: 120, at: '2026-11-03T15:00:00Z' },
    { stage: 'BOOKING_FAILED', outcome: 'error', failureReason: 'slot_taken', appointmentId: null, latencyMs: null, at: '2026-11-03T15:01:30Z' }],
  verification: [{ status: 'expired', channel: 'ai_receptionist', maskedPhone: '***-1234', attempts: 3, resends: 1, expiresAt: '2026-11-03T15:10:00Z', verifiedAt: null, failureReason: 'too_many_attempts', at: '2026-11-03T15:01:00Z' }],
  communications: [{ kind: 'verification_code', provider: 'sms', providerReference: 'VE1234567890abcdefWXYZ', sentAt: '2026-11-03T15:01:00Z', status: 'sent' }],
  holds: [{ holdId: 'h-1', status: 'expired', channel: 'ai_receptionist', startAt: '2026-11-04T14:00:00Z', endAt: '2026-11-04T15:00:00Z', expiresAt: '2026-11-03T15:11:00Z', releasedAt: '2026-11-03T15:11:05Z', releaseReason: 'hold_expired', convertedAppointmentId: null }],
  tools: [{ tool: 'create_appointment', kind: 'write', status: 'failed', result: null, error: 'Customer +1 (609) 555-0142 code 482913 jane@x.com', requests: 1, at: '2026-11-03T15:01:20Z', finishedAt: '2026-11-03T15:01:21Z' }],
};

describe('buildSupportReport', () => {
  it('keeps exact timestamps, statuses, stages, tool calls, holds and ids', () => {
    const r = buildSupportReport(D, '2026-11-12T20:00:00.000Z');
    expect(r).toContain('Request ID: req-0001-abcdef');
    expect(r).toContain('Generated at: 2026-11-12T20:00:00.000Z');
    expect(r).toContain('2026-11-03T15:01:30Z  BOOKING_FAILED · error · slot_taken');
    expect(r).toContain('2026-11-03T15:00:00Z  BOOKING_INTENT_DETECTED · 120 ms');
    expect(r).toContain('create_appointment (write) · failed · 1 req');
    expect(r).toContain('h-1  expired · ai_receptionist · 2026-11-04T14:00:00Z–2026-11-04T15:00:00Z');
    expect(r).toContain('tries 3/1');
  });
  it('drops the private: no customer name, phone only masked, provider ref last 4, numbers/e-mails in free text masked', () => {
    const r = buildSupportReport(D, '2026-11-12T20:00:00.000Z');
    expect(r).not.toContain('Thảo');
    expect(r).not.toContain('555-0142');
    expect(r).not.toContain('482913');
    expect(r).not.toContain('jane@x.com');
    expect(r).not.toContain('VE1234567890');
    expect(r).toContain('ref …WXYZ');
    expect(r).toContain('[phone …0142]');
    expect(r).toContain('Screenshots are not included');
    expect(redactFreeText(null)).toBe('—');
  });
});
