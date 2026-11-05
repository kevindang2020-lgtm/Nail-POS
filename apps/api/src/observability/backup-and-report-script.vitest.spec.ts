// backup-and-report-script.vitest.spec — BUILD_PLAN Phase 14 C (Constitution 11 §114–117): the backup job template
// (deploy/backup/backup-and-report.sh) reports every outcome — success with a size, failure at the step that broke — and the
// templates carry no secret. pg_dump / pg_restore / aws are stubs on PATH; the report goes to a local server.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(process.cwd(), '..', '..');
const SCRIPT = join(ROOT, 'deploy/backup/backup-and-report.sh');
const REPORTER = join(process.cwd(), 'scripts/report-backup.mjs');
let server: Server | null = null; let bin = '';
beforeEach(() => { bin = mkdtempSync(join(tmpdir(), 'bk-bin-')); });
afterEach(async () => { rmSync(bin, { recursive: true, force: true }); await new Promise<void>((r) => (server ? server.close(() => r()) : r())); server = null; });

function listen(seen: any[]): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { seen.push({ headers: req.headers, body: JSON.parse(b || '{}') }); res.statusCode = 204; res.end(); }); });
    server.listen(0, () => resolve(`http://127.0.0.1:${(server!.address() as any).port}/internal/backups/report`));
  });
}
/** Stubs: pg_dump writes (or fails), pg_restore lists (or fails), aws records its args. */
function stubs(o: { dump?: 'ok' | 'fail' | 'empty'; restore?: 'ok' | 'fail' | 'notables'; aws?: 'ok' | 'fail' } = {}) {
  const sh = (name: string, body: string) => { const p = join(bin, name); writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`); chmodSync(p, 0o755); };
  sh('pg_dump', o.dump === 'fail' ? 'echo "connection to postgres://u:examplepw@db.internal:5432/x failed" >&2; exit 1'
    : `for a in "$@"; do case "$a" in --file=*) f="\${a#--file=}";; esac; done; ${o.dump === 'empty' ? ': > "$f"' : 'printf "PGDMP%01024d" 0 > "$f"'}`);
  sh('pg_restore', o.restore === 'fail' ? 'exit 1' : o.restore === 'notables' ? 'echo "; Archive created"' : 'echo "1; 0 0 TABLE DATA public tenants x"; echo "2; 0 0 TABLE DATA public users x"');
  sh('aws', `echo "$@" > "${bin}/aws.args"; ${o.aws === 'fail' ? 'exit 1' : 'exit 0'}`);
}
const run = (env: Record<string, string>) => new Promise<{ status: number | null; out: string }>((resolve) => {
  const p = spawn('bash', [SCRIPT], { env: { PATH: `${bin}:${process.env.PATH}`, NODE_BIN: process.execPath, BACKUP_REPORTER: REPORTER, HOME: process.env.HOME ?? '/tmp', ...env } });
  let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  p.on('close', (status) => resolve({ status, out }));
});
const env = (url: string, over: Record<string, string> = {}) => ({ BACKUP_DATABASE_URL: 'postgres://u:examplepw@db.internal:5432/x', BACKUP_S3_URI: 's3://bk/aps/', BACKUP_REPORT_URL: url, BACKUP_REPORT_TOKEN: 'tok-' + 'z'.repeat(30), ...over });

describe('deploy/backup/backup-and-report.sh', () => {
  it('not configured → exit 2, nothing dumped, nothing reported', async () => {
    const seen: any[] = []; await listen(seen); stubs();
    const r = await run({ BACKUP_REPORT_URL: 'http://127.0.0.1:1/x' });
    expect(r.status).toBe(2); expect(r.out).toMatch(/not configured/); expect(seen).toEqual([]);
  });
  it('success → dump verified, uploaded under the prefix, reported success with its size; exit 0', async () => {
    const seen: any[] = []; const url = await listen(seen); stubs();
    const r = await run(env(url, { BACKUP_PITR_ENABLED: 'true' }));
    expect(r.status).toBe(0);
    expect(readFileSync(join(bin, 'aws.args'), 'utf8')).toMatch(/^s3 cp \S+aipowersalon-\d{8}T\d{6}Z\.dump s3:\/\/bk\/aps\/aipowersalon-\d{8}T\d{6}Z\.dump --only-show-errors/);
    expect(seen).toHaveLength(1);
    expect(seen[0].body).toMatchObject({ kind: 'backup', status: 'success', sizeBytes: 1029, pitrEnabled: true });
    expect(seen[0].body.detail).toMatch(/2 tables/);
  });
  it.each([
    ['dump', { dump: 'fail' as const }, /failed at: dump/],
    ['empty dump', { dump: 'empty' as const }, /failed at: dump \(empty file\)/],
    ['unreadable archive', { restore: 'fail' as const }, /failed at: verify/],
    ['archive without data', { restore: 'notables' as const }, /failed at: verify \(no table data/],
    ['upload', { aws: 'fail' as const }, /failed at: upload/],
  ])('%s fails → reported as a FAILURE naming the step; exit 1', async (_n, o, detail) => {
    const seen: any[] = []; const url = await listen(seen); stubs(o);
    const r = await run(env(url));
    expect(r.status).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0].body.status).toBe('failure'); expect(seen[0].body.detail).toMatch(detail);
  });
  it('never prints the connection string, its password or the token — even when pg_dump echoes it', async () => {
    const seen: any[] = []; const url = await listen(seen); stubs({ dump: 'fail' });
    const r = await run(env(url));
    expect(r.out).not.toMatch(/examplepw|db\.internal|tok-z/);
    expect(r.out).toMatch(/<redacted-url>/);
  });
  it('the local dump is deleted afterwards', async () => {
    const seen: any[] = []; const url = await listen(seen); stubs();
    await run(env(url));
    const local = readFileSync(join(bin, 'aws.args'), 'utf8').split(' ')[2];
    expect(existsSync(local)).toBe(false);
  });
});

describe('the templates carry no secret', () => {
  it('the GitHub workflow takes every credential from secrets, is not active, and runs the script', () => {
    const y = readFileSync(join(ROOT, 'deploy/backup/github-backup-workflow.yml'), 'utf8');
    for (const k of ['BACKUP_DATABASE_URL', 'BACKUP_S3_URI', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'BACKUP_REPORT_URL', 'BACKUP_REPORT_TOKEN']) {
      expect(y).toMatch(new RegExp(`^\\s+${k}: \\$\\{\\{ secrets\\.[A-Z0-9_]+ \\}\\}$`, 'm'));
    }
    expect(y).not.toMatch(/postgres(ql)?:\/\/|AKIA[0-9A-Z]{12}|BEGIN [A-Z ]*PRIVATE KEY/);
    expect(y).toMatch(/run: bash deploy\/backup\/backup-and-report\.sh/);
    expect(existsSync(join(ROOT, '.github/workflows/backup.yml'))).toBe(false);   // a template until Kevin enables it
  });
  it('the Railway note uses references, not values', () => {
    const t = readFileSync(join(ROOT, 'deploy/backup/RAILWAY_CRON.txt'), 'utf8');
    expect(t).not.toMatch(/postgres(ql)?:\/\/\w|AKIA[0-9A-Z]{12}/);
    expect(t).toMatch(/BACKUP_REPORTS_REQUIRED=1/);
  });
});
