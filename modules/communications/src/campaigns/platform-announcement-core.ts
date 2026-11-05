// Pure, DB-free engine for platform announcements: validate input and gate lifecycle transitions. Enforces the
// platform/tenant boundary at the type level (an announcement targets tenants, never a tenant's customers).
import { PLATFORM_ANNOUNCEMENT } from '../communications-lifecycles';

export type AnnouncementChannel = 'email' | 'sms' | 'push' | 'in_app';
export type AudienceScope = 'all_tenants' | 'selected_tenants';
export type AnnouncementStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';

export interface AnnouncementInput {
  title?: string | null;
  body?: string | null;
  channel?: string | null;
  audienceScope?: string | null;
  tenantIds?: string[];
  scheduledAt?: string | null;
}

const CHANNELS = new Set(['email', 'sms', 'push', 'in_app']);
const SCOPES = new Set(['all_tenants', 'selected_tenants']);

export function validateAnnouncementInput(input: AnnouncementInput, opts: { now?: number } = {}): { errors: string[] } {
  const errors: string[] = [];
  if (!String(input.title ?? '').trim()) errors.push('A title is required.');
  const channel = String(input.channel ?? 'email');
  if (!CHANNELS.has(channel)) errors.push('Channel must be one of email, sms, push, in_app.');
  const scope = String(input.audienceScope ?? 'selected_tenants');
  if (!SCOPES.has(scope)) errors.push('Audience scope must be all_tenants or selected_tenants.');
  if (scope === 'selected_tenants' && !(input.tenantIds && input.tenantIds.filter(Boolean).length > 0)) {
    errors.push('Select at least one tenant for a selected-tenants announcement.');
  }
  if (input.scheduledAt) {
    const t = Date.parse(input.scheduledAt);
    if (Number.isNaN(t)) errors.push('Scheduled time is not a valid date.');
    else if (t < (opts.now ?? Date.now())) errors.push('Scheduled time must be in the future.');
  }
  return { errors };
}

// Allowed lifecycle transitions. Sending/sent are terminal-ish; cancelled is terminal.
// Phase 12 (#27): the table is the PLATFORM_ANNOUNCEMENT machine (communications-lifecycles.ts), enforced again by the
// repository's conditional update.
export function canTransition(from: AnnouncementStatus, to: AnnouncementStatus): boolean {
  return PLATFORM_ANNOUNCEMENT.can(from, to);
}

export function initialStatus(input: AnnouncementInput): AnnouncementStatus {
  return input.scheduledAt ? 'scheduled' : 'draft';
}
