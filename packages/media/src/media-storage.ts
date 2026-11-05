// media-storage.ts — S3-shaped storage interface with the local-disk implementation (tech-profile spec set).
// Production swaps in an S3 adapter behind the same interface via env; keys and public URL paths stay identical.
import { mkdirSync, promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, normalize, resolve } from 'node:path';
import { instrumentStore } from '@aipowersalon/observability';   // BUILD_PLAN Phase 14 B: storage metrics (Constitution 11 §49)

export interface MediaStorage {
  put(key: string, body: Buffer): Promise<{ url: string }>;
  remove(key: string): Promise<void>;
  /** Resolve a public key to an absolute file path INSIDE the media root (null = refuse). */
  resolvePath(key: string): string | null;
  /** §169 (Phase 11): delete abandoned partial uploads started before `cutoff`; returns how many were removed. */
  sweepAbandoned?(cutoff: Date): Promise<number>;
}

export const MEDIA_URL_PREFIX = '/media/';
const TEMP_SUFFIX = '.tmp-';
const TEMP_FILE = /\.tmp-[0-9a-f]{8}$/;

// ---- Phase 11 (Constitution 4 §56–62, audit E7): one place for region, env segment, tenant keys and config errors ----

/** The ONE region source for writes and URLs: MEDIA_S3_REGION, else AWS_REGION. No built-in default — a bucket in the
 *  wrong region silently 301s, so a missing region is a configuration error, not a guess. */
export function mediaRegion(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const r = String(env.MEDIA_S3_REGION ?? '').trim() || String(env.AWS_REGION ?? '').trim();
  return r || undefined;
}

/** The environment segment every structured object key starts with (production / staging / development / …), so two
 *  environments sharing a bucket can never overwrite each other. MEDIA_ENV wins, else NODE_ENV, else development. */
