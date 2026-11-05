// file-safety.vitest.spec — Constitution 12 §159–166: uploads are what they claim; the public store holds only public images.
import { codeRoots, codeKey, sourcePath } from '../../test-support/code-roots';
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateAvatarDataUrl } from '../profile/avatar-validate';
import { validateImageUpload } from '@aipowersalon/workforce';
import { LocalDiskMediaStorage } from '@aipowersalon/media';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const dataUrl = (mime: string, buf: Buffer) => `data:image/${mime};base64,${buf.toString('base64')}`;

describe('§159 profile avatars: the BYTES must be the declared image type', () => {
  it('a real PNG declared as PNG is accepted; a real JPEG as jpeg or jpg', () => {
    expect(validateAvatarDataUrl(dataUrl('png', PNG)).ok).toBe(true);
    expect(validateAvatarDataUrl(dataUrl('jpeg', JPG)).ok).toBe(true);
  });
  it('HTML or script labelled image/png is refused (before: the label alone decided)', () => {
    expect(validateAvatarDataUrl(dataUrl('png', Buffer.from('<html><script>alert(1)</script></html>'))).ok).toBe(false);
    expect(validateAvatarDataUrl(dataUrl('png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).ok).toBe(false);
  });
  it('a real JPEG mislabelled as PNG is refused — the label must be true, not merely "some image"', () => {
    expect(validateAvatarDataUrl(dataUrl('png', JPG)).ok).toBe(false);
  });
  it('SVG is not an accepted type at all (it can carry script)', () => {
    expect(validateAvatarDataUrl(`data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`).ok).toBe(false);
  });
});

describe('§160 technician photos (already magic-byte checked — pinned)', () => {
  it('bytes decide the type; a non-image is refused', () => {
    expect(validateImageUpload(PNG, 'avatar')).toMatchObject({ ok: true, ext: 'png' });
    expect(validateImageUpload(Buffer.from('<?php echo 1; ?>'), 'photo').ok).toBe(false);
  });
});

describe('§164–166 M2 — the public media store is public BY DESIGN, and only for public images', () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : (/\.ts$/.test(f) && !/spec|pgtest|\.d\.ts$/.test(f) ? [p] : []); });
  it('only technician profiles and the nail showcase write to it — no private domain (evidence, receipts) does', () => {
    const users = codeRoots().flatMap((r) => walk(r)).filter((f) => /MEDIA_STORAGE/.test(readFileSync(f, 'utf8'))).map((f) => codeKey(f).split('/')[0]);   // codeKey: the owning directory survives a move into a module (Constitution 13)
    // + customer / owner / workforce (staff) AVATARS (developer merge, Sep 2026): a person's own profile photo is public by
    // design, and each upload is magic-byte sniffed with the extension taken from the sniffed type (asserted below).
    // + display-advertising (23-inch dual-screen spec §68, Oct 2026): the salon's own advertisements, shown on its
    // customer-facing display — public by design, like the nail showcase (pinned in the next test).
    // + settings (spec §13, Oct 2026): the salon logo, shown at the top of its customer display and on receipts —
    // public by design (pinned below: sniffed bytes, salon-scoped key with a random token, a row PATCH cannot reach).
    expect([...new Set(users)].sort()).toEqual(['customer', 'display-advertising', 'nail-showcase', 'owner', 'settings', 'tech-profile', 'workforce']);
  });
  it('the salon logo: the bytes decide the type, the key is the salon\'s own with a random token, and the generic settings PATCH cannot point it elsewhere', () => {
    const logo = readFileSync(sourcePath('src/settings/salon-logo.ts'), 'utf8');
    expect(logo).toMatch(/const kind = sniffImage\(buf\)/);
    expect(logo).toMatch(/if \(declared !== KIND_MIME\[kind\]\)/);                        // declared type must match the bytes
    expect(logo).toMatch(/ext: KIND_EXT\[kind\]/);                                         // the stored extension is the sniffed one
    expect(logo).toMatch(/return `salon-logos\/\$\{tenantId\}\/logo-\$\{token\}\.\$\{ext\}`;/);
    expect(logo).toMatch(/const DATA_URL = \/\^data:\(image\\\/\[a-z0-9\.\+-\]\+\);base64,/);   // an upload is bytes, never an outside address
    const svc = readFileSync(sourcePath('src/settings/settings.service.ts'), 'utf8');
    expect(svc).toMatch(/salonLogoKey\(ctx\.tenantId, randomBytes\(12\)\.toString\('hex'\), img\.ext\)/);
    const repo = readFileSync(sourcePath('src/settings/settings.repository.ts'), 'utf8');
    expect(repo).not.toMatch(/'salon-logo'/);                                               // not a PATCH-able settings category
  });
  it('display ads: every stored key takes the SNIFFED type\'s extension, and the full-size original (it may still carry camera EXIF) sits behind a random token no response carries', () => {
    const core = readFileSync(sourcePath('src/display-advertising/display-ads-media-core.ts'), 'utf8');
    // Phase 12 (#34): keys sit under the salon (`tenants/<id>/display-ads/<mediaId>`; older rows keep `display-ads/<mediaId>`)
    expect(core).toMatch(/const base = tenantId \? `tenants\/\$\{tenantId\}\/display-ads\/\$\{mediaId\}` : `display-ads\/\$\{mediaId\}`;/);
    const keys = core.match(/`\$\{base\}\/[^`]+`/g) ?? [];
    expect(keys).toHaveLength(4);
    for (const k of keys) expect(k).toMatch(/\.\$\{u\.(original|large|medium|thumb)\.ext\}`$/);
    expect(core).toMatch(/ext: KIND_EXT\[kind\]/);                       // the sniffed kind's extension, never the file name's
    expect(keys[0]).toMatch(/\/original-\$\{originalToken\}\./);
    const svc = readFileSync(sourcePath('src/display-advertising/display-ads.service.ts'), 'utf8');
    expect(svc).toMatch(/adMediaKeys\(id, randomBytes\(12\)\.toString\('hex'\), checked, ctx\.tenantId\)/);   // Phase 12: under the caller's own salon
    const view = /function mediaView[\s\S]*?\n}\n/.exec(svc)?.[0] ?? '';
    expect(view).toMatch(/thumb: ref\(/);
    expect(view).not.toMatch(/storageKey|storage_key/);                   // only the browser-made copies (re-encoded) are handed out
  });
  it('every stored key takes its extension from the SNIFFED type, so a .html can never be stored or served', () => {
    const src = readFileSync(sourcePath('src/tech-profile/tech-profile.service.ts'), 'utf8')   /* API or owning module */;
    for (const k of src.match(/const key = `tech-profiles\/[^`]+`/g) ?? []) expect(k).toMatch(/\.\$\{(v\.ext|ext)\}`$/);
  });
  it('path traversal out of the media root is refused', () => {
    const s = new LocalDiskMediaStorage('/tmp/aps-media-test');
    expect(s.resolvePath('../../etc/passwd')).toBeNull(); expect(s.resolvePath('tech-profiles/../../x')).toBeNull();
  });
});

