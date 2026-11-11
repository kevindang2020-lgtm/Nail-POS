// report-delivery.ts — Daily Summary "Email Report" / "Schedule Report" (Nov 10 2026). The recipient is always the signed-in
// staff member's own account e-mail; a schedule belongs to that person alone (migration 845).
export type ReportEmailFrequency = 'daily' | 'weekly';
export type ReportEmailSender = 'delivers' | 'simulated' | 'not_configured';
export type ReportEmailOutcome = 'pending' | 'sent' | 'simulated' | 'failed' | 'not_configured' | 'skipped';
export interface ReportEmailSubscription { id: string; frequency: ReportEmailFrequency; sendAt: string; active: boolean; consentedAt: string }
export interface ReportEmailDelivery { id: string; kind: 'now' | 'scheduled'; periodFrom: string; periodTo: string; status: ReportEmailOutcome; detail: string | null; createdAt: string }
export interface ReportEmailState {
  /** financial view + export: may e-mail the figures */
  canSend: boolean;
  /** masked own address ("k***@example.com"), null when the account has none */
  email: string | null; hasEmail: boolean;
  sender: ReportEmailSender;
  /** is the hourly schedule job running on this server */
  scheduleRunning: boolean;
  subscription: ReportEmailSubscription | null;
  deliveries: ReportEmailDelivery[];
}
export interface ReportEmailSendResult { id: string | null; status: ReportEmailOutcome; detail: string | null }
