#!/usr/bin/env node
// check-audit-wiring.mjs — the audit trail cannot be wired around the type system.
//
// Phase 1 of BUILD_PLAN_2026-10-06 found seven services whose audit calls were silently dropped: each declared its own
// `{ record(input: any) }` port, was handed the real AuditService through `audit as any`, and called record() with ONE
// object where the service takes (ctx, input). tsc could not see it. This gate fails the build when:
//   1. an AuditService is cast away (`audit as any`, `auditSvc as any`, `(audit as any)`), or
//   2. a service declares an untyped one-object audit port instead of taking `AuditSink` from @aipowersalon/audit, or
//   3. anything calls a `.log(` method on an audit handle (AuditService never had one).
// Reviewed exceptions are listed in ALLOW with the reason; the list may only shrink.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const ROOTS = ['modules', 'apps/api/src', 'packages'];
const SKIP_DIR = new Set(['node_modules', 'dist', '.turbo', 'coverage']);
const SKIP_FILE = /\.(vitest\.spec|spec|test)\.tsx?$|\.d\.ts$/;

const RULES = [
  { name: 'audit handle cast away', re: /\b(audit(?:Svc|Service|Sink)?)\s+as\s+any\b/ },
  { name: 'untyped one-object audit port (take AuditSink from @aipowersalon/audit)', re: /\baudit\??:\s*\{\s*record\s*\((?:input|i|e|a)\s*:\s*(?:any|Record<string,\s*unknown>)\s*\)/ },
  { name: 'audit.log() does not exist on AuditService', re: /\baudit(?:Svc|Service)?\)?\??\.log\?\?\.\(|\(audit as any\)\??\.log/ },
];

// path → reason. Each entry is a reviewed adapter with its OWN sink type (not AuditService) or the gate's own doc.
const ALLOW = new Map([
  ['modules/audit/src/audit-sink.ts', 'the adapter that documents the failure mode'],
  ['modules/payments/src/hardware-payment/hardware-payment.service.ts', 'its AuditSink is the hardware-payment DbAuditSink (own .log contract), not AuditService'],
]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(name) && !SKIP_FILE.test(name)) yield p;
  }
}

const hits = [];
for (const r of ROOTS) {
  for (const file of walk(join(ROOT, r))) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (ALLOW.has(rel)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return;   // comments may describe the bug
      for (const rule of RULES) if (rule.re.test(line)) hits.push(`${rel}:${i + 1}  [${rule.name}]  ${line.trim().slice(0, 140)}`);
    });
  }
}

if (hits.length) {
  console.error(`check:audit-wiring — ${hits.length} place(s) wire the audit trail around the type system:\n  ${hits.join('\n  ')}\n` +
    `Take \`AuditSink\` from @aipowersalon/audit and wire it with auditSinkFor(auditService).`);
  process.exit(1);
}
console.log(`check:audit-wiring OK — no audit handle is cast away, every one-object audit port is the typed AuditSink (${ALLOW.size} reviewed exceptions)`);
