// BUILD_PLAN Phase 12 (#17): the Help Center routes' body validation, route by route on the real controller — the bodies
// pos-web sends today (posHelpCenterApi) and the shapes the handlers read pass intact, unknown fields are stripped, a
// bad body is a 400 VALIDATION_FAILED naming the field, an undeclared tenantId is refused.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { HelpController as H } from './help/help.controller';

const ID = '22222222-2222-4222-8222-222222222222';
const CASES: RouteBodyCase[] = [
  { route: 'POST /tenant/help/articles/:id/feedback', ctl: H, handler: 'feedback', today: [{ helpful: true }, { helpful: false, comment: 'outdated' }], bad: [{ helpful: 'yes' }, 'helpful'] },
  { route: 'POST /tenant/help/videos/:id/progress', ctl: H, handler: 'progress', today: [{ positionSeconds: 42, completed: false }], bad: [{ positionSeconds: [42] }, 'positionSeconds'] },
  { route: 'POST /tenant/help/assistant/ask', ctl: H, handler: 'ask', today: [{ question: 'How do I refund?' }, { question: 'And a gift card?', conversationId: ID }], bad: [{ question: { q: 1 } }, 'question'] },
  { route: 'POST /tenant/help/assistant/escalate', ctl: H, handler: 'escalate', today: [{ conversationId: ID, question: 'Printer', answer: 'Try restarting' }], bad: [{ question: 5 }, 'question'] },
  { route: 'POST /tenant/help/tickets', ctl: H, handler: 'createTicket', today: [{ subject: 'Printer offline', description: 'stopped at 9am', priority: 'high' }, { subject: 'x' }], bad: [{ subject: 'x', status: 'resolved' }, 'status'] },
  { route: 'POST /tenant/help/tickets/:id/reply', ctl: H, handler: 'replyTicket', today: [{ body: 'Still broken' }], bad: [{ body: ['x'] }, 'body'] },
  { route: 'POST /tenant/help/tickets/:id/csat', ctl: H, handler: 'submitCsat', today: [{ score: 5, comment: 'great' }], bad: [{ score: { s: 5 } }, 'score'] },
  { route: 'POST /tenant/help/tickets/:id/status', ctl: H, handler: 'ticketStatus', today: [{ status: 'in_progress', note: 'looking' }], bad: [{ status: 3 }, 'status'] },
  { route: 'POST /tenant/help/tickets/:id/assign', ctl: H, handler: 'ticketAssign', today: [{ agent: 'Kim' }], bad: [{ agent: [] }, 'agent'] },
  { route: 'POST /tenant/help/tickets/:id/priority', ctl: H, handler: 'ticketPriority', today: [{ priority: 'urgent' }], bad: [{ priority: true }, 'priority'] },
  { route: 'POST /tenant/help/tickets/:id/attachments', ctl: H, handler: 'uploadAttachment', today: [{ fileName: 'screen.png', contentType: 'image/png', data: 'iVBORw0KGgo=' }], bad: [{ fileName: 'a.png', data: 12 }, 'data'] },
  { route: 'POST /tenant/help/tickets/:id/notify', ctl: H, handler: 'ticketNotify', today: [{ channel: 'sms', to: '+16095551234', body: 'Fixed!' }], bad: [{ to: 6095551234 }, 'to'] },
  { route: 'POST /tenant/help/sessions', ctl: H, handler: 'createSession', today: [{ kind: 'callback', topic: 'payments', consentGranted: true, consentText: 'I agree', contactMethod: 'phone', contactValue: '+16095551234' }], bad: [{ kind: 'callback', consentGranted: 'yes' }, 'consentGranted'] },
];

describe('support — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => expect(routeBodyFailures(c, bodyPipeOf as any)).toEqual([]));
});
