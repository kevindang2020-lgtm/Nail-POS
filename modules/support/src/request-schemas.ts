// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the Help Center (support module) request-body schemas, applied with
// @Body(ValidatedBody(SCHEMA)). Written from HelpController (the keys each handler reads) and the services behind it
// (sanitizeTicketInput, sanitizeSessionInput, validateAttachmentUpload — which keep their own rules and clamps) and from
// pos-web posHelpCenterApi (createTicket, uploadAttachment). Unknown fields are stripped; a ticket body cannot set its
// own status / assignee (those move only through the triage routes).
import { S, type BodySchema } from '@aipowersalon/permissions';

const text = (max: number): BodySchema => S.nullable(S.text(max));
const TICKET_FORBIDDEN: BodySchema['x-forbidden'] = ['status', 'assignedAgent', 'assigned_agent', 'needsReview'];

export const HELP_ARTICLE_FEEDBACK_BODY: BodySchema = S.object({ helpful: S.nullable(S.boolean()), comment: text(2000) });
export const HELP_VIDEO_PROGRESS_BODY: BodySchema = S.object({ positionSeconds: { type: ['number', 'string', 'null'], maxLength: 16 }, completed: S.nullable(S.boolean()) });
export const HELP_ASK_BODY: BodySchema = S.object({ question: text(4000), conversationId: text(64) });
export const HELP_ESCALATE_BODY: BodySchema = S.object({ conversationId: text(64), question: text(4000), answer: text(20000) });
export const HELP_TICKET_CREATE_BODY: BodySchema = S.object({
  subject: text(1000), description: text(20000), category: text(64), subcategory: text(500), priority: text(32),
  affectedModule: text(500), appVersion: text(200), idempotencyKey: text(500),
}, [], { 'x-forbidden': TICKET_FORBIDDEN });
export const HELP_TICKET_REPLY_BODY: BodySchema = S.object({ body: text(20000) });
export const HELP_TICKET_CSAT_BODY: BodySchema = S.object({ score: { type: ['number', 'string', 'null'], maxLength: 4 }, comment: text(2000) });
export const HELP_TICKET_STATUS_BODY: BodySchema = S.object({ status: text(32), note: text(2000) });
export const HELP_TICKET_ASSIGN_BODY: BodySchema = S.object({ agent: text(500) });
export const HELP_TICKET_PRIORITY_BODY: BodySchema = S.object({ priority: text(32) });
/** base64 file data: a 5 MB file is ~7 M characters; the service decodes, sniffs the bytes and enforces the 5 MB limit */
export const HELP_ATTACHMENT_BODY: BodySchema = S.object({ fileName: text(500), contentType: text(200), data: text(8_000_000) });
export const HELP_TICKET_NOTIFY_BODY: BodySchema = S.object({ channel: text(16), to: text(320), body: text(2000) });
export const HELP_SESSION_BODY: BodySchema = S.object({
  kind: text(32), topic: text(1000), ticketId: text(64), consentGranted: S.nullable(S.boolean()), consentText: text(4000), contactMethod: text(32), contactValue: text(320),
}, [], { 'x-forbidden': ['status'] });
