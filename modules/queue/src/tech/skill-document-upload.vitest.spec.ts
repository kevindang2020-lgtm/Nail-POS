// skill-document-upload.vitest.spec.ts — BUILD_PLAN Phase 12 (#34): POST /tech/skills/upload-document runs the upload
// policy — a photo loses its EXIF, a PDF passes, markup is refused, and the key sits under the salon (it had no tenant
// segment: `skill-docs/<user>-<ms>-…`).
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exifJpeg, htmlAsImage, EXIF_GPS_MARKER } from '@aipowersalon/testing';
import { TechController } from './tech.controller';

const T = 'a8000000-0000-4000-8000-000000000001', U = 'a8000000-0000-4000-8000-0000000000c1';
let root = '';
const all = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? all(p) : [p]; });
beforeAll(() => { root = mkdtempSync(join(tmpdir(), 'p12-skill-')); process.env.MEDIA_ROOT = root; delete process.env.MEDIA_STORE; });
const ctl = () => new TechController({} as any, {} as any);
const req = { ctx: { tenantId: T, branchId: 'b1', userId: U, role: 'TECHNICIAN', permissions: [] } };

describe('POST /tech/skills/upload-document', () => {
  it('a certificate photo is stored without its EXIF under tenants/<salon>/skill-docs/<user>/<random>.jpg', async () => {
    const r: any = await ctl().uploadSkillDocument(req, { buffer: exifJpeg(), originalname: 'licence.jpg', mimetype: 'image/jpeg' });
    expect(r.key).toMatch(new RegExp(`^tenants/${T}/skill-docs/${U}/[0-9a-f]{24}\\.jpg$`));
    expect(readFileSync(join(root, r.key)).toString('latin1')).not.toContain(EXIF_GPS_MARKER);
  });
  it('a PDF is accepted as a PDF; markup and a disallowed extension are refused and nothing is written', async () => {
    const r: any = await ctl().uploadSkillDocument(req, { buffer: Buffer.from('%PDF-1.7\n1 0 obj\n'), originalname: 'cert.pdf', mimetype: 'application/pdf' });
    expect(r.key).toMatch(/\.pdf$/);
    const before = all(root).length;
    await expect(ctl().uploadSkillDocument(req, { buffer: htmlAsImage(), originalname: 'x.jpg', mimetype: 'image/jpeg' })).rejects.toThrow();
    await expect(ctl().uploadSkillDocument(req, { buffer: exifJpeg(), originalname: 'x.svg', mimetype: 'image/jpeg' })).rejects.toThrow();
    expect(all(root).length).toBe(before);
  });
});
