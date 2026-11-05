// clamav-scanner.vitest.spec.ts — BUILD_PLAN Phase 14 (Constitution 12 "Malware scanning works"): the ClamAV adapter
// against a FAKE clamd (a real TCP server speaking the INSTREAM protocol), through the real upload policy:
//   • the EICAR test string is refused (MALWARE) and quarantined in the private store with a manifest; a clean file passes
//     with scanStatus 'clean'; the bytes clamd received are exactly the uploaded bytes (chunked framing decoded)
//   • clamd down: 'unscanned' by default, refused (503 SCAN_UNAVAILABLE) with CLAMAV_REQUIRED=1; never 'clean'
//   • the env wiring: no CLAMAV_HOST → no scanner; set → acceptUpload uses clamd without the caller passing anything
// The EICAR string is assembled at run time so this file itself is never flagged by an antivirus or a secret scanner.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer, type Server, type Socket } from 'node:net';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acceptUpload, UPLOAD_POLICIES, UploadRejected, installMalwareScanner, defaultMalwareScanner, NO_MALWARE_SCANNER } from './upload-policy';
import { ClamAvScanner, QuarantiningScanner, malwareScannerFromEnv, parseClamdReply } from './clamav-scanner';
import { LocalDiskPrivateStore } from './private-store';

const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS', '-TEST-FILE!$H+H*'].join('');

/** A fake clamd: decodes zINSTREAM framing, answers FOUND for the EICAR string, OK otherwise. */
function fakeClamd(): Promise<{ server: Server; port: number; received: Buffer[] }> {
  const received: Buffer[] = [];
  const server = createServer((sock: Socket) => {
    let buf = Buffer.alloc(0); let gotCmd = false; const body: Buffer[] = [];
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d as Buffer]);
      if (!gotCmd) { const z = buf.indexOf(0); if (z < 0) return; if (buf.subarray(0, z).toString() !== 'zINSTREAM') { sock.end('UNKNOWN COMMAND\0'); return; } buf = buf.subarray(z + 1); gotCmd = true; }
      while (buf.length >= 4) {
        const n = buf.readUInt32BE(0);
        if (n === 0) {
          const all = Buffer.concat(body); received.push(all);
          sock.end(all.toString('latin1').includes(EICAR) ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
          return;
        }
        if (buf.length < 4 + n) return;
        body.push(buf.subarray(4, 4 + n)); buf = buf.subarray(4 + n);
      }
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: (server.address() as any).port, received })));
}

