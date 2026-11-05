import { api } from './client';

// posMembershipEnrollApi — tenant Memberships enrollment / reservation / redemption surface (`/pos/memberships/*`).
// Tenant + branch are derived from the session; the UI never sends them. Reserve returns a reservationRef that the
// caller carries to redeem (at Service Done) or release (on cancel); redeem records an immutable redemption and the
// commission snapshot server-side. Money is integer cents.
const enc = (s: string) => encodeURIComponent(s);

export const posMembershipEnrollApi = {
  enroll: (body: { customerId: string; planId: string; planVersionId?: string; autoRenewConsent?: boolean; assignedTechnicianId?: string | null; agreementVersion?: string | null; channel?: string }) =>
    api.post(`/pos/memberships/enroll`, body),
  customerMemberships: (customerId: string) => api.get(`/pos/memberships/customers/${enc(customerId)}/memberships`),
  // Batch member-status for a list of customers (one request for the whole page). Customers absent from the
  // response are non-members. Returns { members: [{ customerId, isMember, planName, status }] }.
  membersByCustomers: (customerIds: string[]) => api.post(`/pos/memberships/members/by-customers`, { customerIds }),
  memberBenefits: (membershipId: string) => api.get(`/pos/memberships/members/${enc(membershipId)}/benefits`),
  coverage: (ticketId: string) => api.get(`/pos/memberships/coverage/${enc(ticketId)}`),
  reserve: (body: { membershipId: string; benefitId: string; ticketId?: string | null; quantity?: number }) => api.post(`/pos/memberships/reserve`, body),
  release: (reservationRef: string) => api.post(`/pos/memberships/release`, { reservationRef }),
  redeem: (body: { membershipId: string; benefitId: string; ticketId?: string | null; serviceLineId?: string | null; technicianId?: string | null; reservationRef?: string | null; upgradeChargeCents?: number }) =>
    api.post(`/pos/memberships/redeem`, body),
  // Lifecycle — status change only (no charge, no refund). cancel at period end keeps benefits until the paid period
  // ends; immediate cancel is only valid from non-active statuses. Pass expectedVersion to get a 409 on a stale write.
  cancel: (body: { membershipId: string; atPeriodEnd?: boolean; reason?: string | null; expectedVersion?: number }) => api.post(`/pos/memberships/cancel`, body),
  pause: (body: { membershipId: string; resumesAt?: string | null; expectedVersion?: number }) => api.post(`/pos/memberships/pause`, body),
  resume: (body: { membershipId: string; expectedVersion?: number }) => api.post(`/pos/memberships/resume`, body),
};
