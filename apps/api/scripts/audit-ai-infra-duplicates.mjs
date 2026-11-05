#!/usr/bin/env node
// audit-ai-infra-duplicates.mjs — run this in ANOTHER tree (e.g. Power-Salon-main) BEFORE landing patch 16.
//
// Constitution 10 built one of each AI platform concept. If the target tree already has its own, landing the
// patch produces two — and two model registries, two prompt stores or two cost tables is exactly the
// duplicated architecture the constitution forbids (§3, §303). This reports what already exists there so each
// collision is a decision rather than a discovery six weeks later.
//
//   node <this-arc>/apps/api/scripts/audit-ai-infra-duplicates.mjs --root=/path/to/Power-Salon-main
//
// Definition-only regexes: a mention in a comment or an import does not count as a second implementation.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = process.argv.find((a) => a.startsWith('--root='));
const ROOT = arg ? resolve(arg.slice('--root='.length)) : resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SKIP = new Set(['node_modules', 'dist', '.git', 'coverage', 'build', '.next']);

const files = [];
(function walk(d) {
  let entries; try { entries = readdirSync(d); } catch { return; }
  for (const n of entries) {
    if (SKIP.has(n)) continue;
    const p = resolve(d, n);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|mts|sql)$/.test(n) && !n.includes('.spec.')) files.push(p);
  }
})(ROOT);

/** expected = how many this arc itself contributes, so a count above it means the target tree has its own. */
const CONCEPTS = [
  ['AI platform entry point', /export class AiPlatform\b/, 1, 'Two entry points is the exact defect this arc was built to fix. Keep ONE; migrate their callers.'],
  ['AI task registry', /export const AI_TASKS\b/, 1, 'Merge task rows into one registry. Two vocabularies means a task key that resolves in one and 400s in the other.'],
  ['Model registry', /export const AI_MODELS\b/, 1, 'Keep one. A second model table is a second answer to "is this model routable".'],
  ['Model router', /export function route\(task/, 1, 'One router. Two means two routing policy versions and no way to say which chose a model.'],
  ['Prompt registry', /export const PROMPT_SEED\b/, 1, 'Merge prompt versions. If theirs are already in a table, keep the TABLE and seed from it.'],
  ['Prompt store (Kysely)', /class KyselyPromptStore\b/, 1, 'Reuse whichever reads their prompt table.'],
  ['Output schemas', /export const OUTPUT_SCHEMAS\b/, 1, 'One schema registry; a task must have exactly one output contract.'],
  ['Safety policy engine', /export function evaluateSafety\b/, 1, 'One. Two safety engines is two answers to "may this act automatically".'],
  ['Automation levels', /export const AUTOMATION_LEVELS\b/, 1, 'The ORDER is the comparison — two orderings silently invert `stricter()`.'],
  ['Tool registry', /export const AI_TOOLS\b/, 1, 'One. A tool granted in one registry and absent from the other is an authorization hole.'],
  ['Budget engine', /export function evaluateBudget\b/, 1, 'One. Two budget engines means a tenant is over limit in one and under in the other.'],
  ['Fair-share scheduler', /export function selectBatch\b/, 1, 'One.'],
  ['Evaluation comparison', /export function compareRuns\b/, 1, 'One verdict function, or two answers to "may this candidate ship".'],
  ['Knowledge retrieval filter', /export function buildRetrievalFilter\b/, 1, 'One. A second retrieval path is a second chance to forget the tenant filter.'],
  ['Provider adapter file', /class OpenAiProvider\b/, 1, 'THE boundary. A second file with provider HTTP breaks §2 and check:ai-platform will say so.'],
  ['providerFor factory', /export function providerFor\b/, 1, 'Reuse theirs if present; it must live in the same file as the adapters.'],
  ['Cost/price table', /export const AI_MODEL_PRICES\b/, 1, 'One price map. Two means two cost figures for the same call.'],
  ['Price versions', /export const PRICE_VERSIONS\b/, 1, 'If they already version pricing, keep THEIRS and drop this arc\'s seed.'],
  ['AI settings store', /class KyselyAiSettingsStore\b/, 1, 'One. Two settings readers means a tenant setting that applies on one path only.'],
  // `buildOverview` is a common name — super-admin-overview and devices-overview both define their own, and
  // neither is an AI control plane. Matched on the AI-specific SIGNATURE instead. A checker that cries wolf on
  // an unrelated namesake trains the reader to ignore it, which is worse than not having it.
  ['Control plane read model', /export function buildOverview\(i: OverviewInput/, 1, 'One.'],
  ['Circuit breakers', /export class ProviderCircuitBreakers\b/, 1, 'One breaker set, or a provider is open in one and closed in the other.'],
  ['AI usage logger (Kysely)', /class KyselyAiUsageLogger\b/, 1, 'Reuse theirs; usage must land in one table.'],
  ['ai_usage_logs table', /CREATE TABLE IF NOT EXISTS ai_usage_logs\b/, 0, 'Pre-existing (migration 091). This arc adds a COLUMN only — never a second table.'],
  ['ai_prompt_versions table', /CREATE TABLE IF NOT EXISTS ai_prompt_versions\b/, 1, 'If they already version prompts, land only the trigger and keep their table.'],
  ['ai_jobs table', /CREATE TABLE IF NOT EXISTS ai_jobs\b/, 1, 'If they have an AI job table, migrate the columns rather than adding a second.'],
  ['ai_price_versions table', /CREATE TABLE IF NOT EXISTS ai_price_versions\b/, 1, ''],
  ['ai_knowledge_documents table', /CREATE TABLE IF NOT EXISTS ai_knowledge_documents\b/, 1, ''],
  ['tenant_settings table', /CREATE TABLE IF NOT EXISTS tenant_settings\b/, 0, 'Pre-existing (016). This arc adds a CATEGORY and a partial index, never a table.'],
];

const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*--.*$/gm, '');
const rows = CONCEPTS.map(([name, re, expected, note]) => {
  const hits = [];
  for (const f of files) {
    let text; try { text = strip(readFileSync(f, 'utf8')); } catch { continue; }
    if (re.test(text)) hits.push(f.slice(ROOT.length + 1));
  }
  return { name, expected, note, hits };
});

console.log(`AI platform infrastructure in ${ROOT}\n(${files.length} source files scanned)\n`);
let collisions = 0;
for (const r of rows) {
  const flag = r.hits.length > r.expected ? '⚠' : r.hits.length === 0 ? '·' : '✓';
  if (flag === '⚠') collisions++;
  console.log(`  ${flag} ${r.name.padEnd(30)} ${r.hits.length} found (this arc contributes ${r.expected})`);
  for (const h of r.hits.slice(0, 4)) console.log(`        ${h}`);
  if (flag === '⚠' && r.note) console.log(`        → ${r.note}`);
}
console.log(`\n${collisions} concept(s) exist in BOTH trees. Each is a decision; "keep both" is never one of them.`);
console.log('A "·" means the target tree has nothing — patch 16 introduces it cleanly.');
if (existsSync(resolve(ROOT, 'apps/api/scripts/audit-ai-platform.mjs'))) {
  console.log('\nThe target tree already has check:ai-platform. Run it there after merging; it is the gate that catches a second provider path.');
}
