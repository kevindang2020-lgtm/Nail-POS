// follow-up-status.ts — the end-of-day follow-up lifecycle, shared by the tenant realm (staff screens) and the customer
// realm (a customer's own follow-up). Realm-neutral, so it lives at the package root. Types only.
export type FollowUpStatus =
  | 'pending' | 'pending_manager_approval' | 'sent' | 'skipped' | 'dismissed' | 'failed' | 'customer_not_available' | 'customer_replied' | 'rebooked' | 'expired';
