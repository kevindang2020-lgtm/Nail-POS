// evidence-blob-store.ts — PRIVATE object storage for Safety Community evidence and OCR receipt files.
//
// ── Why this is NOT `MediaStorage` ────────────────────────────────────────────────────────────────────────
// The platform already has a `MediaStorage` port (tech-profile/media-storage.ts) with an S3 adapter, and reusing
// it would have looked like the tidy "don't duplicate" answer. It would also have been a serious privacy breach.
//
// `MediaStorage.put()` returns a **public** URL under `/media/`, and `media/(.*)` is explicitly EXCLUDED from the
// session middleware — it is world-readable by design, because it serves avatars and showcase photos. Evidence is
// the opposite: redacted screenshots of incidents, processor dispute records, police-report references. Putting
// those behind a public CDN URL would publish them.
//
// So this is a genuinely different capability, not a duplicate one:
//   * objects are written **private** (no public-read ACL, no CDN),
//   * reads are **short-lived signed URLs** only,
//   * the key namespace is tenant-scoped.
//
// ── Storage backend ──────────────────────────────────────────────────────────────────────────────────────
// Not a guess: the Terraform in this repo provisions S3, and the existing media adapter already lazy-loads
// `@aws-sdk/client-s3`. This follows the same pattern — so it works in production and degrades HONESTLY (a
// NotConnected store that never fabricates a URL) when the bucket or SDK is absent.
//
// ── What is still NOT wired ──────────────────────────────────────────────────────────────────────────────
// Malware scanning. That is a real provider decision and I will not fake it: an uploaded object stays
// `scan_status = 'unscanned'`, and the access rules (community-evidence.ts) refuse to hand an unscanned or
// infected file to anyone but the tenant that uploaded it — who already has the bytes on their own device.

export interface SignedUrl { url: string; expiresAt: string }

export interface EvidenceBlobStore {
  /** Store the bytes privately. Returns the storage key (never a URL — there is no public URL). */
  put(key: string, body: Buffer, contentType?: string): Promise<{ key: string }>;
  /** A short-lived signed URL, or null when storage is not configured (never a fabricated link). */
  signedUrl(key: string, ttlSeconds?: number): Promise<SignedUrl | null>;
  remove(key: string): Promise<void>;
  readonly connected: boolean;
  /** BUILD_PLAN Phase 8: a short-lived presigned PUT the browser uploads to directly (type, length and SHA-256 are
   *  bound into the signature). null when storage is not configured — never a fabricated URL. */
  presignPut?(key: string, opts: { contentType: string; sizeBytes: number; sha256Base64: string }, ttlSeconds?: number): Promise<{ url: string; headers: Record<string, string>; expiresAt: string } | null>;
  /** Does the object exist, and how big is it? null when it does not (or storage is not configured). */
  head?(key: string): Promise<{ sizeBytes: number } | null>;
}

export interface EvidenceS3Config {
  bucket: string;
  region?: string;
  endpoint?: string;        // S3-compatible providers (R2, Spaces, MinIO); omit for AWS
  keyPrefix?: string;
  forcePathStyle?: boolean;
}

const DEFAULT_TTL = 5 * 60;   // 5 minutes — long enough to open, short enough to be useless if leaked
export const MAX_SIGNED_URL_TTL = 60 * 60;   // Constitution 12 §323: never a permanent signed URL — one hour is the ceiling, whatever a caller asks for

/**
 * The honest no-storage store. It NEVER fabricates a signed URL: a `null` from `signedUrl()` means "there is no
 * blob storage", which the caller surfaces as such. A fake `https://…` here would be indistinguishable from a
 * working system right up until a moderator clicked it during an investigation.
 */
export class NotConnectedEvidenceBlobStore implements EvidenceBlobStore {
  readonly connected = false;
  async put(key: string): Promise<{ key: string }> { return { key }; }   // metadata still records the key
  async signedUrl(): Promise<SignedUrl | null> { return null; }
  async remove(): Promise<void> { /* nothing stored */ }
  async presignPut(): Promise<null> { return null; }
  async head(): Promise<null> { return null; }
}

export class S3EvidenceBlobStore implements EvidenceBlobStore {
  readonly connected = true;
  private client: any;
  private Put: any;
  private Get: any;
  private Del: any;
  private Head: any;
  private presign: any;

