// container-image.vitest.spec.ts — BUILD_PLAN Phase 11 (Constitution 4 §71/§73 pre-deploy migration, §141/§142 container
// security; audit findings E4 "migrations run on every container start" and E8 "container runs as root").
// A static lint of the Dockerfile, .dockerignore and the Railway configs — the image itself is built by CI
// (.github/workflows/build-image.yml) and scanned there.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
const runtime = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));
const instr = (src: string) => src.replace(/\\\n/g, ' ').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const dockerignore = readFileSync(join(ROOT, '.dockerignore'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const railway = JSON.parse(readFileSync(join(ROOT, 'railway.json'), 'utf8'));
const worker = JSON.parse(readFileSync(join(ROOT, 'railway.worker.json'), 'utf8'));
const MIGRATE = /node scripts\/db-preflight\.mjs && node scripts\/migrate\.mjs/;

describe('runtime stage — E8: not root, production, health-checked', () => {
  it('the runtime stage switches to USER node, and nothing after that switches back', () => {
    const users = instr(runtime).filter((l) => /^USER\s/i.test(l));
    expect(users.length).toBeGreaterThan(0);
    expect(users[users.length - 1]).toMatch(/^USER\s+node$/);
  });
  it('USER node comes after every COPY/RUN that needs root, and before CMD', () => {
    const lines = instr(runtime);
    const u = lines.findIndex((l) => /^USER\s+node$/.test(l));
    const lastRoot = Math.max(...lines.map((l, i) => (/^(COPY|RUN)\s/.test(l) ? i : -1)));
    expect(u).toBeGreaterThan(lastRoot);
    expect(lines.findIndex((l) => /^CMD\s/.test(l))).toBeGreaterThan(u);
  });
  it('the directories the app writes at runtime (local media, private attachments) exist and are owned by node', () => {
    const run = instr(runtime).filter((l) => /^RUN\s/.test(l)).join(' ');
    for (const d of ['/app/apps/api/media', '/app/apps/api/private-attachments']) {
      expect(run, `mkdir ${d}`).toContain(d);
    }
    expect(run).toMatch(/chown\s+(-R\s+)?node:node\s+[^&]*\/app\/apps\/api\/media/);
  });
  it('NODE_ENV=production and dev dependencies are pruned before node_modules reaches the runtime stage', () => {
    expect(runtime).toMatch(/NODE_ENV=production/);
    const build = dockerfile.slice(0, dockerfile.lastIndexOf('\nFROM '));
    // only the API's dependency closure, production deps only (the SPAs' Capacitor/Vite must not ship in the API image)
    expect(build).toMatch(/rm -rf node_modules [^\n]*\n?[^\n]*npm ci --omit=dev --workspace @aipowersalon\/api/);
    for (const tool of ['vite', 'vitest', 'esbuild', 'rollup']) expect(instr(build).join('\n'), tool).toMatch(new RegExp(`rm -rf[^\\n]*node_modules/${tool}\\b`));
  });
  it('HEALTHCHECK probes /health/live (process liveness — never the database or a provider)', () => {
    const hc = instr(runtime).find((l) => /^HEALTHCHECK\s/.test(l));
    expect(hc, 'HEALTHCHECK missing').toBeTruthy();
    expect(hc).toMatch(/\/health\/live/);
    expect(readFileSync(join(ROOT, 'apps/api/src/health/health.controller.ts'), 'utf8')).toMatch(/@Get\(\s*['"]live['"]\s*\)/);
  });
  it('the image never copies an env file or a key', () => {
    expect(dockerfile).not.toMatch(/COPY[^\n]*\.env\b/);
    expect(dockerfile).not.toMatch(/COPY[^\n]*\.(pem|key)\b/);
  });
});

describe('.dockerignore — secrets and scratch never enter the build context', () => {
  for (const p of ['.env*', '**/.env*', '**/*.pem', '**/*.key', '**/node_modules', '.git']) {
    it(`ignores ${p}`, () => { expect(dockerignore).toContain(p); });
  }
  it('ignores test fixtures, coverage and scratch', () => {
    for (const p of ['**/coverage', '**/__fixtures__', '**/fixtures', '**/scratch', '**/tmp']) expect(dockerignore).toContain(p);
    // test files carry FAKE provider keys (masking tests) — the image secret scan flagged them; they never ship
    for (const p of ['**/*.spec.ts', '**/*.test.ts']) expect(dockerignore).toContain(p);
  });
  it('does NOT ignore what the build needs (migrations, the retention policy, the lockfile)', () => {
    for (const p of dockerignore) {
      expect(['apps/api/db', 'package-lock.json', '*.sql', '*.json'].includes(p), p).toBe(false);
    }
  });
});

describe('E4 — migrations run ONCE per release (pre-deploy), not on every container start', () => {
  it('railway.json pre-deploy runs the pre-flight then the migrations', () => {
    const pre = railway.deploy.preDeployCommand;
    expect(Array.isArray(pre)).toBe(true);
    expect(pre.join(' ')).toMatch(MIGRATE);
  });
  it('the web start command only starts the API', () => {
    expect(railway.deploy.startCommand).toBe('node dist/main.js');
  });
  it('the worker never migrates and has no pre-deploy step of its own', () => {
    expect(worker.deploy.startCommand).toBe('node dist/worker.js');
    expect(worker.deploy.preDeployCommand).toBeUndefined();
  });
  it('the image CMD migrates only behind MIGRATE_ON_START=1 (single-container hosts), then execs the API', () => {
    const cmd = instr(runtime).find((l) => /^CMD\s/.test(l))!;
    expect(cmd).toMatch(/MIGRATE_ON_START/);
    expect(cmd).toMatch(/\\"\$MIGRATE_ON_START\\" = \\"1\\"/);   // JSON-form CMD: the quotes are escaped
    expect(cmd).toMatch(MIGRATE);
    expect(cmd).toMatch(/exec node dist\/main\.js/);   // exec: SIGTERM reaches node (graceful drain), not sh
  });
});

describe('deploy/ — legacy Terraform marked and safe if applied (E6); the bucket lifecycle Kevin applies (§169)', () => {
  const tf = readFileSync(join(ROOT, 'deploy/terraform/main.tf'), 'utf8');
  const block = (type: string, name: string) => { const i = tf.indexOf(`resource "${type}" "${name}" {`); expect(i, `${type}.${name}`).toBeGreaterThan(-1); return tf.slice(i, tf.indexOf('\n}\n', i)); };
  it('README says LEGACY / not applied / Railway is the host of record', () => {
    const readme = readFileSync(join(ROOT, 'deploy/terraform/README.md'), 'utf8');
    expect(readme).toMatch(/LEGACY, NOT APPLIED/);
    expect(readme).toMatch(/Railway is the host of record/);
  });
  it('RDS: final snapshot, deletion protection, Multi-AZ', () => {
    const db = block('aws_db_instance', 'postgres');
    expect(db).toMatch(/skip_final_snapshot\s*=\s*false/);
    expect(db).toMatch(/deletion_protection\s*=\s*true/);
    expect(db).toMatch(/multi_az\s*=\s*true/);
  });
  it('no SSH: port 22 is not opened anywhere and no key pair is required', () => {
    expect(tf).not.toMatch(/from_port\s*=\s*22\b/);
    expect(tf).not.toMatch(/key_name\s*=/);
    expect(block('aws_instance', 'api')).toMatch(/http_tokens\s*=\s*"required"/);
  });
  it('static buckets carry an OAC bucket policy; the media bucket is private, versioned and encrypted', () => {
    expect(block('aws_s3_bucket_policy', 'static_oac')).toMatch(/cloudfront\.amazonaws\.com[\s\S]*AWS:SourceArn/);
    expect(block('aws_s3_bucket_public_access_block', 'media')).toMatch(/restrict_public_buckets\s*=\s*true/);
    expect(block('aws_s3_bucket_versioning', 'media')).toMatch(/status\s*=\s*"Enabled"/);
    expect(block('aws_s3_bucket_server_side_encryption_configuration', 'media')).toMatch(/sse_algorithm/);
  });
  it('storage-lifecycle.json aborts incomplete multipart uploads after 1 day — the same rule Terraform declares', () => {
    const lc = JSON.parse(readFileSync(join(ROOT, 'deploy/storage-lifecycle.json'), 'utf8'));
    const abort = lc.Rules.find((r: any) => r.AbortIncompleteMultipartUpload);
    expect(abort).toMatchObject({ Status: 'Enabled', AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } });
    expect(block('aws_s3_bucket_lifecycle_configuration', 'media')).toMatch(/days_after_initiation\s*=\s*1/);
  });
});

describe('CI — build-image.yml builds, scans, and keeps publishing OFF by default', () => {
  const wf = readFileSync(join(ROOT, '.github/workflows/build-image.yml'), 'utf8');
  it('builds the image and scans it with Trivy (CRITICAL + fix available fails), scans IaC, uploads an SBOM', () => {
    expect(wf).toMatch(/docker\/build-push-action/);
    expect(wf).toMatch(/scan-type: image[\s\S]*severity: CRITICAL[\s\S]*ignore-unfixed: true[\s\S]*exit-code: '1'/);
    expect(wf).toMatch(/scan-type: config/);
    expect(wf).toMatch(/format: cyclonedx/);
    expect(wf).toMatch(/upload-artifact/);
  });
  it('never uses a compromised trivy-action tag (CVE-2026-33634: 0.0.1–0.34.2)', () => {
    for (const m of wf.matchAll(/aquasecurity\/trivy-action@(\S+)/g)) {
      const [maj, min] = m[1].replace(/^v/, '').split('.').map(Number);
      expect(maj > 0 || min >= 35 || /^[0-9a-f]{40}$/.test(m[1]), m[1]).toBe(true);
    }
  });
  it('the publish job runs only on a manual dispatch with publish=true, behind a protected environment, tag = sha', () => {
    const pub = wf.slice(wf.indexOf('\n  publish:'));
    expect(pub).toMatch(/if: github\.event_name == 'workflow_dispatch' && inputs\.publish == true/);
    expect(pub).toMatch(/environment: production-image/);
    expect(pub).toMatch(/:\$\{GITHUB_SHA\}/);
    expect(wf).not.toMatch(/:latest\b/);
  });
  it('secrets are referenced by name only; the default token is read-only', () => {
    expect(wf).toMatch(/^permissions:\n {2}contents: read$/m);
    for (const m of wf.matchAll(/secrets\.([A-Za-z0-9_]+)/g)) expect(m[1]).toMatch(/^[A-Z0-9_]+$/);
    expect(wf).not.toMatch(/(ghp_|github_pat_|AKIA)[A-Za-z0-9]/);
  });
});