export function mediaEnvSegment(env: NodeJS.ProcessEnv = process.env): string {
  const raw = String(env.MEDIA_ENV ?? '').trim() || String(env.NODE_ENV ?? '').trim() || 'development';
  return raw.toLowerCase().replace(/[^a-z0-9-]+/g, '') || 'development';
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
/** `<tenantId>/<kind>/<name…>` — the object adapter adds `<prefix>/<env>/` in front. Every segment is validated. */
export function tenantMediaKey(tenantId: string, kind: string, ...name: string[]): string {
  const parts = [tenantId, kind, ...name];
  if (name.length === 0) throw new Error('tenantMediaKey: a file name is required');
  for (const p of parts) if (!p || !SEGMENT.test(p) || p.includes('..')) throw new Error(`tenantMediaKey: invalid segment ${JSON.stringify(p)}`);
  return parts.join('/');
}

/** Boot-time check (production only): in production, object storage must be configured (MEDIA_STORE=s3 with bucket
 *  and region). Storing uploads on the container disk is lost on every deploy. production-config.ts calls this. */
export function mediaStorageConfigErrors(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const store = String(env.MEDIA_STORE ?? '').trim().toLowerCase();
  const out: string[] = [];
  if (store !== 's3') {
    out.push("MEDIA_STORE must be 's3' in production (refusing to start on container disk — uploaded photos are lost on every deploy)");
    return out;
  }
  if (!String(env.MEDIA_S3_BUCKET ?? '').trim()) out.push('MEDIA_S3_BUCKET is required when MEDIA_STORE=s3');
  if (!mediaRegion(env) && !String(env.MEDIA_S3_ENDPOINT ?? '').trim()) out.push('MEDIA_S3_REGION (or AWS_REGION) is required when MEDIA_STORE=s3 on AWS');
  return out;
}

const trimSlashes = (s: string) => s.replace(/^\/+|\/+$/g, '');

/** The object key inside the bucket, WITHOUT the bucket prefix. Structured keys (with a '/') get the env segment;
 *  legacy bare filenames keep the flat <folder>/<name> layout their rows are hydrated with (buildMediaUrl). */
function relativeObjectKey(key: string, envSegment: string | undefined, env: NodeJS.ProcessEnv): string {
  const clean = key.replace(/^\/+/, '');
  if (clean.includes('/')) return envSegment ? `${envSegment}/${clean}` : clean;
  const folder = trimSlashes(getFileFolder(clean, env));
  return folder ? `${folder}/${clean}` : clean;
}

export class LocalDiskMediaStorage implements MediaStorage {
  readonly root: string;
  constructor(root?: string) {
    this.root = resolve(root ?? process.env.MEDIA_ROOT ?? join(process.cwd(), 'media'));
    mkdirSync(this.root, { recursive: true });
  }

  private safe(key: string): string | null {
    const clean = normalize(key).replace(/^([/\\])+/, '');
    if (clean.includes('..')) return null;
    const abs = resolve(this.root, clean);
    return abs.startsWith(this.root) ? abs : null;   // path-traversal guard
  }

  async put(key: string, body: Buffer) {
    const abs = this.safe(key);
    if (!abs) throw new Error('Invalid media key.');
    await fs.mkdir(dirname(abs), { recursive: true });
    // Phase 11 §169: write to a temp name and rename — a crash mid-write leaves a `.tmp-<hex>` file (swept by the
    // media.lifecycle job), never a truncated object under the real key.
    const tmp = `${abs}${TEMP_SUFFIX}${randomBytes(4).toString('hex')}`;
    try {
      await fs.writeFile(tmp, new Uint8Array(body));
      await fs.rename(tmp, abs);
    } catch (e) { await fs.unlink(tmp).catch(() => { }); throw e; }
    return { url: MEDIA_URL_PREFIX + key.replace(/^\/+/, '') };
  }

  /** Delete `.tmp-<hex>` files (interrupted writes) last modified before `cutoff`. */
  async sweepAbandoned(cutoff: Date): Promise<number> {
    let n = 0;
    const walk = async (dir: string): Promise<void> => {
      let entries: import('node:fs').Dirent[];
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) { await walk(p); continue; }
        if (!e.isFile() || !TEMP_FILE.test(e.name)) continue;
        try {
          const st = await fs.stat(p);
          if (st.mtimeMs < cutoff.getTime()) { await fs.unlink(p); n++; }
        } catch { /* vanished meanwhile */ }
      }
    };
    await walk(this.root);
    return n;
  }

  async remove(key: string) {
    const abs = this.safe(key);
    if (abs) await fs.unlink(abs).catch(() => { });
  }

  resolvePath(key: string) { return this.safe(key); }
}

function getFileFolder(key: string, env: NodeJS.ProcessEnv): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'bmp'].includes(ext)) {
    return env.MEDIA_S3_FOLDER_IMAGES ?? '';
  }
  if (['pdf', 'doc', 'docx', 'txt', 'csv', 'xls', 'xlsx'].includes(ext)) {
    return env.MEDIA_S3_FOLDER_DOCS ?? '';
  }
  return env.MEDIA_S3_FOLDER_OTHER ?? '';
}

// ---- S3 / object-storage adapter (Scaling Phase 4) --------------------------------------------------------------
// Same MediaStorage port, but objects live in an S3-compatible bucket instead of the container's (ephemeral) disk —
// so uploads survive redeploys and a CDN can serve them from the edge. put() returns the object's public URL (the CDN
// base if MEDIA_CDN_BASE_URL is set, else the bucket URL); resolvePath() returns null because files are NOT local, so
// the API never tries to stream them — the client loads the returned URL directly (that's the whole point of the CDN).
//
// @aws-sdk/client-s3 is required LAZILY (mirroring makeIoredis in @aipowersalon/cache), so it's only loaded when MEDIA_STORE=s3 is set;
// a deployment that stays on local disk never needs the dependency installed.
export interface S3MediaConfig {
  bucket: string;
  region?: string;        // falls back to mediaRegion(process.env); REQUIRED on AWS (no built-in default)
  endpoint?: string;      // for S3-compatible providers (R2, Spaces, MinIO); omit for AWS
  cdnBaseUrl?: string;    // e.g. https://cdn.example.com  → returned URLs point at the CDN (origin path = keyPrefix)
  keyPrefix?: string;     // optional object-key prefix within the bucket
  forcePathStyle?: boolean;
  envSegment?: string;    // Phase 11: <env>/ in front of every structured key (makeMediaStorage sets it)
  folderEnv?: NodeJS.ProcessEnv;   // where MEDIA_S3_FOLDER_* are read for legacy bare filenames (default process.env)
}

