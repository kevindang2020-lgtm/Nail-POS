// evidence-scanner.vitest.spec.ts — the malware scanner must FAIL CLOSED.
//
// The Safety Community will not release a raw evidence file until its scan status is `clean`. So the single most
// dangerous thing this code could do is return `clean` when it doesn't actually know. Every unknown, every
// failure, every outage must read as `unscanned` — evidence stays locked.
//
// The design reads the scan result an S3-side scanner writes onto the object as a **tag** (AWS GuardDuty Malware
// Protection does exactly this). That keeps the vendor choice out of the code: any scanner that tags objects
// works, and enabling GuardDuty needs no code change at all.
import { describe, it, expect, afterEach } from 'vitest';
import { mapScanTag, makeEvidenceScanner, NotConnectedEvidenceScanner, S3TagEvidenceScanner } from './evidence-scanner';

const prev = { ...process.env };
afterEach(() => {
  for (const k of ['EVIDENCE_S3_BUCKET', 'EVIDENCE_SCAN_ENABLED', 'EVIDENCE_SCAN_TAG_KEY']) delete process.env[k];
  Object.assign(process.env, prev);
});

describe('tag → status mapping fails closed', () => {
  it('recognises a genuinely clean scan', () => {
    expect(mapScanTag('NO_THREATS_FOUND')).toBe('clean');   // GuardDuty
    expect(mapScanTag('clean')).toBe('clean');
    expect(mapScanTag('OK')).toBe('clean');
  });

  it('recognises a threat', () => {
    expect(mapScanTag('THREATS_FOUND')).toBe('infected');   // GuardDuty
    expect(mapScanTag('INFECTED')).toBe('infected');
  });

  it('a FAILED scan is NOT clean', () => {
    expect(mapScanTag('FAILED')).toBe('unscanned');
    expect(mapScanTag('ACCESS_DENIED')).toBe('unscanned');
    expect(mapScanTag('UNSUPPORTED')).toBe('unscanned');
  });

  it('no tag at all is NOT clean (the scanner simply has not run yet)', () => {
    expect(mapScanTag(undefined)).toBe('unscanned');
    expect(mapScanTag(null)).toBe('unscanned');
    expect(mapScanTag('')).toBe('unscanned');
  });

  it('anything UNRECOGNISED is NOT clean — the default can never be permissive', () => {
    for (const v of ['PENDING', 'IN_PROGRESS', 'weird', 'true', '1', 'SKIPPED', 'null']) {
      expect(mapScanTag(v), `"${v}" must not read as clean`).not.toBe('clean');
    }
  });
});

describe('the no-scanner scanner never unlocks evidence', () => {
  it('always reports unscanned', async () => {
    expect(await new NotConnectedEvidenceScanner().scan()).toEqual({ status: 'unscanned' });
  });

  it('with no bucket configured, that is what you get — evidence stays locked', async () => {
    delete process.env.EVIDENCE_S3_BUCKET;
    const s = makeEvidenceScanner(process.env);
    expect(s).toBeInstanceOf(NotConnectedEvidenceScanner);
    expect(await s.scan('any-key')).toEqual({ status: 'unscanned' });
  });

  it('an operator can explicitly disable scanning — and evidence stays locked, not released', async () => {
    process.env.EVIDENCE_S3_BUCKET = 'evidence-bucket';
    process.env.EVIDENCE_SCAN_ENABLED = '0';
    const s = makeEvidenceScanner(process.env);
    expect(s).toBeInstanceOf(NotConnectedEvidenceScanner);
    expect(await s.scan('k')).toEqual({ status: 'unscanned' });
  });
});

describe('the S3 tag scanner', () => {
  it('is selected when a bucket IS configured', () => {
    process.env.EVIDENCE_S3_BUCKET = 'evidence-bucket';
    expect(makeEvidenceScanner(process.env)).toBeInstanceOf(S3TagEvidenceScanner);
  });

  it('an empty storage key is unscanned, not clean', async () => {
    const s = new S3TagEvidenceScanner({ bucket: 'b' });
    expect(await s.scan('')).toEqual({ status: 'unscanned' });
  });

  it('an S3/SDK failure reads as UNSCANNED — an outage must never unlock evidence', async () => {
    // The AWS SDK is not installed in this environment, so the runtime require fails: exactly the "cannot reach
    // the scanner" path. It must fail closed.
    const s = new S3TagEvidenceScanner({ bucket: 'b', region: 'us-east-1' });
    expect(await s.scan('some/key.jpg')).toEqual({ status: 'unscanned' });
  });

  it('there is NO input that yields `clean` without a scanner having said so', async () => {
    const s = new S3TagEvidenceScanner({ bucket: 'b' });
    for (const key of ['', 'x', '../../etc/passwd', 'a'.repeat(500)]) {
      expect((await s.scan(key)).status).not.toBe('clean');
    }
  });
});

// With the SDK injected we can exercise the REAL path — reading an actual tag off an object — without AWS.
describe('reading a real tag (SDK injected)', () => {
  const fakeSdk = (tagSet: any[] | Error) => ({
    S3Client: class { async send() { if (tagSet instanceof Error) throw tagSet; return { TagSet: tagSet }; } },
    GetObjectTaggingCommand: class { constructor(public input: any) {} },
  });

  it('a GuardDuty NO_THREATS_FOUND tag unlocks the evidence', async () => {
    const s = new S3TagEvidenceScanner({ bucket: 'b' }, fakeSdk([{ Key: 'GuardDutyMalwareScanStatus', Value: 'NO_THREATS_FOUND' }]));
    expect(await s.scan('evidence/1.jpg')).toEqual({ status: 'clean' });
  });

  it('a THREATS_FOUND tag marks it infected — and it stays blocked', async () => {
    const s = new S3TagEvidenceScanner({ bucket: 'b' }, fakeSdk([{ Key: 'GuardDutyMalwareScanStatus', Value: 'THREATS_FOUND' }]));
    expect(await s.scan('evidence/1.jpg')).toEqual({ status: 'infected' });
  });

  it('the object exists but has NO scan tag yet → unscanned, not clean', async () => {
    const s = new S3TagEvidenceScanner({ bucket: 'b' }, fakeSdk([{ Key: 'Owner', Value: 'someone' }]));
    expect(await s.scan('evidence/1.jpg')).toEqual({ status: 'unscanned' });
  });

  it('an S3 error (object missing, access denied, outage) → unscanned, NEVER clean', async () => {
    const s = new S3TagEvidenceScanner({ bucket: 'b' }, fakeSdk(new Error('AccessDenied')));
    expect(await s.scan('evidence/1.jpg')).toEqual({ status: 'unscanned' });
  });

  it('a custom tag key works (any scanner that tags objects, not just GuardDuty)', async () => {
    const s = new S3TagEvidenceScanner({ bucket: 'b', tagKey: 'clamav-status' }, fakeSdk([{ Key: 'clamav-status', Value: 'CLEAN' }]));
    expect(await s.scan('evidence/1.jpg')).toEqual({ status: 'clean' });
  });
});
