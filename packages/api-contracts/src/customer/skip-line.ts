// skip-line.ts — skip-the-line checkout as the customer app sees it (Constitution 13 §13, §15). Realm: customer.

export interface BillLine { serviceLineId: string; serviceName: string; technicianId?: string | null; priceCents: number; }
export interface SkipLineSettings {
  featureEnabled: boolean; autoSendPromptOnServiceDone: boolean; requireFrontDeskApproval: boolean;
  allowCashToTechnician: boolean; requireTechConfirmationForCash: boolean; managerApprovalOverCents: number;
}

/** POST /customer/payments/:paymentId/verify — B-80 (Oct 23 2026): "Check status" of my card payment the processor did
 *  not confirm. Asks the processor; never charges. */
export interface SkipLinePaymentVerifyResult { intentId: string; ticketId: string; status: string; outcome: 'approved' | 'declined' | 'released' | 'pending' | 'unknown' | 'review'; reason?: string; paymentId?: string }

