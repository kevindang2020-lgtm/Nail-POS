// ai-business-incidents.ts — wire types for the A2 AI Business Alerts incidents + notification settings (Nov 6 2026).
// Server: modules/analytics/src/ai-business/business-alert-incidents.ts. Client: apps/pos-web screens/ai-business/AlertIncidents.tsx.
export type AlertIncidentStatus = 'open' | 'investigating' | 'snoozed' | 'resolved';
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertChannel = 'in_app' | 'email' | 'sms';
export interface AlertIncidentListItem { eventId: string; title: string; severity: AlertSeverity; incidentStatus: AlertIncidentStatus; version: number; evaluatedAt: string | null; snoozedUntil: string | null; assignee: string | null; display: { value: string; threshold: string } }
export interface AlertIncidentListResponse { status: string; page: number; limit: number; total: number; counts: Partial<Record<AlertIncidentStatus, number>>; items: AlertIncidentListItem[] }
export interface AlertIncidentDetail {
  eventId: string; alertId: string; title: string; severity: AlertSeverity; metricId: string; operator: string; value: number | null; threshold: number;
  display: { value: string; threshold: string }; evaluatedAt: string | null; incidentStatus: AlertIncidentStatus; version: number;
  assignee: { userId: string; name: string | null } | null; snoozedUntil: string | null; acknowledgedAt: string | null; acknowledgedBy: string | null;
  resolvedAt: string | null; resolvedBy: string | null; resolutionNote: string | null; escalatedAt: string | null;
  log: { kind: string; body: string; at: string | null; by: string | null }[];
  deliveries: { channel: AlertChannel; kind: 'trigger' | 'escalation'; status: 'sent' | 'skipped' | 'failed'; reason: string | null; to: string | null; at: string | null }[];
}
export interface AlertIncidentActionRequest { action: 'acknowledge' | 'investigate' | 'resolve' | 'snooze' | 'reopen' | 'assign'; expectedVersion: number; note?: string | null; assigneeUserId?: string | null; snoozeMinutes?: number | null }
export interface AlertIncidentActionResponse { eventId: string; incidentStatus: AlertIncidentStatus; version: number }
export interface AlertIncidentNoteRequest { note: string }
export interface AlertDeliverySettings { alertId: string; severity: AlertSeverity; channels: AlertChannel[]; recipientUserIds: string[]; quietHoursStart: number; quietHoursEnd: number; cooldownMinutes: number }
/** extras AI Business Alerts 08 — what one trigger would text and cost with the SAVED settings (read-only estimate) */
export interface AlertSmsPlan {
  recipients: number; recipientsWithPhone: number; recipientsWithoutPhone: number;
  segmentsPerMessage: number; encoding: 'GSM-7' | 'UCS-2'; segmentsPerTrigger: number;
  /** the salon's own average provider cost per segment over its last 30 days of texts; null = none reported */
  costBasis: 'salon_provider_average_30d'; perSegmentMicros: number | null; estimatedCostCentsPerTrigger: number | null;
  senderConfigured: boolean; senderValidatedAt: string | null;
  limits: { dailyLimit: number | null; monthlySms: number | null; enforcement: string; active: boolean } | null;
  loopGuards: { cooldownMinutes: number; escalateOnceAfterMinutes: number; quietHours: boolean; sentByRuleLast24h: number; alertSmsSentLast24h: number };
  warnings: ('no_phone_recipients' | 'sender_not_configured' | 'no_cooldown')[];
}
export interface AlertDeliverySettingsResponse extends AlertDeliverySettings { staff: { userId: string; name: string; role: string; hasEmail: boolean; hasPhone: boolean }[]; smsPlan?: AlertSmsPlan }
export interface AlertDeliveryUpdateRequest { severity?: AlertSeverity; channels?: AlertChannel[]; recipientUserIds?: string[]; quietHoursStart?: number; quietHoursEnd?: number; cooldownMinutes?: number }
