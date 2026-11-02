// follow-ups.ts — the rebook deep-link a follow-up message carries, as the customer app reads it (Constitution 13 §15).
// Realm: customer.

export interface RebookPreselect {
  salonId: string; tenantId: string; branchId: string; technicianId: string; serviceId: string | null; serviceName: string;
}
