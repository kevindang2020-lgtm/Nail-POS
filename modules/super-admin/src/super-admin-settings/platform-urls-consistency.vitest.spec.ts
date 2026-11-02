// platform-urls-consistency.vitest.spec.ts — a guard against a class of bug that already bit us once.
//
// The platform-URL settings (`urls.tenant_portal`, `urls.admin_portal`) are what Super Admin uses to send staff
// to the apps — in emails, notifications, and links. If one of those hosts is not in the API's CORS allowlist,
// the link is worse than broken: the page may load and then every API call fails CORS, which looks like a
// mysterious app outage rather than a config error.
//
// This is not hypothetical. `urls.tenant_portal` defaulted to `app.aipowersalon.com`, a host that appears in NO
// DNS, CloudFront, Terraform, or CORS config — while all deployed infrastructure serves the POS at
// `pos.aipowersalon.com`. This test fails on exactly that drift, so whichever host the platform standardizes on,
// the two sources cannot silently disagree again.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { SETTING_DEFS } from './platform-settings-defaults';

const REPO_ROOT = join(__dirname, '../../../..');
const CORS_EXAMPLE = join(REPO_ROOT, '.env.production.example');

function corsOrigins(): string[] {
  if (!existsSync(CORS_EXAMPLE)) return [];
  const line = readFileSync(CORS_EXAMPLE, 'utf8').split('\n').find((l) => l.startsWith('WEB_CORS_ORIGINS='));
  if (!line) return [];
  return line.slice('WEB_CORS_ORIGINS='.length).split(',').map((s) => s.trim()).filter(Boolean);
}

const settingDefault = (key: string): string => {
  const s = (SETTING_DEFS as any[]).find((x) => x.key === key);
  return String(s?.default ?? '');
};

const originOf = (url: string): string => {
  try { const u = new URL(url); return `${u.protocol}//${u.host}`; } catch { return ''; }
};

describe('platform URL settings must be servable', () => {
  const origins = corsOrigins();

  it('the CORS allowlist example is readable (guard is meaningful)', () => {
    expect(origins.length).toBeGreaterThan(0);
  });

  // Each app the platform links staff to must be an origin the API will actually accept requests from.
  for (const key of ['urls.tenant_portal', 'urls.admin_portal']) {
    it(`${key} default is present in WEB_CORS_ORIGINS`, () => {
      const url = settingDefault(key);
      expect(url, `${key} has no default`).toBeTruthy();
      const origin = originOf(url);
      expect(origin, `${key} default is not a valid absolute URL: ${url}`).toBeTruthy();
      expect(
        origins.includes(origin),
        `${key} points at ${origin}, which is NOT in the API's CORS allowlist (${origins.join(', ')}).\n` +
        'A staff member following this link would be blocked by CORS on the first API call.\n' +
        'Fix by either (a) pointing the setting at a served host, or (b) adding this origin to WEB_CORS_ORIGINS ' +
        'in .env.production.example AND provisioning DNS/CloudFront for it.',
      ).toBe(true);
    });
  }

  it('platform URL defaults are https in production config', () => {
    for (const key of ['urls.tenant_portal', 'urls.admin_portal', 'urls.main_website']) {
      const url = settingDefault(key);
      if (url) expect(url.startsWith('https://'), `${key} must be https`).toBe(true);
    }
  });

  // Generalized guard: NO source file may hard-code an aipowersalon.com host that the API's CORS allowlist does
  // not accept. This is the check that would have caught all of it at once — the tenant-portal setting, the
  // invite-link fallback, the branded-email logo base, and the OAuth redirect allowlist were each hard-coding
  // `app.aipowersalon.com`, a host provisioned in no DNS/CloudFront/CORS config.
  it('no source file hard-codes an aipowersalon host that CORS does not allow', () => {
    const allowed = new Set([
      ...origins.map((o) => { try { return new URL(o).host; } catch { return o; } }),
      'api.aipowersalon.com',       // the API itself
      'help.aipowersalon.com',      // public marketing/help surfaces
      'checkin.aipowersalon.com',
      'www.aipowersalon.com',
    ]);
    // Scan EVERY app (api + all frontends), .ts and .tsx — a hard-coded dead host in a React screen breaks
    // links just as thoroughly as one in the API.
    const appsRoot = join(__dirname, '../../../');           // apps/
    const src = join(__dirname, '..');
    const files = execSync(
      `grep -rl "aipowersalon\\.com" ${appsRoot} --include=*.ts --include=*.tsx 2>/dev/null | grep -v node_modules || true`,
      { encoding: 'utf8' },
    ).split('\n').filter(Boolean).filter((f) => !/\.(spec|test)\.tsx?$/.test(f));

    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;                 // ignore comments
        const hosts = line.match(/[a-z0-9-]+\.aipowersalon\.com/g) || [];
        for (const h of hosts) {
          if (!allowed.has(h)) offenders.push(`${f.replace(appsRoot, 'apps/')}:${i + 1} → ${h}`);
        }
      });
    }
    expect(
      offenders,
      `These hard-code an aipowersalon host that is NOT in WEB_CORS_ORIGINS (${[...allowed].join(', ')}).\n` +
      'Links built from them point at a domain that may not resolve, or will be blocked by CORS:\n' +
      offenders.join('\n'),
    ).toEqual([]);
  });
});
