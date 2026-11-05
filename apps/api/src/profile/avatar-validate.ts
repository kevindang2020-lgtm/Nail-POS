// avatar-validate.ts — pure validation for profile-photo data URLs (no framework deps, so it is unit
// testable in the Nest-free harness). The client downscales to a 256px square before upload.
const MAX_LEN = 600_000; // ~600KB ceiling on the stored data URL
const DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i;

export type AvatarValidation =
  | { ok: true; value: string }
  | { ok: false; status: number; message: string };

export function validateAvatarDataUrl(v: unknown): AvatarValidation {
  if (typeof v !== 'string' || !v.trim()) return { ok: false, status: 400, message: 'An image is required' };
  const s = v.trim();
  if (!DATA_URL_RE.test(s)) return { ok: false, status: 400, message: 'Unsupported image — use PNG, JPEG, WebP or GIF' };
  if (s.length > MAX_LEN) return { ok: false, status: 413, message: 'Image is too large — please choose a smaller photo' };
  // Constitution 12 §159: the declared type ("data:image/png") is whatever the uploader wrote. Check the BYTES match
  // it — the same magic-number check technician photos already use — so nothing but a real image is stored.
  const declared = (s.match(/^data:image\/([a-z]+);/i)?.[1] ?? '').toLowerCase().replace('jpeg', 'jpg');
  let head: Buffer;
  try { head = Buffer.from(s.slice(s.indexOf(',') + 1, s.indexOf(',') + 1 + 64).replace(/\s/g, ''), 'base64'); } catch { head = Buffer.alloc(0); }
  const actual = sniffAvatarType(head);
  if (!actual || actual !== declared) return { ok: false, status: 400, message: 'Unsupported image — use PNG, JPEG, WebP or GIF' };
  return { ok: true, value: s };
}

/** The four types the avatar accepts, by magic number. jpg/png/webp as in tech-profile-core's sniffImageType, plus GIF. */
export function sniffAvatarType(b: Buffer): 'jpg' | 'png' | 'webp' | 'gif' | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (b.length >= 4 && b.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  return null;
}
