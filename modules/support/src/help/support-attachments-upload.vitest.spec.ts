// support-attachments-upload.vitest.spec.ts — BUILD_PLAN Phase 12 (#34): POST /tenant/help/tickets/:id/attachments runs the
// upload policy. The declared content type used to decide everything — an HTML page declared image/png was stored and
// served back as one. Now the bytes must be what the declared type says, images lose their EXIF, and the salon's
// storage quota is charged (a JSON body never passes the multipart guard).
import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { SupportAttachmentsService } from './support-attachments.service';

const T = 'ab000000-0000-4000-8000-000000000001', U = 'ab000000-0000-4000-8000-0000000000c1', TK = 'ab000000-0000-4000-8000-0000000000f1';
const ctx = { tenantId: T, userId: U, role: 'OWNER', permissions: [] } as any;
/** A driver that answers the service's few statements by their shape. */
const db = new Kysely<any>({ dialect: {
  createAdapter: () => new PostgresAdapter(), createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler(),
  createDriver: () => ({
    async init() {}, async releaseConnection() {}, async destroy() {}, async beginTransaction() {}, async commitTransaction() {}, async rollbackTransaction() {},
    async acquireConnection() { return { async executeQuery(q: any) {
      const s = String(q.sql);
      if (/FROM support_tickets/.test(s)) return { rows: [{ id: TK, status: 'open', created_by_user_id: U }] };
      if (/count\(\*\)/.test(s)) return { rows: [{ n: 0 }] };
      if (/INSERT INTO support_ticket_attachments/.test(s)) return { rows: [{ id: 'att-1', created_at: '2026-10-08T00:00:00Z' }] };
      return { rows: [] };
    }, async *streamQuery() {} } as any; },
  }) as any,
} });
let puts: Array<{ key: string; body: Buffer }> = [];
const storage = { put: async (key: string, body: Buffer) => { puts.push({ key, body }); return { url: '' }; }, remove: async () => undefined, resolvePath: () => null };
beforeEach(() => { puts = []; });

const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const EXIF = Buffer.from('Exif\0\0GPS-SECRET-40.7128N', 'latin1');
const exifJpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), Buffer.from(be16(2 + EXIF.length)), EXIF,
  Buffer.from([0xff, 0xc0]), Buffer.from(be16(11)), Buffer.from([8, 0, 10, 0, 10, 1, 1, 0x11, 0]), Buffer.from([0xff, 0xda]), Buffer.from(be16(8)), Buffer.from([1, 1, 0, 0, 0x3f, 0]), Buffer.alloc(8, 7), Buffer.from([0xff, 0xd9])]);

describe('POST /tenant/help/tickets/:id/attachments', () => {
  it('an HTML page declared image/png is refused and nothing is stored', async () => {
    const r = await new SupportAttachmentsService(db, storage as any).upload(ctx, TK, { fileName: 'screenshot.png', contentType: 'image/png', data: Buffer.from('<html><script>alert(1)</script></html>').toString('base64') });
    expect(r.ok).toBe(false);
    expect(puts).toHaveLength(0);
  });
  it('a real screenshot is stored without its EXIF; CSV text passes; the quota is charged', async () => {
    const charged: number[] = [];
    const svc = new SupportAttachmentsService(db, storage as any, { reserveStorage: async (_t: string, n: number) => { charged.push(n); }, releaseStorage: async () => undefined });
    const a = await svc.upload(ctx, TK, { fileName: 'receipt.jpg', contentType: 'image/jpeg', data: exifJpeg().toString('base64') });
    expect(a).toMatchObject({ ok: true });
    expect(puts[0].key).toMatch(new RegExp(`^support-attachments/${T}/${TK}/[0-9a-f-]{36}\\.jpg$`));
    expect(puts[0].body.toString('latin1')).not.toContain('GPS-SECRET');
    const c = await svc.upload(ctx, TK, { fileName: 'export.csv', contentType: 'text/csv', data: Buffer.from('a,b\n1,2\n').toString('base64') });
    expect(c.ok).toBe(true);
    expect(charged).toEqual([a.attachment!.sizeBytes, c.attachment!.sizeBytes]);
  });
  it('a PDF declared as an image is a mismatch', async () => {
    const r = await new SupportAttachmentsService(db, storage as any).upload(ctx, TK, { fileName: 'x.png', contentType: 'image/png', data: Buffer.from('%PDF-1.7\n').toString('base64') });
    expect(r).toMatchObject({ ok: false });
    expect(puts).toHaveLength(0);
  });
});