describe('ClamAV adapter + upload policy against a fake clamd', () => {
  let clamd: Awaited<ReturnType<typeof fakeClamd>>; let root: string; let store: LocalDiskPrivateStore;
  beforeAll(async () => { clamd = await fakeClamd(); root = mkdtempSync(join(tmpdir(), 'quarantine-')); store = new LocalDiskPrivateStore(root); });
  afterAll(async () => { await new Promise((r) => clamd.server.close(r)); rmSync(root, { recursive: true, force: true }); });
  afterEach(() => installMalwareScanner(undefined));

  it('parses clamd answers; only an explicit OK is clean', () => {
    expect(parseClamdReply('stream: OK\0')).toEqual({ status: 'clean' });
    expect(parseClamdReply('stream: Eicar-Test-Signature FOUND')).toEqual({ status: 'infected', detail: 'Eicar-Test-Signature' });
    expect(() => parseClamdReply('INSTREAM size limit exceeded. ERROR')).toThrow(/ERROR/);
    expect(() => parseClamdReply('')).toThrow();
  });

  it('EICAR is refused with MALWARE and quarantined (bytes + manifest) in the private store; nothing else is written', async () => {
    const seen: any[] = [];
    const scanner = new QuarantiningScanner(new ClamAvScanner({ host: '127.0.0.1', port: clamd.port, chunkBytes: 1024 }), store, { onDetected: (r) => seen.push(r), log: () => undefined, env: { NODE_ENV: 'test' } as any });
    const bytes = Buffer.from(EICAR + '\n');
    const err = await acceptUpload(UPLOAD_POLICIES.supportAttachment, { bytes, filename: 'notes.txt', declaredType: 'text/plain', tenantId: 'tenant-1' }, { scanner }).catch((e) => e);
    expect(err).toBeInstanceOf(UploadRejected);
    expect(err.reason).toBe('MALWARE');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ signature: 'Eicar-Test-Signature', policy: 'supportAttachment', tenantId: 'tenant-1', bytes: bytes.length });
    const q = await store.get(seen[0].key);
    expect(q?.equals(bytes)).toBe(true);
    expect(seen[0].key).toMatch(/\/quarantine\/tenant-1\/[0-9a-f]{64}\/supportAttachment\.bin$/);
    const manifest = JSON.parse(String(await store.get(seen[0].key.replace(/supportAttachment\.bin$/, 'manifest.json'))));
    expect(manifest).toMatchObject({ signature: 'Eicar-Test-Signature', sha256: seen[0].sha256 });
  });

  it('a clean multi-chunk file passes as clean, and clamd received exactly the uploaded bytes', async () => {
    const scanner = new QuarantiningScanner(new ClamAvScanner({ host: '127.0.0.1', port: clamd.port, chunkBytes: 1024 }), store, { log: () => undefined });
    const bytes = Buffer.from('date,service,price\n' + 'x,manicure,2500\n'.repeat(400));   // ~6 KB → 7 chunks
    const before = clamd.received.length;
    const up = await acceptUpload(UPLOAD_POLICIES.supportAttachment, { bytes, filename: 'list.csv', declaredType: 'text/csv', tenantId: 'tenant-1' }, { scanner });
    expect(up.scanStatus).toBe('clean');
    expect(clamd.received[before].equals(up.bytes)).toBe(true);
  });

  it('clamd down: accepted as unscanned (never clean) by default; refused 503 SCAN_UNAVAILABLE when required', async () => {
    const dead = new ClamAvScanner({ host: '127.0.0.1', port: 1, timeoutMs: 2000 });
    const bytes = Buffer.from('hello\n');
    const soft = await acceptUpload(UPLOAD_POLICIES.supportAttachment, { bytes, filename: 'a.txt', tenantId: 't' }, { scanner: new QuarantiningScanner(dead, null, { log: () => undefined }) });
    expect(soft.scanStatus).toBe('unscanned');
    const err = await acceptUpload(UPLOAD_POLICIES.supportAttachment, { bytes, filename: 'a.txt', tenantId: 't' }, { scanner: new QuarantiningScanner(dead, null, { required: true, log: () => undefined }) }).catch((e) => e);
    expect(err).toMatchObject({ reason: 'SCAN_UNAVAILABLE', status: 503 });
  });

  it('env wiring: no CLAMAV_HOST → no scanner; CLAMAV_HOST set → acceptUpload scans by default (the callers pass nothing)', async () => {
    expect(malwareScannerFromEnv({} as any)).toBeNull();
    installMalwareScanner(null);
    expect(defaultMalwareScanner()).toBe(NO_MALWARE_SCANNER);
    const fromEnv = malwareScannerFromEnv({ CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: String(clamd.port), NODE_ENV: 'test' } as any, store);
    expect(fromEnv).toBeInstanceOf(QuarantiningScanner);
    installMalwareScanner(fromEnv);
    const err = await acceptUpload(UPLOAD_POLICIES.supportAttachment, { bytes: Buffer.from(EICAR), filename: 'x.txt', tenantId: 'tenant-2' }).catch((e) => e);
    expect(err).toMatchObject({ reason: 'MALWARE' });
    expect((readdirSync(root, { recursive: true } as any) as string[]).some((p) => String(p).includes(join('quarantine', 'tenant-2')) && String(p).endsWith('supportAttachment.bin'))).toBe(true);
  });
});