  constructor(private readonly cfg: EvidenceS3Config, sdk?: any, presigner?: any) {
    // Lazy-require, exactly as the existing media adapter does, so the SDK is only needed where it is used.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the AWS SDK is a production-only
    // dependency and is absent in dev/test; a static import would break the build everywhere it is not installed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- AWS SDK is a production-only dependency; a static import breaks builds where it is not installed.
    const mod = sdk ?? require('@aws-sdk/client-s3');
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- same: production-only dependency.
    const pre = presigner ?? require('@aws-sdk/s3-request-presigner');
    this.client = new mod.S3Client({
      region: cfg.region,
      ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: cfg.forcePathStyle ?? true } : {}),
    });
    this.Put = mod.PutObjectCommand;
    this.Get = mod.GetObjectCommand;
    this.Del = mod.DeleteObjectCommand;
    this.Head = mod.HeadObjectCommand;
    this.presign = pre.getSignedUrl;
  }

  private objectKey(key: string): string {
    const prefix = (this.cfg.keyPrefix || '').replace(/^\/+|\/+$/g, '');
    const k = key.replace(/^\/+/, '');
    return prefix ? `${prefix}/${k}` : k;
  }

  async put(key: string, body: Buffer, contentType?: string): Promise<{ key: string }> {
    await this.client.send(new this.Put({
      Bucket: this.cfg.bucket,
      Key: this.objectKey(key),
      Body: body,
      ContentType: contentType || 'application/octet-stream',
      // NO public-read ACL. Evidence is private; the ONLY way to read it is a signed URL issued after the
      // access rules in community-evidence.ts have passed.
      ServerSideEncryption: 'AES256',
    }));
    return { key };
  }

  async signedUrl(key: string, ttlSeconds = DEFAULT_TTL): Promise<SignedUrl> {
    ttlSeconds = Math.max(1, Math.min(Number(ttlSeconds) || DEFAULT_TTL, MAX_SIGNED_URL_TTL));
    const cmd = new this.Get({ Bucket: this.cfg.bucket, Key: this.objectKey(key) });
    const url = await this.presign(this.client, cmd, { expiresIn: ttlSeconds });
    return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString() };
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new this.Del({ Bucket: this.cfg.bucket, Key: this.objectKey(key) }));
  }

  async presignPut(key: string, opts: { contentType: string; sizeBytes: number; sha256Base64: string }, ttlSeconds = 600): Promise<{ url: string; headers: Record<string, string>; expiresAt: string }> {
    ttlSeconds = Math.max(1, Math.min(Number(ttlSeconds) || 600, 600));   // ≤ 10 minutes, whatever a caller asks for
    const cmd = new this.Put({
      Bucket: this.cfg.bucket, Key: this.objectKey(key), ContentType: opts.contentType, ContentLength: opts.sizeBytes,
      ChecksumSHA256: opts.sha256Base64, ServerSideEncryption: 'AES256',   // private, encrypted, no ACL
    });
    const url = await this.presign(this.client, cmd, { expiresIn: ttlSeconds, signableHeaders: new Set(['content-type', 'content-length', 'x-amz-checksum-sha256']) });
    return {
      url, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      headers: { 'Content-Type': opts.contentType, 'x-amz-checksum-sha256': opts.sha256Base64, 'x-amz-server-side-encryption': 'AES256' },
    };
  }

  async head(key: string): Promise<{ sizeBytes: number } | null> {
    try {
      const out: any = await this.client.send(new this.Head({ Bucket: this.cfg.bucket, Key: this.objectKey(key) }));
      return { sizeBytes: Number(out?.ContentLength ?? 0) };
    } catch { return null; }   // NotFound (or unreachable) — the upload is not there; never assume it is
  }
}

/**
 * Choose the store from the environment. Falls back to NotConnected — never to something that pretends to work.
 *
 * EVIDENCE_S3_BUCKET must be a DIFFERENT bucket (or at least a different prefix) from the public media bucket.
 * Pointing it at the media bucket would put private evidence behind the public CDN.
 */
export function makeEvidenceBlobStore(env: NodeJS.ProcessEnv = process.env): EvidenceBlobStore {
  const bucket = env.EVIDENCE_S3_BUCKET;
  if (!bucket) return new NotConnectedEvidenceBlobStore();
  try {
    return new S3EvidenceBlobStore({
      bucket,
      region: env.EVIDENCE_S3_REGION || env.AWS_REGION,
      endpoint: env.EVIDENCE_S3_ENDPOINT,
      keyPrefix: env.EVIDENCE_S3_PREFIX,
      forcePathStyle: env.EVIDENCE_S3_FORCE_PATH_STYLE === '1',
    });
  } catch {
    // SDK missing / misconfigured → stay honest rather than half-working.
    return new NotConnectedEvidenceBlobStore();
  }
}