export type S3Sdk = { S3Client: new (o: any) => any; PutObjectCommand: any; DeleteObjectCommand: any; ListMultipartUploadsCommand?: any; AbortMultipartUploadCommand?: any };

export class S3MediaStorage implements MediaStorage {
  private client: any;
  private readonly cfg: S3MediaConfig;
  private readonly region: string;
  private readonly mod: S3Sdk;
  /** `sdk` is injectable for tests; in production it lazy-requires @aws-sdk/client-s3 (only when MEDIA_STORE=s3). */
  constructor(cfg: S3MediaConfig, sdk?: S3Sdk) {
    if (!cfg.bucket) throw new Error('S3MediaStorage requires a bucket');
    const region = cfg.region ?? mediaRegion(process.env) ?? (cfg.endpoint ? 'auto' : undefined);
    if (!region) throw new Error('S3MediaStorage requires a region (MEDIA_S3_REGION or AWS_REGION)');
    this.cfg = cfg;
    this.region = region;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    this.mod = sdk ?? require('@aws-sdk/client-s3');
    this.client = new this.mod.S3Client({
      region,
      ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
      ...(cfg.forcePathStyle ? { forcePathStyle: true } : {}),
    });
  }

  private prefix(): string { return trimSlashes(this.cfg.keyPrefix ?? ''); }
  private relative(key: string): string { return relativeObjectKey(key, this.cfg.envSegment, this.cfg.folderEnv ?? process.env); }
  private objectKey(key: string): string {
    const rel = this.relative(key); const p = this.prefix();
    return p ? `${p}/${rel}` : rel;
  }
  private bucketBase(): string {
    if (this.cfg.endpoint) return `${this.cfg.endpoint.replace(/\/+$/, '')}/${this.cfg.bucket}`;
    return `https://${this.cfg.bucket}.s3.${this.region}.amazonaws.com`;
  }

  private publicUrl(key: string): string {
    // CDN: its origin path is the bucket prefix, so the URL carries the key relative to it (env segment included).
    if (this.cfg.cdnBaseUrl) return `${this.cfg.cdnBaseUrl.replace(/\/+$/, '')}/${this.relative(key)}`;
    return `${this.bucketBase()}/${this.objectKey(key)}`;
  }

  /** A full URL this store handed out → the exact object key (works for objects written before the env segment). */
  private objectKeyFromUrl(url: string): string | null {
    const cdn = this.cfg.cdnBaseUrl?.replace(/\/+$/, '');
    if (cdn && url.startsWith(cdn + '/')) { const p = this.prefix(); const rel = url.slice(cdn.length + 1); return p ? `${p}/${rel}` : rel; }
    const base = this.bucketBase();
    if (url.startsWith(base + '/')) return url.slice(base.length + 1);
    return null;
  }

  async put(key: string, body: Buffer): Promise<{ url: string }> {
    const clean = key.replace(/^\/+/, '');
    if (clean.includes('..')) throw new Error('Invalid media key.');
    await this.client.send(new this.mod.PutObjectCommand({
      Bucket: this.cfg.bucket,
      Key: this.objectKey(clean),
      Body: body,
      ContentType: this.getContentType(clean)
    }));
    return { url: this.publicUrl(clean) };
  }

