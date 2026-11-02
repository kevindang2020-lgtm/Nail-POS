#!/usr/bin/env node
// audit-ai-platform.mjs — Constitution 10 §2 + §303: the AI Platform boundary, enforced.
//
// Fails (exit 1) on:
//   1. PROVIDER CALL OUTSIDE THE ADAPTER — provider HTTP or an SDK import anywhere but the approved adapter file.
//   2. PROVIDER KEY IN MODULE SOURCE — an api key read outside the adapter (§19, §303).
//   3. RAW GATEWAY OUTSIDE THE PLATFORM — any module outside src/ai/ holding an AiGatewayService. Since the
//      Phase 23 migration every caller goes through AiPlatform.execute(), so this is now FATAL rather than a
//      note: a new module reaching for the gateway directly would silently reacquire the very split
//      (entitlement here, usage there, neither in a third place) that Constitution 10 exists to end.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../src');
const JSON_OUT = process.argv.includes('--json');
/** The ONE place provider HTTP may live (§17 provider adapter). */
const ADAPTER = 'ai/ai-providers.ts';
/** The platform's own files may reference the gateway freely; they ARE the platform. */
const PLATFORM = /^ai\/(ai-gateway|ai-gated-completion|ai-providers|ai-platform|ai-task-registry|ai-model-registry|ai-prompt-registry)\.ts$/;

const walk = (d, o = []) => { for (const n of readdirSync(d)) { const p = resolve(d, n); statSync(p).isDirectory() ? walk(p, o) : o.push(p); } return o; };
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');   // comments are prose, not code

const problems = [], notes = [];
const modules = new Map();
// Constitution 13: the AI platform and its callers now live in modules/*/src (modules/ai holds the platform). This gate
// walked apps/api/src only and reported "1 AI modules ... OK" while seeing almost none of them. Walk every server root;
// `rel` stays <dir>/<file> (grouped modules keep their directory), so ADAPTER / PLATFORM keys are unchanged.
const MODULES = resolve(here, '../../../modules');
const ROOTS = [SRC, ...(existsSync(MODULES) ? readdirSync(MODULES).map((m) => resolve(MODULES, m, 'src')).filter((d) => existsSync(d)) : [])];
for (const [root, file] of ROOTS.flatMap((r) => walk(r).map((f) => [r, f]))) {
  if (!file.endsWith('.ts') || file.includes('.spec.') || file.includes('.test.')) continue;
  const rel = file.slice(root.length + 1);
  const text = strip(readFileSync(file, 'utf8'));
  const isAdapter = rel === ADAPTER;

  if (/api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis|from\s+['"](openai|@anthropic-ai\/[\w-]+|@google\/generative-ai)['"]/.test(text) && !isAdapter)
    problems.push(`PROVIDER CALL OUTSIDE THE ADAPTER: ${rel} — provider HTTP/SDK belongs only in ${ADAPTER} (§2/§303)`);
  // A PRESENCE check (`!!env.OPENAI_API_KEY`, `process.env.X ? 'openai' : …`) is legitimate — a readiness
  // dashboard and a provider-name display do it, and neither ever holds the secret. Flag only a use of the
  // VALUE: assigning it, passing it, or putting it in a header/template.
  for (const km of text.matchAll(/(?:process\.)?env(?:\.|\[['"])((?:OPENAI|ANTHROPIC|GEMINI)_API_KEY)/g)) {
    const before = text.slice(Math.max(0, km.index - 24), km.index);
    const after = text.slice(km.index + km[0].length, km.index + km[0].length + 24);
    // Presence-only = the value is immediately coerced to a boolean or used as a ternary TEST:
    //   !!env.X   Boolean(env.X)   env.X ? 'openai' : …   env.X && …
    // Anything else — assignment, argument, template, header — is use of the secret. An earlier version also
    // treated a trailing ';' as presence (it is an assignment) and a mutation test caught that it never fired.
    const presenceOnly = /(!!|Boolean\()\s*$/.test(before) || /^\s*(\?[^?.]|&&|\|\|)/.test(after);
    if (!isAdapter && !presenceOnly)
      problems.push(`PROVIDER KEY VALUE OUTSIDE THE ADAPTER: ${rel} uses ${km[1]} (§19/§303) — only ${ADAPTER} may hold a provider secret`);
  }

  const m = rel.split('/')[0];
  if (!/^ai($|-)/.test(m)) continue;
  const e = modules.get(m) ?? { raw: false, gated: false, entitlement: false, usage: false, files: [] };
  if (PLATFORM.test(rel)) { modules.set(m, e); continue; }
  // A module may name AiGatewayService only to hand it to GatedAiCompletion (a platform path). What is
  // forbidden is USING one as the completion port: `new AiGatewayService(...)` that is not an argument to
  // GatedAiCompletion, or a field/param typed as one.
  const bareGateway = /(private|readonly|:)\s*\w*\s*:\s*AiGatewayService/.test(text)
    || [...text.matchAll(/new AiGatewayService\([^)]*\)/g)].some((m) => !text.slice(Math.max(0, m.index - 200), m.index).includes('new GatedAiCompletion('));
  if (bareGateway || /\.completeVision\(/.test(text)) { e.raw = true; e.files.push(rel); }
  if (/GatedAiCompletion|gatedCompletion/.test(text)) e.gated = true;
  if (/AiAccessGate|evaluateAiAccess|ensureAllowed|AiAccessDeniedError|entitle/i.test(text)) e.entitlement = true;   // evaluateAiAccess was missing: ai-assistant DOES gate and was reported as not gating
  if (/ai_usage|AiUsage|logUsage/i.test(text)) e.usage = true;
  modules.set(m, e);
}

for (const [m, e] of modules) {
  if (!e.raw) continue;
  // src/ai/ IS the platform: ai-assistant.service is the free-form assistant surface, which by design has no
  // registered task (§9 forbids an arbitrary-prompt TASK) and therefore keeps its own entitlement+usage path.
  if (m === 'ai') { notes.push(`ai: the free-form assistant surface holds the gateway inside the platform directory by design (entitlement=${e.entitlement}, usage=${e.usage}); it has no registered task because §9 forbids an arbitrary-prompt task`); continue; }
  problems.push(`RAW GATEWAY OUTSIDE THE PLATFORM: ${m} holds an AiGatewayService (${e.files[0]}) — every caller goes through AiPlatform.execute() since Phase 23 (§2/§6/§92)`);
}

const summary = { providerAdapter: ADAPTER, aiModules: modules.size, problems, notes };
if (JSON_OUT) { console.log(JSON.stringify(summary, null, 2)); process.exit(problems.length ? 1 : 0); }
console.log(`AI Platform boundary (§2/§303): ${modules.size} AI modules · adapter = ${ADAPTER}`);
for (const p of problems) console.log('  ✗ ' + p);
for (const n of notes) console.log('  · ' + n);
console.log(problems.length ? `FAIL — ${problems.length} problem(s)` : 'OK — provider access is confined to the adapter and every module path is gated');
process.exit(problems.length ? 1 : 0);
