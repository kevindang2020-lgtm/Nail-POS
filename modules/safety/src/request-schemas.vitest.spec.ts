// BUILD_PLAN Phase 12 (#17): the safety routes' body validation (Tenant Safety Community, Super Admin moderation, AI OCR
// receipts), route by route on the real controllers — the bodies pos-web / admin-web send today (posCommunityApi,
// superAdminCommunityModerationApi, posAiOcrReceiptApi) pass intact, unknown fields are stripped (kept on the settings
// routes, whose parsers refuse them), a bad body is a 400 VALIDATION_FAILED naming the field, an undeclared tenantId is refused.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { CommunityController as C } from './tenant-safety-community/community.controller';
import { CommunityInteractionsController as I } from './tenant-safety-community/community-interactions.controller';
import { CommunityModerationController as M } from './tenant-safety-community/community-moderation.controller';
import { AiOcrReceiptController as O } from './ai-ocr-receipt/ai-ocr-receipt.controller';
import { COMMUNITY_SETTINGS_BODY } from './request-schemas';
import { validateBody } from '@aipowersalon/permissions';

const ID = '22222222-2222-4222-8222-222222222222';
const ADV = { category: 'card_testing', severity: 'high', title: 'Card testing wave', body: 'Many small declined card charges overnight', region: 'NJ', incidentDate: '2026-10-01', channels: ['phone'], tags: ['cards'], authorDisplay: 'salon_name' };
const CASES: RouteBodyCase[] = [
  { route: 'POST /community/rules/acknowledge', ctl: C, handler: 'acknowledge', today: [{ rulesVersion: '2026-09' }], bad: [{ rulesVersion: 9 }, 'rulesVersion'] },
  { route: 'POST /community/advisories/assist', ctl: C, handler: 'assist', today: [{ body: 'Someone called claiming to be the processor' }], bad: [{ body: ['x'] }, 'body'] },
  { route: 'POST /community/advisories', ctl: C, handler: 'create', today: [ADV, { ...ADV, fromIncidentId: ID }], bad: [{ ...ADV, status: 'published_verified' }, 'status'] },
  { route: 'PUT /community/advisories/:id', ctl: C, handler: 'update', today: [{ expectedVersion: 2, title: 'Card testing wave (update)', changeNote: 'typo' }], bad: [{ expectedVersion: 2, tags: 'cards' }, 'tags'] },
  { route: 'PUT /community/posts/:id', ctl: C, handler: 'edit', today: [{ expectedVersion: 5, recommendation: 'Enable AVS', changeNote: null }], bad: [{ expectedVersion: { v: 5 } }, 'expectedVersion'] },
  { route: 'POST /community/advisories/:id/submit', ctl: C, handler: 'submit', today: [{ expectedVersion: 1 }, { expectedVersion: 1, officialReportReferenced: true }], bad: [{ expectedVersion: 1, officialReportReferenced: {} }, 'officialReportReferenced'] },
  { route: 'POST /community/advisories/:id/approve', ctl: C, handler: 'approve', today: [{ expectedVersion: 3 }], bad: [{ expectedVersion: 3, visibility: 'community_published' }, 'visibility'] },
  { route: 'POST /community/advisories/:id/return', ctl: C, handler: 'returnForCorrection', today: [{ expectedVersion: 3, note: 'remove the phone number' }], bad: [{ expectedVersion: 3, note: 7 }, 'note'] },
  { route: 'POST /community/advisories/:id/withdraw', ctl: C, handler: 'withdraw', today: [{ expectedVersion: 4 }], bad: [{ expectedVersion: [4] }, 'expectedVersion'] },
  { route: 'POST /community/posts/:id/updates', ctl: C, handler: 'addUpdate', today: [{ body: 'Processor confirmed' }], bad: [{ body: { t: 1 } }, 'body'] },
  { route: 'POST /community/posts/:id/resolve', ctl: C, handler: 'resolve', today: [{ expectedVersion: 6, note: 'resolved' }], bad: [{ expectedVersion: 6, status: 'resolved' }, 'status'] },
  { route: 'POST /community/posts/:id/report', ctl: C, handler: 'report', today: [{ reason: 'contains_personal_info', detail: 'phone number' }], bad: [{ reason: 1 }, 'reason'] },
  { route: 'POST /community/posts/:id/dispute', ctl: C, handler: 'dispute', today: [{ reason: 'This is about our salon and it is wrong', raisedByKind: 'subject' }], bad: [{ reason: null, raisedByKind: 2 }, 'raisedByKind'] },
  { route: 'POST /community/posts/:id/appeal', ctl: C, handler: 'appeal', today: [{ subject: 'post_rejected', reason: 'we removed the name' }, { subject: 'comment_removed', reason: 'it was fair', commentId: ID }], bad: [{ subject: ['x'], reason: 'r' }, 'subject'] },
  { route: 'POST /community/incidents', ctl: C, handler: 'createIncident', today: [{ category: 'card_testing', severity: 'moderate', occurredOn: '2026-10-07', rawDetail: 'three declines' }], bad: [{ category: 'x', rawDetail: 5 }, 'rawDetail'] },
  { route: 'PUT /community/settings', ctl: C, handler: 'updateSettings', keepsUnknown: true, today: [{ expectedVersion: 0, enabled: true, notify: { push: true, categories: ['card_testing'] }, roleGrants: { MANAGER: ['approve_advisory'] } }], bad: [{ expectedVersion: 0, regionPreferences: 'NJ' }, 'regionPreferences'] },
  { route: 'POST /community/posts/:id/comments', ctl: I, handler: 'addComment', today: [{ body: 'Same here' }, { body: 'reply', parentId: ID }], bad: [{ body: 'x', parentId: 5 }, 'parentId'] },
  { route: 'PUT /community/comments/:id', ctl: I, handler: 'editComment', today: [{ body: 'Same here (edited)', expectedVersion: 1 }], bad: [{ body: [] }, 'body'] },
  { route: 'POST /community/comments/:id/report', ctl: I, handler: 'reportComment', today: [{ reason: 'harassment' }], bad: [{ reason: 'harassment', detail: {} }, 'detail'] },
  { route: 'POST /community/posts/:id/similar', ctl: I, handler: 'similar', today: [{}, { note: 'two calls', occurredOn: '2026-10-06' }], bad: [{ note: 7 }, 'note'] },
  { route: 'POST /community/follows', ctl: I, handler: 'createFollow', today: [{ category: 'card_testing', region: 'NJ', severityMin: 'high', channels: ['in_app', 'push'] }], bad: [{ channels: 'push' }, 'channels'] },
  { route: 'POST /community/evidence/uploads', ctl: I, handler: 'requestUpload', today: [{ postId: ID, mimeType: 'image/png', sizeBytes: 12345, sha256: 'a'.repeat(64) }], bad: [{ mimeType: 'image/png', sizeBytes: '12345' }, 'sizeBytes'] },
  { route: 'POST /super-admin/community-moderation/posts/:id/actions', ctl: M, handler: 'postAction', today: [{ action: 'publish', reason: 'verified with processor', expectedVersion: 3 }, { action: 'redact', reason: 'phone number', expectedVersion: 3, redactions: [{ field: 'body', find: '555-1234' }] }], bad: [{ action: 'redact', reason: 'r', expectedVersion: 3, redactions: [{ field: 'body', find: 5 }] }, 'redactions[0].find'] },
  { route: 'POST /super-admin/community-moderation/comments/:id/actions', ctl: M, handler: 'commentAction', today: [{ action: 'remove', reason: 'harassment', caseId: ID }], bad: [{ action: 'remove', reason: {} }, 'reason'] },
  { route: 'POST /super-admin/community-moderation/cases', ctl: M, handler: 'openCase', today: [{ kind: 'post_review', reason: 'escalated', priority: 'high', postId: ID }], bad: [{ kind: 'post_review', postId: 9 }, 'postId'] },
  { route: 'PATCH /super-admin/community-moderation/cases/:id', ctl: M, handler: 'updateCase', today: [{ assignToMe: true }, { status: 'resolved', resolutionNote: 'done' }], bad: [{ assignToMe: 'yes' }, 'assignToMe'] },
  { route: 'POST /super-admin/community-moderation/reports/:id/resolve', ctl: M, handler: 'resolveReport', today: [{ resolution: 'dismissed', reason: 'not a violation' }], bad: [{ resolution: 1 }, 'resolution'] },
  { route: 'POST /super-admin/community-moderation/disputes/:id/decide', ctl: M, handler: 'decideDispute', today: [{ decision: 'corrected', note: 'name removed' }], bad: [{ decision: 'upheld', note: [] }, 'note'] },
  { route: 'POST /super-admin/community-moderation/appeals/:id/decide', ctl: M, handler: 'decideAppeal', today: [{ decision: 'overturn', note: 'fair appeal', allowSameDecider: false }], bad: [{ decision: 'uphold', allowSameDecider: 'no' }, 'allowSameDecider'] },
  { route: 'POST /super-admin/community-moderation/evidence/:id/review', ctl: M, handler: 'evidenceReview', today: [{ decision: 'clean', reason: 'no personal data' }], bad: [{ decision: 0 }, 'decision'] },
  { route: 'POST /super-admin/community-moderation/incidents/:id/access', ctl: M, handler: 'incidentAccess', today: [{ caseId: ID, reason: 'verifying an advisory' }], bad: [{ caseId: ID, reason: 1 }, 'reason'] },
  { route: 'POST /super-admin/community-moderation/tenants/:tenantId/actions', ctl: M, handler: 'tenantAction', today: [{ action: 'suspend', reason: 'repeated violations', expiresAt: '2026-11-01T00:00:00Z', message: 'Suspended 3 weeks' }], bad: [{ action: 'suspend', userId: 5 }, 'userId'] },
  { route: 'PUT /super-admin/community-moderation/settings', ctl: M, handler: 'updateSettings', today: [{ expectedVersion: 2, riskMatchingEnabled: true, reason: 'pilot over' }, { expectedVersion: 2, autoHideReportThreshold: 5, reason: 'tuning' }], bad: [{ expectedVersion: 2, riskMatchingEnabled: 'true', reason: 'r' }, 'riskMatchingEnabled'] },
  { route: 'POST /pos/ai-ocr-receipt/upload', ctl: O, handler: 'upload', today: [{ filename: 'receipt.jpg', mimeType: 'image/jpeg', sizeBytes: 4, bytes: [255, 216, 255, 224], headerBytes: [255, 216, 255, 224], pageCount: null, width: 800, height: 1200 }, { filename: 'r.png', sizeBytes: 2, bytes: { 0: 137, 1: 80 } }], bad: [{ filename: 'r.png', sizeBytes: 'big' }, 'sizeBytes'] },
  { route: 'POST /pos/ai-ocr-receipt/documents/:id/correct-field', ctl: O, handler: 'correct', today: [{ field: 'total', valueCents: 4599 }, { field: 'vendor', value: 'Sally Beauty' }, { field: 'date', confirmOnly: true }], bad: [{ field: 'total', valueCents: '45.99' }, 'valueCents'] },
  { route: 'POST /pos/ai-ocr-receipt/documents/:id/approve', ctl: O, handler: 'approve', today: [{}, { reason: 'looks right' }], bad: [{ reason: 1 }, 'reason'] },
  { route: 'POST /pos/ai-ocr-receipt/documents/:id/reject', ctl: O, handler: 'reject', today: [{ reason: 'blurry' }], bad: [{ reason: 'x', status: 'approved' }, 'status'] },
  { route: 'POST /pos/ai-ocr-receipt/documents/:id/return', ctl: O, handler: 'return_', today: [{ reason: 'missing total' }], bad: [{ reason: [] }, 'reason'] },
  { route: 'POST /pos/ai-ocr-receipt/documents/:id/post', ctl: O, handler: 'post', today: [{ destination: 'expense' }, { destination: 'inventory_receipt' }], bad: [{ destination: 1 }, 'destination'] },
  { route: 'PUT /pos/ai-ocr-receipt/settings', ctl: O, handler: 'saveSettings', today: [{ level: 'tenant', enabled: true, config: { autoApprove: false } }], bad: [{ level: 'tenant', config: 'x' }, 'config'] },
];

describe('safety — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => expect(routeBodyFailures(c, bodyPipeOf as any)).toEqual([]));
  it('community settings keep an unknown key so parseSettingsUpdate still refuses it (400 not_allowed), but never a tenantId', () => {
    expect(validateBody(COMMUNITY_SETTINGS_BODY, { expectedVersion: 0, color: 'red' })).toMatchObject({ ok: true, value: { color: 'red' } });
    expect(validateBody(COMMUNITY_SETTINGS_BODY, { expectedVersion: 0, tenantId: ID }).ok).toBe(false);
  });
});
