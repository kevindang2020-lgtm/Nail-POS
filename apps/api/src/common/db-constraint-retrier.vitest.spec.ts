// db-constraint-retrier.vitest.spec — BUILD_PLAN Phase 10 (E): B's retry outcomes as the Database page shows them.
import { describe, it, expect } from 'vitest';
import { retrierFor } from './db-constraint-retrier.module';

const base = { id: 'i', name: 'uq_x', table: 'users' };
const svc = (o: any) => ({ retry: async (_id: string, by?: string) => ({ ...o, by }) }) as any;
describe('retrierFor', () => {
  it('maps every outcome; only resolved / already resolved count as resolved', async () => {
    expect(await retrierFor(svc({ ...base, status: 'resolved', blockingRows: 0 })).retry('i', { userId: 'u' })).toEqual({ resolved: true, message: 'uq_x applied on users.' });
    expect((await retrierFor(svc({ ...base, status: 'already_resolved', blockingRows: 0 })).retry('i', { userId: null })).resolved).toBe(true);
    expect(await retrierFor(svc({ ...base, status: 'still_blocked', blockingRows: 3 })).retry('i', { userId: 'u' })).toMatchObject({ resolved: false, message: expect.stringContaining('3 blocking row(s)') });
    expect((await retrierFor(svc({ ...base, status: 'refused', blockingRows: null })).retry('i', { userId: 'u' })).resolved).toBe(false);
    const failed = await retrierFor(svc({ ...base, status: 'failed', blockingRows: 1, error: 'could not create unique index\nDETAIL: Key (email)=(a@b.c)' })).retry('i', { userId: 'u' });
    expect(failed.resolved).toBe(false); expect(failed.message).not.toContain('a@b.c');
  });
  it('stamps resolved_by with the Super Admin', async () => {
    let by = '';
    await retrierFor({ retry: async (_i: string, b: string) => { by = b; return { ...base, status: 'resolved', blockingRows: 0 }; } } as any).retry('i', { userId: 'u1' });
    expect(by).toBe('super_admin:u1');
  });
});
