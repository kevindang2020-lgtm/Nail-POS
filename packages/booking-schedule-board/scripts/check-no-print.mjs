// Mirrors the host's `check:no-print` gate: schedules/queues/tickets are never printed (AIPowerSalon rule).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['src', 'demo'];
const banned = [/window\.print\s*\(/, /execCommand\(\s*['"]print['"]/, /Print Schedule/i, /Print Queue/i, /Print Service Ticket/i];
const hits = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|css|html)$/.test(f) && !p.includes('/tests/')) {
  readFileSync(p, 'utf8').split('\n').forEach((line, i) => { if (banned.some((r) => r.test(line))) hits.push(`${p}:${i + 1}: ${line.trim()}`); }); } } };
for (const r of roots) { try { walk(r); } catch { /* missing root */ } }
if (hits.length) { console.error('check:no-print FAILED\n' + hits.join('\n')); process.exit(1); }
console.log('check:no-print OK');
