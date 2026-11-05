// evidence-scanner.ts — the malware-scan status of an evidence object.
//
// The Safety Community will not release a raw evidence file until its scan status is `clean`. Until now the only
// implementation returned `unscanned` forever, so evidence could **never** be viewed — the feature was blocked.
//
// The design deliberately does NOT pick a scanning vendor for you. Scanning a blob is an object-storage concern,
// and every credible S3 scanner works the same way: it scans the object out-of-band and **tags** it with the
// result. So this reads the tag.
//
//   • AWS GuardDuty Malware Protection for S3 tags objects with `GuardDutyMalwareScanStatus`
//     (`NO_THREATS_FOUND` / `THREATS_FOUND` / `UNSUPPORTED` / `ACCESS_DENIED` / `FAILED`). It is the natural fit
//     here — the platform already runs on AWS — and turning it on requires no code change at all.
//   • A ClamAV Lambda, Cloudflare R2 worker, or any bespoke scanner works too, as long as it writes a tag. The
//     tag key is configurable (`EVIDENCE_SCAN_TAG_KEY`).
//
// The safety rule, and the reason this file is short: **it fails closed.**
//   - no tag yet          → `unscanned` (the scanner hasn't run; access stays blocked)
//   - threats found       → `infected`  (blocked, and it stays blocked)
//   - scan failed/denied  → `unscanned` (we do NOT treat a failed scan as clean)
//   - lookup error        → `unscanned` (a network blip must never read as "clean")
//
// There is no code path here that can return `clean` without a scanner having explicitly said so.
import type { EvidenceScanner } from '../tenant-safety-community/community-evidence';

type ScanStatus = 'unscanned' | 'clean' | 'infected';

export interface EvidenceScanConfig {
  bucket: string;
  region?: string;
  endpoint?: string;
  keyPrefix?: string;
  forcePathStyle?: boolean;
  /** Tag key the scanner writes. Defaults to GuardDuty's. */
  tagKey?: string;
}

/** Map a scanner's tag value to our status. Anything we do not explicitly recognise as clean is NOT clean. */
export function mapScanTag(value: string | undefined | null): ScanStatus {
  const v = String(value ?? '').trim().toUpperCase();
  if (!v) return 'unscanned';

  // Clean — the only values that may ever produce `clean`.
  if (v === 'NO_THREATS_FOUND' || v === 'CLEAN' || v === 'NO_THREATS' || v === 'OK') return 'clean';

  // Explicitly bad.
  if (v === 'THREATS_FOUND' || v === 'INFECTED' || v === 'MALICIOUS') return 'infected';

  // FAILED, ACCESS_DENIED, UNSUPPORTED, PENDING, or anything unrecognised → not scanned. NEVER clean.
  return 'unscanned';
}

/** The honest no-scanner scanner. Never claims anything is clean, so evidence stays locked. */
export class NotConnectedEvidenceScanner implements EvidenceScanner {
  async scan(): Promise<{ status: ScanStatus }> {
    return { status: 'unscanned' };
  }
}

/** Reads the scan result an S3-side scanner wrote onto the object as a tag. */
export class S3TagEvidenceScanner implements EvidenceScanner {
  private readonly tagKey: string;
  private client: any;

  constructor(private readonly cfg: EvidenceScanConfig, private readonly injectedSdk?: any) {
    this.tagKey = cfg.tagKey || 'GuardDutyMalwareScanStatus';
  }

  // The AWS SDK is a production-only dependency and is not installed in every environment. The existing blob
  // store resolves it at RUNTIME for exactly this reason; do the same, and degrade honestly if it is absent.
  private sdk(): any | null {
    if (this.injectedSdk) return this.injectedSdk;
    try {
      // Resolved at runtime: the AWS SDK is a production-only dependency and is absent in some environments.
      // (The existing evidence blob store lazy-requires it the same way.)
      const req: NodeRequire = eval('require');
      return req('@aws-sdk/client-s3');
    } catch {
      return null;   // no SDK → we cannot read a tag → `unscanned`, never `clean`
    }
  }

  private s3(mod: any) {
    if (this.client) return this.client;
    this.client = new mod.S3Client({
      region: this.cfg.region,
      ...(this.cfg.endpoint ? { endpoint: this.cfg.endpoint, forcePathStyle: this.cfg.forcePathStyle ?? true } : {}),
    });
    return this.client;
  }

  async scan(storageKey: string): Promise<{ status: ScanStatus }> {
    if (!storageKey) return { status: 'unscanned' };
    const mod = this.sdk();
    if (!mod) return { status: 'unscanned' };
    try {
      const client = this.s3(mod);
      const key = this.cfg.keyPrefix ? `${this.cfg.keyPrefix.replace(/\/+$/, '')}/${storageKey}` : storageKey;

      const out: any = await client.send(new mod.GetObjectTaggingCommand({ Bucket: this.cfg.bucket, Key: key }));
      const tag = (out?.TagSet || []).find((t: any) => String(t?.Key) === this.tagKey);
      return { status: mapScanTag(tag?.Value) };
    } catch {
      // The object may not exist yet, the tag may not be written, or S3 may be unreachable. NONE of those is
      // "clean". Failing closed here is the whole point: a scanner outage must not silently unlock evidence.
      return { status: 'unscanned' };
    }
  }
}

/**
 * Build the scanner from the environment. Same shape as `makeEvidenceBlobStore()`.
 * With no bucket configured you get the honest no-scanner scanner — evidence stays locked rather than being
 * quietly released.
 */
export function makeEvidenceScanner(env: NodeJS.ProcessEnv = process.env): EvidenceScanner {
  const bucket = env.EVIDENCE_S3_BUCKET;
  if (!bucket) return new NotConnectedEvidenceScanner();
  // An operator can explicitly disable tag-reading (e.g. scanning not enabled on the bucket yet).
  if (env.EVIDENCE_SCAN_ENABLED === '0') return new NotConnectedEvidenceScanner();
  try {
    return new S3TagEvidenceScanner({
      bucket,
      region: env.EVIDENCE_S3_REGION || env.AWS_REGION,
      endpoint: env.EVIDENCE_S3_ENDPOINT,
      keyPrefix: env.EVIDENCE_S3_PREFIX,
      forcePathStyle: env.EVIDENCE_S3_FORCE_PATH_STYLE === '1',
      tagKey: env.EVIDENCE_SCAN_TAG_KEY,
    });
  } catch {
    return new NotConnectedEvidenceScanner();   // misconfiguration must not unlock evidence
  }
}
