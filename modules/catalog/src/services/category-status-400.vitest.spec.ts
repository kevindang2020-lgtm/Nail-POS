// category-status-400 — Security Deep Scan §163 run 3 (Oct 27 2026): PATCH /pos/services/categories/:categoryId with a status
// outside the service_category lifecycle reached canMoveToSql, which threw a plain Error (500). canMoveToSql now refuses an
// unknown state as an exposed 400 VALIDATION_FAILED, and the services controller passes it to the platform filter unchanged.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { canMoveToSql } from '@aipowersalon/database';
import { ServicesController } from './services.controller';
import { SERVICE_CATEGORY } from '../catalog-lifecycles';

describe('§163 run 3 — service category status', () => {
  it('an unknown status is an exposed 400 naming the allowed states', async () => {
    const ctl = new ServicesController({ updateCategory: async (_c: any, _id: string, p: any) => { canMoveToSql(SERVICE_CATEGORY, p.status); return {}; } } as any);
    await expect(ctl.catUpdate({ ctx: { tenantId: 't1' } }, 'c1', { status: "' OR '1'='1" })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED', expose: true, details: { allowed: ['active', 'inactive', 'archived', 'merged'] } });
  });
  it('a lifecycle status still compiles', () => { expect(() => canMoveToSql(SERVICE_CATEGORY, 'inactive')).not.toThrow(); });
});
