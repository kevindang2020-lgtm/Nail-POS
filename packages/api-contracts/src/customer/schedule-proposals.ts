// schedule-proposals.ts — BUILD_PLAN Phase 7: a salon asks a customer to approve a new time / technician for a booked
// appointment. The original appointment stays exactly as booked until the customer approves (and the salon applies).
// Routes (customer session): GET /customer/schedule-proposals, POST /customer/schedule-proposals/:id/approve|reject.
export type CustomerScheduleProposalStatus = 'proposed' | 'customer_notified' | 'customer_approved' | 'customer_rejected' | 'expired' | 'applied' | 'withdrawn';
export interface CustomerScheduleProposal {
  id: string;
  salonName: string; branchName: string | null;
  appointmentId: string;
  services: string[];                                   // service names, display only
  original: { date: string; startTime: string; technicianName: string | null };
  proposed: { date: string; startTime: string; technicianName: string | null };
  reason: string | null;                                // the salon's short, customer-safe reason (never internal metrics)
  status: CustomerScheduleProposalStatus;
  expiresAt: string | null;
  version: number;
}
export interface CustomerScheduleProposalList { items: CustomerScheduleProposal[] }
export interface CustomerScheduleProposalDecision { expectedVersion: number }
export interface CustomerScheduleProposalResponse { proposal: CustomerScheduleProposal }