describe('Sep 2026 merge — the new avatar and skill-document uploads sniff the bytes', () => {
  it('customer, owner, staff avatars and tech skill documents take the extension from validateImageUpload, not the filename', () => {
    for (const f of ['../customer/customer.controller.ts', '../../../../modules/analytics/src/owner/owner.controller.ts', '../../../../modules/workforce/src/tech-profile/staff-avatar.controller.ts', '../../../../modules/queue/src/tech/tech.controller.ts']) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      expect(src, f).toMatch(/validateImageUpload\(/);
      expect(src, f).not.toMatch(/originalname\?\.split\('\.'\)\.pop/);
      expect(src, f).not.toMatch(/f\.mimetype === 'image\/png' \? 'png'/);
    }
  });
});

describe('Sep 2026 merge — nail-showcase media (photos AND video, on the public store) are typed by their bytes', () => {
  it('images sniff to their type; MP4/MOV need an ftyp box, WebM the EBML header; anything else is refused', async () => {
    const { sniffShowcaseMedia } = await import('../../../../modules/workforce/src/nail-showcase/nail-showcase.controller');
    expect(sniffShowcaseMedia(PNG)).toBe('png');
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(16)]);
    const mov = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from('ftypqt  '), Buffer.alloc(16)]);
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(16)]);
    expect(sniffShowcaseMedia(mp4)).toBe('mp4'); expect(sniffShowcaseMedia(mov)).toBe('mov'); expect(sniffShowcaseMedia(webm)).toBe('webm');
    expect(sniffShowcaseMedia(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();   // an HTML page labelled image/png
  });
  it('neither showcase upload takes its extension from the claimed mimetype any more', () => {
    for (const f of ['nail-showcase.controller.ts', 'nail-showcase-social.controller.ts']) {
      const src = readFileSync(join(__dirname, '../../../../modules/workforce/src/nail-showcase', f), 'utf8');
      expect(src, f).not.toMatch(/const ext = this\.EXT\[/);
      expect(src, f).not.toMatch(/Math\.random\(\)/);
    }
  });
});
