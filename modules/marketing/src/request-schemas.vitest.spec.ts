// BUILD_PLAN Phase 12 (#17): the Customer Display Advertising routes' body validation, route by route on the real
// controller — the bodies pos-web sends today (posDisplayAdsApi, AdEditor.inputOf, adImagePipeline) pass intact,
// unknown fields are stripped, a bad body is a 400 VALIDATION_FAILED naming the field, an undeclared tenantId is refused.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { DisplayAdsController as C } from './display-advertising/display-ads.controller';

const B = '22222222-2222-4222-8222-222222222222';
const AD = {
  name: 'Fall gel special', mediaId: B, fullscreenMediaId: null, headline: '20% off gel', subheadline: null, description: null, ctaText: 'Ask us',
  qr: { kind: 'booking', url: 'https://example.com/book' }, fitMode: 'cover', focalX: 0.5, focalY: 0.42,
  startDate: '2026-10-01', endDate: null, daysOfWeek: [1, 3, 5], dailyStartTime: '10:00', dailyEndTime: '17:30',
  displayDurationSeconds: null, priority: 0, allBranches: false, branchIds: [B],
};
const CASES: RouteBodyCase[] = [
  { route: 'POST /pos/marketing/display-ads', ctl: C, handler: 'create', today: [AD, { name: 'x', qr: null, allBranches: true, branchIds: [] }], bad: [{ name: 'x', branchIds: B }, 'branchIds'] },
  { route: 'PATCH /pos/marketing/display-ads/:id', ctl: C, handler: 'update', today: [{ ...AD, expectedVersion: 3 }], bad: [{ ...AD, expectedVersion: 3, status: 'published' }, 'status'] },
  { route: 'POST /pos/marketing/display-ads/:id/publish', ctl: C, handler: 'publish', today: [{ expectedVersion: 1 }], bad: [{ expectedVersion: '1' }, 'expectedVersion'] },
  { route: 'POST /pos/marketing/display-ads/:id/pause', ctl: C, handler: 'pause', today: [{ expectedVersion: 2 }], bad: [{ expectedVersion: [2] }, 'expectedVersion'] },
  { route: 'POST /pos/marketing/display-ads/:id/archive', ctl: C, handler: 'archive', today: [{ expectedVersion: 2 }], bad: [{ expectedVersion: 2, status: 'archived' }, 'status'] },
  { route: 'POST /pos/marketing/display-ads/:id/restore', ctl: C, handler: 'restore', today: [{ expectedVersion: 4 }], bad: [{ expectedVersion: {} }, 'expectedVersion'] },
  { route: 'PATCH /pos/marketing/display-ads/settings', ctl: C, handler: 'settings', today: [{ enabled: true, defaultDurationSeconds: 10, fullScreenIdleAdsEnabled: false, fullScreenIdleAfterSeconds: 60 }], bad: [{ enabled: 'yes' }, 'enabled'] },
  { route: 'PATCH /pos/marketing/display-ads/branches/:branchId/settings', ctl: C, handler: 'branchSettings', today: [{ enabled: null }, { fullScreenIdleAdsEnabled: false }], bad: [{ enabled: 0 }, 'enabled'] },
  { route: 'PATCH /pos/marketing/display-ads/devices/:deviceId', ctl: C, handler: 'device', today: [{ adsEnabled: true }], bad: [{ adsEnabled: 'true' }, 'adsEnabled'] },
  { route: 'POST /pos/marketing/display-ads/media', ctl: C, handler: 'upload', today: [{ focalX: '0.5', focalY: '0.333' }, {}], bad: [{ focalX: ['0.5'] }, 'focalX'] },
];

describe('marketing — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => expect(routeBodyFailures(c, bodyPipeOf as any)).toEqual([]));
});
