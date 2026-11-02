// private-store.ts — BUILD_PLAN Phase 12 (Constitution 5 §33, Constitution 12 §323): the PRIVATE object store for files
// the API produces for one person (asynchronous exports today).
//
// Why not MediaStorage: MediaStorage.put() answers a PUBLIC url under /media/ (served without a session, CDN-cached) —
// right for avatars, a data breach for a customer list. Here:
//   • nothing is ever public: put() returns the key, never a URL; the API streams get() to the authorized person;
//   • local disk lives under PRIVATE_FILES_ROOT (default <cwd>/private-files) — never under MEDIA_ROOT, never served;
//   • with MEDIA_STORE=s3 the objects go to PRIVATE_S3_BUCKET (default: MEDIA_S3_BUCKET under the `private/` prefix),
//     written with no ACL (bucket default = private) and read back with GetObject — never a CDN URL;
//   • keys are `<env>/<namespace>/<tenant|platform>/<id>/<filename>` (privateObjectKey), every segment validated.
import { promises as fs, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, normalize, resolve } from 'node:path';
import { mediaEnvSegment, mediaRegion } from './media-storage';
import { instrumentStore } from '@aipowersalon/observability';   // BUILD_PLAN Phase 14 B: storage metrics (Constitution 11 §49)

export interface PrivateObjectStore {
  /** Store privately. Returns the key (there is no URL). */
  put(key: string, body: Buffer, contentType?: string): Promise<{ key: string; bytes: number }>;
  /** The bytes, or null when the object is gone. */
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
  readonly kind: 'local' | 's3';
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
/** `<env>/<namespace>/<owner>/<id>/<filename>` — the owner is a tenant id or 'platform'. A file name is reduced to a safe
 *  segment (never a path from the client). */
export function privateObjectKey(namespace: string, owner: string, id: string, filename: string, env: NodeJS.ProcessEnv = process.env): string {
  const file = safeFilename(filename);
  const parts = [mediaEnvSegment(env), namespace, owner, id, file];
  for (const p of parts) if (!p || !SEGMENT.test(p) || p.includes('..')) throw new Error(`privateObjectKey: invalid segment ${JSON.stringify(p)}`);
  return parts.join('/');
}

/** A download name that is one safe path segment: letters, digits, dot, dash, underscore; ≤ 120 chars; never empty. */
export function safeFilename(name: string, fallback = 'export.bin'): string {
  const base = String(name ?? '').split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').replace(/\.{2,}/g, '.').slice(0, 120);
  return clean || fallback;
}

export class LocalDiskPrivateStore implements PrivateObjectStore {
  readonly kind = 'local' as const;
  readonly root: string;
  constructor(root?: string) {
    this.root = resolve(root ?? process.env.PRIVATE_FILES_ROOT ?? join(process.cwd(), 'private-files'));
    mkdirSync(this.root, { recursive: true });
  }
  private safe(key: string): string | null {
    const clean = normalize(key).replace(/^([/\\])+/, '');
    if (clean.includes('..')) return null;
    const abs = resolve(this.root, clean);
    return abs.startsWith(this.root + '/') ? abs : null;
  }
  async put(key: string, body: Buffer): Promise<{ key: string; bytes: number }> {
    const abs = this.safe(key);
    if (!abs) throw new Error('Invalid private object key.');
    await fs.mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp-${randomBytes(4).toString('hex')}`;   // never a truncated object under the real key
    try { await fs.writeFile(tmp, new Uint8Array(body), { mode: 0o600 }); await fs.rename(tmp, abs); }
    catch (e) { await fs.unlink(tmp).catch(() => undefined); throw e; }
    return { key, bytes: body.length };
  }
  async get(key: string): Promise<Buffer | null> {
    const abs = this.safe(key);
    if (!abs) return null;
    try { return await fs.readFile(abs); } catch { return null; }
  }
  async remove(key: string): Promise<void> {
    const abs = this.safe(key);
    if (abs) await fs.unlink(abs).catch(() => undefined);
  }
}

export interface S3PrivateConfig { bucket: string; region?: string; endpoint?: string; prefix?: string; forcePathStyle?: boolean }
export class S3PrivateStore implements PrivateObjectStore {
  readonly kind = 's3' as const;
  private client: any; private Put: any; private Get: any; private Del: any;
  constructor(private readonly cfg: S3PrivateConfig, sdk?: any) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- production-only dependency, loaded lazily like the media adapter
    const s3 = sdk ?? require('@aws-sdk/client-s3');
    this.client = new s3.S3Client({ region: cfg.region, endpoint: cfg.endpoint, forcePathStyle: cfg.forcePathStyle });
    this.Put = s3.PutObjectCommand; this.Get = s3.GetObjectCommand; this.Del = s3.DeleteObjectCommand;
  }
  private objectKey(key: string): string { const p = String(this.cfg.prefix ?? 'private').replace(/^\/+|\/+$/g, ''); return p ? `${p}/${key}` : key; }
  async put(key: string, body: Buffer, contentType?: string): Promise<{ key: string; bytes: number }> {
    await this.client.send(new this.Put({ Bucket: this.cfg.bucket, Key: this.objectKey(key), Body: body, ContentType: contentType, ServerSideEncryption: 'AES256' }));
    return { key, bytes: body.length };
  }
  async get(key: string): Promise<Buffer | null> {
    try {
      const r = await this.client.send(new this.Get({ Bucket: this.cfg.bucket, Key: this.objectKey(key) }));
      const chunks: Buffer[] = [];
      for await (const c of r.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
      return Buffer.concat(chunks);
    } catch (e: any) { if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null; throw e; }
  }
  async remove(key: string): Promise<void> { await this.client.send(new this.Del({ Bucket: this.cfg.bucket, Key: this.objectKey(key) })).catch(() => undefined); }
}

/** The private store for this environment: S3 when MEDIA_STORE=s3 (PRIVATE_S3_BUCKET, else MEDIA_S3_BUCKET under
 *  `private/`), else local disk. Outside production an unusable S3 setup falls back to disk with a warning. */
export function makePrivateStore(env: NodeJS.ProcessEnv = process.env, sdk?: any): PrivateObjectStore {
  return instrumentStore(selectPrivateStore(env, sdk), 'private');   // BUILD_PLAN Phase 14 B: store 'private' on the storage dashboard
}

function selectPrivateStore(env: NodeJS.ProcessEnv, sdk?: any): PrivateObjectStore {
  if (String(env.MEDIA_STORE ?? '').trim().toLowerCase() === 's3') {
    const bucket = String(env.PRIVATE_S3_BUCKET ?? '').trim() || String(env.MEDIA_S3_BUCKET ?? '').trim();
    try {
      if (!bucket) throw new Error('PRIVATE_S3_BUCKET (or MEDIA_S3_BUCKET) is required when MEDIA_STORE=s3');
      return new S3PrivateStore({ bucket, region: mediaRegion(env), endpoint: env.MEDIA_S3_ENDPOINT || undefined, prefix: env.PRIVATE_S3_PREFIX ?? 'private',
        forcePathStyle: String(env.MEDIA_S3_FORCE_PATH_STYLE ?? '').toLowerCase() === 'true' }, sdk);
    } catch (e: any) {
      if (env.NODE_ENV === 'production') throw e;
      console.error(`private store: S3 unavailable (${e?.message ?? e}); using local disk.`);
    }
  }
  return new LocalDiskPrivateStore(env.PRIVATE_FILES_ROOT || undefined);
}
