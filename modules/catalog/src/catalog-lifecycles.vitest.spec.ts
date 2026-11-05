// BUILD_PLAN Phase 12 round 2 (#27): a service category is an owner's flag; a merged category never comes back.
import { describe, it, expect } from 'vitest';
import { SERVICE_CATEGORY } from './catalog-lifecycles';

describe('service category lifecycle', () => {
  it('active / inactive / archived toggle (archived restores); merged is terminal', () => {
    expect([SERVICE_CATEGORY.can('archived', 'active'), SERVICE_CATEGORY.can('active', 'archived'), SERVICE_CATEGORY.can('merged', 'active')]).toEqual([true, true, false]);
  });
});
