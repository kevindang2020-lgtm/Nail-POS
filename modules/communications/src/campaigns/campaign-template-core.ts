// Pure, DB-free engine for reusable campaign templates: validate input, gate publishing, and compute the next
// version. Versioning is monotonic — editing a template creates a new version rather than overwriting a prior one.

export type TemplateChannel = 'email' | 'sms' | 'push' | 'in_app' | 'multi';
export type TemplateStatus = 'draft' | 'published' | 'archived';

const CHANNELS = new Set(['email', 'sms', 'push', 'in_app', 'multi']);

export interface TemplateInput {
  name?: string | null;
  channel?: string | null;
  subject?: string | null;
  body?: string | null;
  smsContent?: string | null;
  pushTitle?: string | null;
  pushContent?: string | null;
}

export function validateTemplateInput(input: TemplateInput): { errors: string[] } {
  const errors: string[] = [];
  if (!String(input.name ?? '').trim()) errors.push('A template name is required.');
  const channel = String(input.channel ?? 'email');
  if (!CHANNELS.has(channel)) errors.push('Channel must be one of email, sms, push, in_app, multi.');
  // Require content appropriate to the channel so a published template is actually usable.
  const hasEmail = !!String(input.subject ?? '').trim() || !!String(input.body ?? '').trim();
  const hasSms = !!String(input.smsContent ?? '').trim();
  const hasPush = !!String(input.pushTitle ?? '').trim() || !!String(input.pushContent ?? '').trim();
  const hasAny = hasEmail || hasSms || hasPush;
  if (!hasAny) errors.push('Provide some content (subject/body, SMS, or push).');
  return { errors };
}

export const canPublish = (status: TemplateStatus): boolean => status === 'draft' || status === 'published';
export const nextVersion = (current: number): number => Math.max(1, Math.trunc(current)) + 1;
