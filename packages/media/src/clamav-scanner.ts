// clamav-scanner.ts — BUILD_PLAN Phase 14 (Constitution 12 "Malware scanning works"): a real MalwareScanner for the
// Phase 12 upload policy — ClamAV's clamd over TCP (INSTREAM), used by acceptUpload whenever CLAMAV_HOST is set.
//
//   CLAMAV_HOST          clamd host (e.g. clamav.railway.internal). Unset → no scanner: the honest 'unscanned' verdict.
//   CLAMAV_PORT          default 3310
//   CLAMAV_TIMEOUT_MS    default 15000 — a scan that takes longer is an error
//   CLAMAV_REQUIRED=1    an unreachable / failing clamd REFUSES the upload (SCAN_UNAVAILABLE) instead of accepting it as
//                        'unscanned' (the default — an AV outage must not stop a salon uploading its logo, and nothing
//                        ever claims 'clean' without clamd saying so)
//
// The protocol (clamd(8)): send "zINSTREAM\0", then the bytes as chunks each prefixed by a 4-byte big-endian length,
// then a zero-length chunk; clamd answers one NUL-terminated line: "stream: OK", "stream: <Signature> FOUND" or
// "… ERROR". Nothing but an explicit "OK" is clean.
//
// QUARANTINE: an infected file is never stored where the upload was going. The quarantining wrapper writes the bytes and
// a manifest (sha256, signature, policy, salon, time) to the PRIVATE store under `<env>/quarantine/<owner>/<sha256>/`
// (never public, never served), logs a warning, and the upload is refused with MALWARE. The quarantine is best-effort:
// a failed quarantine write never lets the file through.
import { createHash } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import type { MalwareScanner, ScanStatus, UploadKind } from './upload-policy';
import { privateObjectKey, type PrivateObjectStore } from './private-store';

export interface ClamAvOptions { host: string; port?: number; timeoutMs?: number; chunkBytes?: number }
export class ClamAvError extends Error { constructor(message: string) { super(message); this.name = 'ClamAvError'; } }

/** Parse clamd's one-line answer. Exported for its spec. */
export function parseClamdReply(line: string): { status: ScanStatus; detail?: string } {
  const s = line.replace(/\0+$/, '').trim();
  if (/^(stream|\S+): OK$/.test(s)) return { status: 'clean' };
  const found = /^(?:stream|\S+): (.+) FOUND$/.exec(s);
  if (found) return { status: 'infected', detail: found[1].slice(0, 200) };
  throw new ClamAvError(`clamd: ${s.slice(0, 200) || 'empty reply'}`);
}

export class ClamAvScanner implements MalwareScanner {
  readonly host: string; readonly port: number; private readonly timeoutMs: number; private readonly chunk: number;
  constructor(o: ClamAvOptions) { this.host = o.host; this.port = o.port ?? 3310; this.timeoutMs = o.timeoutMs ?? 15_000; this.chunk = Math.max(1024, Math.min(o.chunkBytes ?? 64 * 1024, 1024 * 1024)); }

  scan(input: { bytes: Uint8Array }): Promise<{ status: ScanStatus; detail?: string }> {
    return new Promise((resolve, reject) => {
      let sock: Socket; let reply = ''; let settled = false;
      const done = (err: Error | null, v?: { status: ScanStatus; detail?: string }) => {
        if (settled) return; settled = true; clearTimeout(timer); try { sock?.destroy(); } catch { /* closed */ }
        if (err) reject(err); else resolve(v!);
      };
      const timer = setTimeout(() => done(new ClamAvError(`clamd did not answer within ${this.timeoutMs} ms`)), this.timeoutMs);
      sock = connect({ host: this.host, port: this.port }, () => {
        sock.write('zINSTREAM\0');
        const b = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
        for (let i = 0; i < b.length; i += this.chunk) {
          const part = b.subarray(i, Math.min(b.length, i + this.chunk));
          const len = Buffer.alloc(4); len.writeUInt32BE(part.length, 0);
          sock.write(len); sock.write(part);
        }
        sock.write(Buffer.alloc(4));   // zero-length chunk: end of stream
      });
      sock.setNoDelay(true);
      sock.on('data', (d) => {
        reply += d.toString('utf8');
        if (reply.includes('\0')) { try { done(null, parseClamdReply(reply.slice(0, reply.indexOf('\0')))); } catch (e: any) { done(e); } }
      });
      sock.on('end', () => { if (!settled) { try { done(null, parseClamdReply(reply)); } catch (e: any) { done(e); } } });
      sock.on('error', (e) => done(new ClamAvError(`clamd unreachable at ${this.host}:${this.port}: ${e?.message ?? e}`)));
    });
  }
}

