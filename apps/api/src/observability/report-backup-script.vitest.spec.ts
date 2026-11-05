// report-backup-script.vitest.spec — the reporter a backup job runs: exit codes that make failure visible, no secret leaks.
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const SCRIPT = join(process.cwd(), 'scripts/report-backup.mjs');
let server: Server | null = null;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));
function listen(status: number, seen: any[] = []): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { seen.push({ headers: req.headers, body: JSON.parse(b || '{}') }); res.statusCode = status; res.end(status === 204 ? '' : 'nope'); }); });
    server.listen(0, () => resolve(`http://127.0.0.1:${(server!.address() as any).port}/internal/backups/report`));
  });
}
// ASYNC spawn: spawnSync blocked this process, so the test's own server could never answer the script — a deadlock
// that read as "status null" (killed by timeout). The first version of this file did exactly that.
const run = (env: Record<string, string>, args: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
  const p = spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ...env } });
  let stdout = '', stderr = '';
  p.stdout.on('data', (d) => (stdout += d)); p.stderr.on('data', (d) => (stderr += d));
  const t = setTimeout(() => p.kill(), 20_000);
  p.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
});

describe('report-backup.mjs', () => {
  it('posts the report with the token header and exits 0 when accepted', async () => {
    const seen: any[] = []; const url = await listen(204, seen);
    const r = await run({ BACKUP_REPORT_URL: url, BACKUP_REPORT_TOKEN: 'tok-SECRET-123' }, ['--status', 'success', '--size', '42', '--pitr', 'true']);
    expect(r.status).toBe(0);
    expect(seen[0].headers['x-backup-report-token']).toBe('tok-SECRET-123');
    expect(seen[0].body).toMatchObject({ kind: 'backup', status: 'success', sizeBytes: 42, pitrEnabled: true });
  });
  it('exits 1 when the report is REFUSED — the calling job fails visibly', async () => {
    const url = await listen(401);
    expect((await run({ BACKUP_REPORT_URL: url, BACKUP_REPORT_TOKEN: 'wrong' }, ['--status', 'success'])).status).toBe(1);
  });
  it('exits 1 with nothing configured, rather than pretending it reported', async () => {
    expect((await run({ BACKUP_REPORT_URL: '', BACKUP_REPORT_TOKEN: '' }, [])).status).toBe(1);
  });
  it('never prints the token, on success or failure', async () => {
    const url = await listen(401);
    const r = await run({ BACKUP_REPORT_URL: url, BACKUP_REPORT_TOKEN: 'tok-SECRET-123' }, ['--status', 'failure']);
    expect(r.stdout + r.stderr).not.toContain('tok-SECRET-123');
  });
  it('restore drills carry their integrity and smoke results', async () => {
    const seen: any[] = []; const url = await listen(204, seen);
    await run({ BACKUP_REPORT_URL: url, BACKUP_REPORT_TOKEN: 't' }, ['--kind', 'restore_drill', '--status', 'success', '--integrity', 'true', '--smoke', 'false']);
    expect(seen[0].body).toMatchObject({ kind: 'restore_drill', integrityOk: true, smokeTestOk: false });
  });
});
