#!/usr/bin/env node
// audit-event-infra-duplicates.mjs — Constitution 8 §211: "do not create duplicates if equivalent
// infrastructure already exists."
//
// WHY THIS EXISTS. The event architecture in this tree was built against a July snapshot. The canonical tree is
// Power-Salon-main, where the infrastructure constitution (#4) was built separately and may ALREADY contain an
// outbox, a job queue, a consumer registry or a dead-letter table. Merging blind would either duplicate that
// infrastructure or silently overwrite it — and nobody would notice until two publishers were racing the same
// rows in production.
//
// So: run this IN THE TARGET TREE before merging. It reports what event infrastructure that tree already has.
//   node scripts/audit-event-infra-duplicates.mjs            # audit the tree you are standing in
//   node scripts/audit-event-infra-duplicates.mjs --json     # machine-readable, for a merge script
//
// It reads only — it changes nothing, and it makes no judgement about which implementation is better. It
// answers one question: does something equivalent already exist here, and where?
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv.find((a) => a.startsWith('--root='))?.slice(7) ?? new URL('..', import.meta.url).pathname;
const JSON_OUT = process.argv.includes('--json');

/** The concepts this arc introduces. If the target tree already has one, the merge must reconcile, not add. */
const CONCEPTS = [
  { key: 'outbox_table',        label: 'Transactional outbox table',      sql: /CREATE TABLE IF NOT EXISTS\s+([a-z_]*outbox[a-z_]*)/gi },
  { key: 'processed_table',     label: 'Processed-event / dedup table',   sql: /CREATE TABLE IF NOT EXISTS\s+([a-z_]*(processed_event|consumed_event|event_dedup)[a-z_]*)/gi },
  { key: 'deadletter_table',    label: 'Dead-letter table',               sql: /CREATE TABLE IF NOT EXISTS\s+([a-z_]*(dead_letter|deadletter|dlq)[a-z_]*)/gi },
  { key: 'event_log_table',     label: 'Generic event log / store',       sql: /CREATE TABLE IF NOT EXISTS\s+(domain_events|event_store|event_log|events)\b/gi },
  { key: 'publisher',           label: 'Outbox publisher / dispatcher',   ts: /\bclass\s+\w*(OutboxPublisher|EventPublisher|EventDispatcher)\w*\b/g },
  { key: 'consumer_registry',   label: 'Consumer registry',               ts: /\bclass\s+\w*(ConsumerRegistry|HandlerRegistry|SubscriberRegistry)\w*\b/g },
  { key: 'event_bus',           label: 'Event bus / emitter abstraction', ts: /\bclass\s+\w*(EventBus|DomainEventBus)\w*\b|@nestjs\/event-emitter/g },
  { key: 'job_queue',           label: 'Job queue (BullMQ / Bee / Agenda)', ts: /from\s+['"](bullmq|bull|bee-queue|agenda)['"]/g },
  { key: 'redis_streams',       label: 'Redis Streams usage',             ts: /\bx(add|readgroup|ack)\b/gi },
];

function walk(dir, out = [], depth = 0) {
  if (depth > 8 || !existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (['node_modules', '.git', 'dist', 'build', 'coverage'].includes(e)) continue;
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out, depth + 1);
    else if (/\.(ts|mjs|js|sql)$/.test(e) && !/\.(spec|test)\.ts$/.test(e)) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const findings = {};
for (const c of CONCEPTS) findings[c.key] = { label: c.label, hits: [] };

for (const file of files) {
  let text; try { text = readFileSync(file, 'utf8'); } catch { continue; }
  const isSql = file.endsWith('.sql');
  for (const c of CONCEPTS) {
    const re = isSql ? c.sql : c.ts;
    if (!re) continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split('\n').length;
      findings[c.key].hits.push({ file: file.replace(ROOT, ''), line, match: (m[1] ?? m[0]).trim().slice(0, 60) });
      if (findings[c.key].hits.length > 25) break;
    }
  }
}

if (JSON_OUT) { console.log(JSON.stringify({ root: ROOT, findings }, null, 2)); process.exit(0); }

console.log(`§211 event-infrastructure duplicate audit — ${ROOT}\n`);
let present = 0;
for (const c of CONCEPTS) {
  const f = findings[c.key];
  const uniq = [...new Map(f.hits.map((h) => [`${h.file}:${h.match}`, h])).values()];
  if (uniq.length) {
    present++;
    console.log(`  PRESENT  ${f.label}`);
    for (const h of uniq.slice(0, 6)) console.log(`             ${h.file}:${h.line}  ${h.match}`);
    if (uniq.length > 6) console.log(`             … ${uniq.length - 6} more`);
  } else {
    console.log(`  absent   ${f.label}`);
  }
}
console.log(`\n${present} of ${CONCEPTS.length} event-infrastructure concepts already present in this tree.`);
console.log(present === 0
  ? 'Nothing to reconcile: this arc\'s infrastructure can merge as new.'
  : 'RECONCILE each PRESENT concept before merging (§211) — do not add a second implementation alongside it.');
