import { describe, it, expect } from 'vitest';
import { failedEventsExportCsv, overviewExportCsv, failedEventExportRow, FAILED_EVENTS_EXPORT_HEADERS, bookingCheckinExportFilename } from './booking-checkin-export-core';

describe('booking-checkin export core', () => {
  it('emits the expected failed-events header row', () => {
    const csv = failedEventsExportCsv([]);
    expect(csv.split('\n')[0]).toContain('Event ID');
    expect(FAILED_EVENTS_EXPORT_HEADERS).toContain('Correlation ID');
  });

  it('renders gaps honestly as em dash', () => {
    const row = failedEventExportRow({ eventCode: 'EVT-1' });
    expect(row[1]).toBe('—'); // branch missing
    expect(row[11]).toBe('—'); // occurredAt missing
  });

  it('neutralizes CSV formula injection in cell values', () => {
    const csv = failedEventsExportCsv([{ eventCode: '=cmd|calc', branch: '@evil', failureType: '+1', errorCode: '-2' }]);
    // each dangerous leading char is prefixed with a single quote by toCsv
    expect(csv).toContain("'=cmd");
    expect(csv).toContain("'@evil");
    expect(csv).toContain("'+1");
    expect(csv).toContain("'-2");
  });

  it('does not include secret/token/payment columns', () => {
    const header = failedEventsExportCsv([]).split('\n')[0].toLowerCase();
    for (const bad of ['token', 'secret', 'password', 'card', 'cvv', 'api_key', 'authorization']) expect(header).not.toContain(bad);
  });

  it('marks unavailable KPIs honestly', () => {
    const csv = overviewExportCsv([{ label: 'Booking API Failures', value: 3, deltaPct: 22.7, direction: 'up', available: true }, { label: 'Avg Check-In Time', available: false }]);
    const lines = csv.split('\n');
    expect(lines[1]).toContain('Booking API Failures');
    expect(lines[2]).toContain('Avg Check-In Time');
    expect(lines[2]).toContain('No'); // available = No
  });

  it('builds a dated filename', () => {
    expect(bookingCheckinExportFilename('failed-events', new Date('2026-06-30T12:00:00Z'))).toBe('booking-checkin-failed-events-2026-06-30.csv');
  });
});