export interface QuarantineRecord { sha256: string; signature: string; policy: string; kind: UploadKind; tenantId: string | null; bytes: number; at: string; key: string }
export type MalwareDetectedHook = (r: QuarantineRecord) => void;

/** Wraps a scanner: an 'infected' verdict quarantines the bytes (private store) before it is returned; an error from the
 *  scanner becomes SCAN_UNAVAILABLE when `required`, else is passed on (acceptUpload then records 'unscanned'). */
export class QuarantiningScanner implements MalwareScanner {
  constructor(private readonly inner: MalwareScanner, private readonly store: PrivateObjectStore | null, private readonly opts: { required?: boolean; onDetected?: MalwareDetectedHook; env?: NodeJS.ProcessEnv; log?: (m: string) => void } = {}) {}
  async scan(input: { bytes: Uint8Array; kind: UploadKind; policy: string; tenantId: string | null }): Promise<{ status: ScanStatus; detail?: string }> {
    let v: { status: ScanStatus; detail?: string };
    try { v = await this.inner.scan(input); }
    catch (e: any) {
      if (this.opts.required) return { status: 'infected', detail: 'SCAN_UNAVAILABLE' };   // refuse: the scan was required and could not run
      throw e;
    }
    if (v.status !== 'infected') return v;
    const bytes = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const owner = input.tenantId && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(input.tenantId) ? input.tenantId : 'platform';
    const env = this.opts.env ?? process.env;
    const key = privateObjectKey('quarantine', owner, sha256, `${input.policy}.bin`, env);
    const rec: QuarantineRecord = { sha256, signature: v.detail ?? 'unknown', policy: input.policy, kind: input.kind, tenantId: input.tenantId, bytes: bytes.length, at: new Date().toISOString(), key };
    try {
      if (this.store) {
        await this.store.put(key, bytes, 'application/octet-stream');
        await this.store.put(privateObjectKey('quarantine', owner, sha256, 'manifest.json', env), Buffer.from(JSON.stringify(rec)), 'application/json');
      }
    } catch (e: any) { (this.opts.log ?? console.error)(`[malware] quarantine write failed for ${sha256}: ${e?.message ?? e}`); }
    (this.opts.log ?? console.warn)(`[malware] upload refused and quarantined: policy=${rec.policy} signature=${rec.signature} sha256=${sha256} tenant=${rec.tenantId ?? 'none'}`);
    try { this.opts.onDetected?.(rec); } catch { /* a hook never changes the verdict */ }
    return v;
  }
}

/** The scanner this environment configures: clamd behind the quarantine when CLAMAV_HOST is set, else null. */
export function malwareScannerFromEnv(env: NodeJS.ProcessEnv = process.env, store: PrivateObjectStore | null = null, onDetected?: MalwareDetectedHook): MalwareScanner | null {
  const host = String(env.CLAMAV_HOST ?? '').trim();
  if (!host) return null;
  const port = Number(env.CLAMAV_PORT) > 0 ? Math.floor(Number(env.CLAMAV_PORT)) : 3310;
  const timeoutMs = Number(env.CLAMAV_TIMEOUT_MS) > 0 ? Math.floor(Number(env.CLAMAV_TIMEOUT_MS)) : 15_000;
  return new QuarantiningScanner(new ClamAvScanner({ host, port, timeoutMs }), store, { required: env.CLAMAV_REQUIRED === '1', onDetected, env });
}
