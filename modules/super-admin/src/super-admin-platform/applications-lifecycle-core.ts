// applications-lifecycle-core.ts — the application-intake state machine (Free POS Package spec, Jul 2026).
// Pure + Nest-free. The canonical lifecycle is the spec's 16 statuses; the three LEGACY values that existing rows
// and the current admin-web screen already use (reviewing ≈ under_review, demo_scheduled, converted ≈
// converted_tenant) remain valid states with equivalent transitions, so no data migration and no screen breakage.
// `archived` is terminal. Approval/rejection stamps and side effects live in the service — this file only answers
// "is from → to legal?".

export const APPLICATION_STATUSES = [
  'new',
  'under_review', 'reviewing',            // reviewing = legacy alias of under_review
  'contact_attempted', 'contacted', 'info_requested', 'awaiting_applicant', 'demo_scheduled',
  'qualified', 'not_qualified',
  'approved', 'rejected',
  'converted_onboarding', 'converted_tenant', 'converted', // converted = legacy alias of converted_tenant
  'duplicate', 'spam', 'withdrawn',
  'archived',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const APPLICATION_CONTACT_CHANNELS = ['phone', 'sms', 'email'] as const;

// The working set an application moves freely within while it is being reviewed/contacted.
const ACTIVE: ApplicationStatus[] = [
  'under_review', 'reviewing', 'contact_attempted', 'contacted', 'info_requested', 'awaiting_applicant', 'demo_scheduled', 'qualified',
];
const CLOSEABLE: ApplicationStatus[] = ['not_qualified', 'duplicate', 'spam', 'withdrawn', 'archived'];

const T: Record<ApplicationStatus, ApplicationStatus[]> = {
  new: [...ACTIVE, ...CLOSEABLE, 'approved', 'rejected'],
  under_review: [...ACTIVE, ...CLOSEABLE, 'approved', 'rejected'],
  reviewing: [...ACTIVE, ...CLOSEABLE, 'approved', 'rejected'],
  contact_attempted: [...ACTIVE, ...CLOSEABLE, 'approved', 'rejected'],
  contacted: [...ACTIVE, ...CLOSEABLE, 'approved', 'rejected'],
  info_requested: [...ACTIVE, ...CLOSEABLE, 'approved', 'rejected'],
  awaiting_applicant: [...ACTIVE, ...CLOSEABLE, 'approved', 'rejected'],
  demo_scheduled: [...ACTIVE, ...CLOSEABLE, 'approved', 'rejected'],
  qualified: [...ACTIVE, ...CLOSEABLE, 'approved', 'rejected'],
  not_qualified: ['under_review', 'reviewing', 'archived'],
  approved: ['converted_onboarding', 'converted_tenant', 'converted', 'archived'],
  rejected: ['under_review', 'reviewing', 'archived'],
  converted_onboarding: ['converted_tenant', 'converted', 'archived'],
  converted_tenant: ['archived'],
  converted: ['archived'],
  duplicate: ['under_review', 'reviewing', 'archived'],
  spam: ['under_review', 'reviewing', 'archived'],
  withdrawn: ['under_review', 'reviewing', 'archived'],
  archived: [], // terminal
};

export function canTransitionApplication(from: string, to: string): boolean {
  if (from === to) return false;
  const allowed = T[from as ApplicationStatus];
  if (!allowed) return false; // unknown legacy value: force a review step first via explicit correction
  return allowed.includes(to as ApplicationStatus);
}