  private getContentType(key: string): string {
    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'svg') return 'image/svg+xml';
    if (ext === 'pdf') return 'application/pdf';
    return 'application/octet-stream';
  }

  async remove(key: string): Promise<void> {
    const raw = String(key ?? '').trim();
    if (!raw) return;
    let objectKey: string | null;
    if (/^https?:\/\//i.test(raw)) objectKey = this.objectKeyFromUrl(raw);   // not one of ours → nothing to delete
    else { const clean = raw.replace(/^\/+/, ''); objectKey = clean.includes('..') ? null : this.objectKey(clean); }
    if (!objectKey) return;
    try { await this.client.send(new this.mod.DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: objectKey })); } catch { /* best-effort */ }
  }

  /** §169: abort multipart uploads under this store's prefix that were initiated before `cutoff` (the bucket lifecycle
   *  rule in deploy/storage-lifecycle.json does the same after 1 day; this is the belt to that braces). */
  async sweepAbandoned(cutoff: Date): Promise<number> {
    if (!this.mod.ListMultipartUploadsCommand || !this.mod.AbortMultipartUploadCommand) return 0;
    const p = this.prefix();
    let n = 0; let keyMarker: string | undefined; let uploadIdMarker: string | undefined;
    for (let page = 0; page < 100; page++) {
      const res: any = await this.client.send(new this.mod.ListMultipartUploadsCommand({
        Bucket: this.cfg.bucket, ...(p ? { Prefix: `${p}/` } : {}), ...(keyMarker ? { KeyMarker: keyMarker, UploadIdMarker: uploadIdMarker } : {}),
      }));
      for (const u of res?.Uploads ?? []) {
        if (!u?.Key || !u?.UploadId || !(new Date(u.Initiated).getTime() < cutoff.getTime())) continue;
        try { await this.client.send(new this.mod.AbortMultipartUploadCommand({ Bucket: this.cfg.bucket, Key: u.Key, UploadId: u.UploadId })); n++; } catch { /* next run */ }
      }
      if (!res?.IsTruncated) break;
      keyMarker = res.NextKeyMarker; uploadIdMarker = res.NextUploadIdMarker;
    }
    return n;
  }

  // Objects are not on the local filesystem — serving happens via the public/CDN URL from put(), not by streaming.
  resolvePath(): string | null { return null; }
}

/**
 * Env selector for the media backend (Scaling Phase 4, Phase 11). Defaults to local disk (unchanged behavior). Set
 * MEDIA_STORE=s3 plus MEDIA_S3_BUCKET and a region (MEDIA_S3_REGION, else AWS_REGION) — and optionally MEDIA_S3_ENDPOINT /
 * MEDIA_CDN_BASE_URL / MEDIA_S3_PREFIX / MEDIA_ENV — to store uploads in object storage so they survive redeploys and
 * can be CDN-served. Outside production a misconfigured S3 store falls back to local disk with a warning; IN production
 * the boot check (mediaStorageConfigErrors, called from production-config) refuses to start first.
 */
export function makeMediaStorage(env: NodeJS.ProcessEnv = process.env, sdk?: S3Sdk): MediaStorage {
  // BUILD_PLAN Phase 14 B: every store a caller gets is instrumented (ops / bytes / errors / latency by store 'media').
  return instrumentStore(selectMediaStorage(env, sdk), 'media');
}

/** The private support-attachment store (local disk under SUPPORT_ATTACHMENTS_ROOT, never served publicly), instrumented
 *  as store 'support_attachments'. The help module and the media.lifecycle job build it the same way. */
export function makeSupportAttachmentStorage(env: NodeJS.ProcessEnv = process.env): MediaStorage {
  return instrumentStore(new LocalDiskMediaStorage(env.SUPPORT_ATTACHMENTS_ROOT || join(process.cwd(), 'private-attachments')), 'support_attachments');
}

