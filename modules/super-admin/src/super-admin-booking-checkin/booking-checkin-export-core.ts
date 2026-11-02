// booking-checkin-export-core.ts — pure shaping for the server-side audited Booking & Check-In Monitor export.
// Reuses the canonical injection-guarded CSV builder (toCsv) so a cell beginning with = + - @ can't become a
// spreadsheet formula (CWE-1236). Safe columns only — never secrets, tokens, payment data, or unnecessary PII.
// Honest rendering: gaps render as "—", never fabricated.
import { toCsv } from '@aipowersalon/reports';

export type BookingCheckinExportType = 'failed-events' | 'overview';

export const FAILED_EVENTS_EXPORT_HEADERS = ['Event ID', 'Branch', 'Category', 'Source', 'Check-In Method', 'Failure Type', 'Error Code', 'Safe Message', 'Correlation ID', 'Retry Status', 'Attempts', 'Occurred At'];

export interface ExportableFailedEvent {
  eventCode?: string; branch?: string; category?: string; source?: string; checkInMethod?: string;
  failureType?: string; errorCode?: string; errorMessage?: string; correlationId?: string; retryStatus?: string;
  attemptCount?: number; occurredAt?: string;
}

const iso = (s?: string) => (s ? (isNaN(Date.parse(s)) ? '—' : new Date(s).toISOString()) : '—');

export function failedEventExportRow(e: ExportableFailedEvent): (string | number)[] {
  return [
    e.eventCode || '—', e.branch || '—', e.category || '—', e.source || '—', e.checkInMethod || '—',
    e.failureType || '—', e.errorCode || '—', e.errorMessage || '—', e.correlationId || '—', e.retryStatus || '—',
    Number(e.attemptCount || 0), iso(e.occurredAt),
  ];
}

export function failedEventsExportCsv(rows: ExportableFailedEvent[]): string {
  return toCsv(FAILED_EVENTS_EXPORT_HEADERS, rows.map(failedEventExportRow));
}

export const OVERVIEW_EXPORT_HEADERS = ['KPI', 'Value', 'Δ vs prior', 'Trend', 'Available'];

export interface ExportableKpi { label?: string; display?: string; value?: number; deltaPct?: number; direction?: string; available?: boolean }

export function overviewExportRow(k: ExportableKpi): (string | number)[] {
  return [
    k.label || '—',
    k.available === false ? '—' : (k.display ?? (k.value ?? '—')),
    k.available === false ? '—' : (typeof k.deltaPct === 'number' ? `${k.deltaPct > 0 ? '+' : ''}${k.deltaPct}%` : '—'),
    k.direction || '—',
    k.available === false ? 'No' : 'Yes',
  ];
}

export function overviewExportCsv(kpis: ExportableKpi[]): string {
  return toCsv(OVERVIEW_EXPORT_HEADERS, kpis.map(overviewExportRow));
}

/** Build a scope/timestamp-stamped filename for the export. */
export function bookingCheckinExportFilename(type: BookingCheckinExportType, now: Date = new Date()): string {
  return `booking-checkin-${type}-${now.toISOString().slice(0, 10)}.csv`;
}
