// skipLineApi.ts — Skip-the-Line Checkout client (customer app). Same-origin, session cookie; the server derives the
// customer + all money. The client never sends a tenantId or a final total.
import { api } from './client';
import type { BillLine, SkipLineSettings } from '@aipowersalon/api-contracts/customer';
// API contract types (§15): one definition in @aipowersalon/api-contracts, re-exported here so screens keep their imports.
export type { BillLine, SkipLineSettings } from '@aipowersalon/api-contracts/customer';

export interface ActiveBill {
  ticketId: string; invoiceId: string; ticketNumber: string; customerId: string | null; customerName: string;
  technicianId: string | null; technicianName: string; services: BillLine[];
  subtotalCents: number; discountCents: number; taxCents: number; tipCents: number; totalDueCents: number;
  ticketStatus: string; paid: boolean;
}
export interface ActiveBillResponse { bill: ActiveBill | null; enabledMethods: string[]; settings: SkipLineSettings; /** Fiserv §9.4: conditional credit-card surcharge to disclose before payment */ surcharge?: { applies: boolean; ratePercent: number } | null; }
export interface CashToTechResult { intentId: string; confirmationId: string; technicianId: string | null; technicianName: string; amountCents: number; status: string; }
export interface StartResult { intentId: string; ticketId: string; method: string; amountCents: number; gateway: string | null; configured: boolean; status: string; }
export interface ConfirmResult { paid?: boolean; status: string; paymentId?: string; amountCents?: number; processorTransactionId?: string | null; intentId?: string; configured?: boolean; disabledReason?: string; declineReason?: string; }
export interface PaymentStatus { intentId: string; status: string; amountCents: number; method: string; }

export const skipLineApi = {
  activeBill: () => api.get<ActiveBillResponse>('/customer/me/active-bill'),
  payCashToTech: (invoiceId: string) => api.post<CashToTechResult>(`/customer/payments/${invoiceId}/pay-cash-to-tech`),
  startPayment: (invoiceId: string, method: string, tipCents?: number) => api.post<StartResult>(`/customer/payments/${invoiceId}/start`, tipCents && tipCents > 0 ? { method, tipCents } : { method }),
  confirmPayment: (invoiceId: string, body: { intentId?: string; method?: string; token?: string; paymentMethodId?: string; expiry?: string }) => api.post<ConfirmResult>(`/customer/payments/${invoiceId}/confirm`, body),
  paymentStatus: (paymentId: string) => api.get<PaymentStatus>(`/customer/payments/${paymentId}/status`),
};
