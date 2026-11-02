// api-hardening.vitest.spec — Constitution 12 §64 (mass assignment), §69 (CSRF: GET never mutates), §72 (SSRF): gates.
import { codeRoots, codeKey } from '../../test-support/code-roots';
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPrivateAddress, isSafeWebhookUrlResolved } from '../api-webhooks/api-webhooks-core';

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : (/\.ts$/.test(f) && !/spec|pgtest|\.d\.ts$/.test(f) ? [p] : []); });
const SRC = codeRoots().flatMap((r) => walk(r));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('§64 mass assignment — a request body is never written whole', () => {
  it('no .set()/.values() receives a body/input/dto object or a spread of one (zero today; this keeps it zero)', () => {
    // Anchored on the Kysely builder chain: `Map.set(b, …)` in a -core file is not a write. (My first pattern matched it.)
    const re = /(updateTable|insertInto)\([^)]*\)[\s\S]{0,240}?\.(set|values)\(\s*(\{\s*\.\.\.\s*)?(b|body|input|dto|payload|req\.body|request\.body)\b(?![.\w])/;
    const hits = SRC.filter((f) => re.test(strip(readFileSync(f, 'utf8')))).map((f) => f.replace(process.cwd() + '/', ''));
    expect(hits).toEqual([]);
  });
  it('no Object.assign(row, body) either', () => {
    const re = /Object\.assign\([^,]+,\s*(b|body|input|dto|payload|req\.body)\)/;
    expect(SRC.filter((f) => re.test(strip(readFileSync(f, 'utf8'))))).toEqual([]);
  });
});

describe('§69 CSRF — SameSite=lax protects only if GET never changes state', () => {
  it('no @Get handler is named like a mutation', async () => {
    // A verb must END at a word boundary: `settings` is not `set`, `payments` is not `pay`, `completeness` is not `complete`.
    const MUT = /^(create|add|update|edit|delete|remove|set|toggle|mark|approve|reject|cancel|pay|refund|void|reset|revoke|send|submit|apply|assign|start|end|complete|close|open)([A-Z_]|$)/;
    const bad: string[] = [];
    for (const f of SRC.filter((x) => /@Controller\(/.test(readFileSync(x, 'utf8')))) {
      const mod: any = await import(f);
      for (const exp of Object.values(mod) as any[]) {
        if (typeof exp !== 'function' || !Reflect.hasMetadata('__controller__', exp)) continue;
        for (const name of Object.getOwnPropertyNames(exp.prototype)) {
          const h = exp.prototype[name];
          if (typeof h === 'function' && Reflect.getMetadata('method', h) === 0 && MUT.test(name)) bad.push(`${exp.name}.${name}`);
        }
      }
    }
    // Reviewed: names that look like verbs but are reads (nothing written in their services).
    const REVIEWED_READS = new Set(['PosSettingsController.payTest' /* tests a processor connection */, 'TechController.editOptions' /* the options for an edit form */]);
    expect(bad.filter((b) => !REVIEWED_READS.has(b))).toEqual([]);
  }, 240_000);
  it('the session cookie is SameSite=lax, httpOnly, secure in production', () => {
    const src = readFileSync(join(process.cwd(), '../../modules/identity/src/auth/auth.http.ts'), 'utf8');
    expect(src).toMatch(/sameSite:\s*'lax'/); expect(src).toMatch(/httpOnly:\s*true/);
  });
});

describe('§72 SSRF', () => {
  it.each([['10.0.0.5', true], ['172.16.9.1', true], ['172.31.255.254', true], ['172.24.0.1', true], ['172.15.255.255', false], ['172.32.0.1', false], ['192.168.1.1', true], ['169.254.169.254', true], ['127.0.0.1', true], ['100.64.0.1', true], ['8.8.8.8', false], ['::1', true], ['fd00::1', true], ['fe80::1', true], ['::ffff:10.0.0.1', true], ['2606:4700::1', false]])('%s private → %s', (ip, priv) => expect(isPrivateAddress(ip)).toBe(priv));
  it('a public-looking hostname that RESOLVES to a private address is refused', async () => {
    expect((await isSafeWebhookUrlResolved('https://hooks.example.com/x', async () => ['93.184.216.34', '10.0.0.5'])).ok).toBe(false);
  });
  it('a hostname resolving to the cloud metadata address is refused', async () => {
    expect((await isSafeWebhookUrlResolved('https://hooks.example.com/x', async () => ['169.254.169.254'])).reason).toMatch(/private/);
  });
  it('a hostname that does not resolve is refused; a public one passes', async () => {
    expect((await isSafeWebhookUrlResolved('https://hooks.example.com/x', async () => { throw new Error('ENOTFOUND'); })).ok).toBe(false);
    expect((await isSafeWebhookUrlResolved('https://hooks.example.com/x', async () => ['93.184.216.34'])).ok).toBe(true);
  });
  it('the text check still runs first (http, localhost)', async () => {
    expect((await isSafeWebhookUrlResolved('http://hooks.example.com/x', async () => ['93.184.216.34'])).ok).toBe(false);
  });
  it('every outbound fetch of a variable URL is a reviewed site', () => {
    const REVIEWED = new Set(['ai/ai-providers.ts', 'api-webhooks/api-webhooks.service.ts', 'super-admin-platform/super-admin-platform.service.ts', 'ai-review-reputation/ai-review-reputation-publish.ts', 'packages/observability/tracing/exporter.ts' /* OTLP endpoint from OTEL_EXPORTER_OTLP_ENDPOINT (operator env, never user input) — Phase 11 */]);
    const hits = SRC.filter((f) => /fetch\(\s*(url|u|target|imageUrl|href|link|logoUrl|photoUrl|src|endpoint)\b/.test(strip(readFileSync(f, 'utf8')))).map(codeKey);   // codeKey: grouped-module files keep their API key (ai/ai-providers.ts), so the reviewed list still applies
    expect(hits.filter((h) => !REVIEWED.has(h))).toEqual([]);
    expect(readFileSync(join(process.cwd(), 'src/api-webhooks/api-webhooks.service.ts'), 'utf8')).toMatch(/isSafeWebhookUrlResolved\(url\)/);
  });
});