function selectMediaStorage(env: NodeJS.ProcessEnv, sdk?: S3Sdk): MediaStorage {
  const store = String(env.MEDIA_STORE ?? '').trim().toLowerCase();
  if (store === 's3') {
    try {
      const bucket = env.MEDIA_S3_BUCKET;
      if (!bucket) throw new Error('MEDIA_S3_BUCKET is required when MEDIA_STORE=s3');
      return new S3MediaStorage({
        bucket,
        region: mediaRegion(env),
        endpoint: env.MEDIA_S3_ENDPOINT,
        cdnBaseUrl: env.MEDIA_CDN_BASE_URL,
        keyPrefix: env.MEDIA_S3_PREFIX,
        forcePathStyle: String(env.MEDIA_S3_FORCE_PATH_STYLE ?? '').toLowerCase() === 'true',
        envSegment: mediaEnvSegment(env),
        folderEnv: env,
      }, sdk);
    } catch (err: any) {
      console.error(`media: MEDIA_STORE=s3 requested but unavailable (${err?.message ?? err}); falling back to local disk.`);
      return new LocalDiskMediaStorage(env.MEDIA_ROOT || undefined);
    }
  }
  // the caller's env decides the root (Phase 14 B: it used to read process.env here, ignoring the env passed in)
  return new LocalDiskMediaStorage(env.MEDIA_ROOT || undefined);
}

/**
 * Dynamically construct the full public URL for a media file key (e.g. 'avatar-1785137566058.png').
 * If the key is already a full HTTP URL or absolute path, it is returned as-is.
 * This is used to hydrate database rows that only store the filename.
 */
export function buildMediaUrl(key: string | null, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!key) return null;
  const trimmed = key.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;   // legacy + current full URLs

  // Legacy rows that hold only a filename (or an …images/<name> path) from the old live bucket: served from the
  // configured base. Phase 11: no hard-coded bucket — set MEDIA_LIVE_IMAGE_BASE to the old bucket's images/ URL.
  const liveBase = env.MEDIA_LIVE_IMAGE_BASE || env.VITE_LIVE_IMAGE_BASE;
  // Phase 12: ONLY a legacy bare filename (or an …images/<name> path) — a structured key (`tenants/<id>/…`, written by
  // uploadObjectKey) lives in the CURRENT store; sending it to the old bucket under its last segment served nothing
  if (liveBase && (!trimmed.includes('/') || trimmed.includes('images/'))) {
    const base = liveBase.endsWith('/') ? liveBase : `${liveBase}/`;
    const imageName = trimmed.includes('images/') ? trimmed.split('images/').pop()?.replace(/^\/+/, '') : trimmed.replace(/^.*[/\\]/, '').replace(/^\/+/, '');
    if (imageName) return `${base}${imageName}`;
  }

  const store = String(env.MEDIA_STORE ?? '').trim().toLowerCase();
  if (store === 's3' && env.MEDIA_S3_BUCKET) {
    // EXACTLY the key and region the S3 adapter wrote with (one function, one region source).
    const rel = relativeObjectKey(trimmed, mediaEnvSegment(env), env);
    if (env.MEDIA_CDN_BASE_URL) return `${env.MEDIA_CDN_BASE_URL.replace(/\/+$/, '')}/${rel}`;
    const prefix = trimSlashes(env.MEDIA_S3_PREFIX ?? '');
    const objectKey = prefix ? `${prefix}/${rel}` : rel;
    if (env.MEDIA_S3_ENDPOINT) return `${env.MEDIA_S3_ENDPOINT.replace(/\/+$/, '')}/${env.MEDIA_S3_BUCKET}/${objectKey}`;
    const region = mediaRegion(env);
    if (region) return `https://${env.MEDIA_S3_BUCKET}.s3.${region}.amazonaws.com/${objectKey}`;
  }

  if (trimmed.startsWith('/')) return trimmed;
  return MEDIA_URL_PREFIX + trimmed.replace(/^\/+/, '');   // local disk (served by the API's /media route)
}
