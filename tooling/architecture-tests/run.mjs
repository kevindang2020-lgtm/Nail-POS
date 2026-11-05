// run.mjs — Constitution 13 §160–161, §214, §229–230, §304: architecture facts as a CI gate, against a frozen baseline.
//
// `node tooling/architecture-tests/run.mjs`             compare to baseline.json; exit 1 on any regression
// `node tooling/architecture-tests/run.mjs --baseline`  rewrite baseline.json from the current tree (after a deliberate change)
//
// Absolute rules (never in a baseline): frontend/package → apps/api imports; provider SDK imports outside adapters.
// Ratcheted rules (baseline may only shrink): platform→domain back-edges, largest cycle, provider-URL directories,
// byte-identical files across apps, deep imports. Nested lockfiles and the retired legacy paths are absolute (Phase 15). A migration phase that removes some updates the
// baseline; nothing may add one.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { measure, ROOT } from './graph.mjs';

const BASE = join(ROOT, 'tooling/architecture-tests/baseline.json');
const now = measure();
if (process.argv.includes('--baseline')) { writeFileSync(BASE, JSON.stringify(now, null, 2) + '\n'); console.log('baseline written'); process.exit(0); }
const base = JSON.parse(readFileSync(BASE, 'utf8'));
const fail = [];
const newOnes = (name, cur, prev) => { const p = new Set(prev); const added = cur.filter((x) => !p.has(x)); if (added.length) fail.push(`${name}: NEW (${added.length}) — ${added.slice(0, 6).join(' | ')}`); };

if (now.modulesImportingApps.length) fail.push(`a domain module imports an app or reaches into another module (§105): ${now.modulesImportingApps.join(' | ')}`);
if (now.frontendToBackend.length) fail.push(`frontend/package imports apps/api (§109): ${now.frontendToBackend.join(', ')}`);
if (now.sdkImports.length) fail.push(`provider SDK imported outside an adapter (§107): ${now.sdkImports.join(', ')}`);
if (now.frontendProviderCalls?.length) fail.push(`a frontend talks to a payment processor / terminal / Twilio directly (PAYI §15 / §62 / §154 — only server-side adapters may): ${now.frontendProviderCalls.join(', ')}`);
if (now.contractRedeclarations.length) fail.push(`frontend re-declares an API contract type (§15) — import it from @aipowersalon/api-contracts: ${now.contractRedeclarations.join(' | ')}`);
if (now.moduleCycles.length) fail.push(`domain modules depend on each other in a cycle (§105): ${now.moduleCycles.join('; ')}`);
if (now.compiledSiblingsInSrc.length) fail.push(`compiled output sits beside its source in src/ — Vite resolves it BEFORE the .ts, so tests run stale code: ${now.compiledSiblingsInSrc.join(', ')}`);
if (now.runtimeStageMissingWorkspaces.length) fail.push(`the Dockerfile runtime stage does not ship these workspaces the API imports — the container would die on startup: ${now.runtimeStageMissingWorkspaces.join(', ')}`);
if (now.relativeMigrationLocators.length) fail.push(`locates db/migrations by a relative path (use MIGRATIONS_DIR from @aipowersalon/database — from a module it resolves nowhere and the file is SKIPPED): ${now.relativeMigrationLocators.join(', ')}`);
if (now.productionImportsOfTesting.length) fail.push(`production code imports @aipowersalon/testing (§91 — test helpers are never a production dependency): ${now.productionImportsOfTesting.join(', ')}`);
if (now.contractsExternalImports.length) fail.push(`packages/api-contracts must be dependency-free and browser-safe (§13, §111) — it imports from outside itself: ${now.contractsExternalImports.join('; ')}`);
// The apps compile with skipLibCheck, which skips every .d.ts — so a broken contract (e.g. a type that references a
// name that does not exist) silently becomes `any` in every consumer. Check the contracts themselves, strictly.
{
  const { spawnSync } = await import('node:child_process');
  const tsc = spawnSync(process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', join(ROOT, 'packages/api-contracts/tsconfig.json')], { encoding: 'utf8' });
  if (tsc.status !== 0) fail.push(`packages/api-contracts does not type-check strictly (a broken contract becomes 'any' in every app): ${(tsc.stdout + tsc.stderr).trim().split('\n').slice(0, 3).join(' | ')}`);
}
if (now.unregisteredWorkspaces.length) fail.push(`workspace package not in package-lock.json (run npm install; npm ci and runtime require would fail): ${now.unregisteredWorkspaces.join(', ')}`);
if (now.realmViolations.length) fail.push(`customer-facing app imports a forbidden contract realm (§14, §361): ${now.realmViolations.join(' | ')}`);
newOnes('frontend type mirroring an API type (§15 backlog)', now.mirroredApiTypes, base.mirroredApiTypes ?? now.mirroredApiTypes);
// Phase 8: no baseline — every background scheduler must ask runsBackgroundJob(<class>) (process-local ones are named in graph.mjs).
newOnes('interval scheduler that does not ask runsBackgroundJob (Constitution 13 Phase 8)', now.ungatedSchedulers, []);
// Phase 9 (§280): no baseline — a domain module never names a room or touches the gateway/bus.
newOnes('domain module addresses realtime rooms or the gateway directly (Constitution 13 §280)', now.moduleRealtimeLeaks, []);
// Phase 11: no baseline — a gate that walks apps/api/src but not modules/*/src is blind to ~90% of the server code.
newOnes('CI gate walks apps/api/src but not the modules (Constitution 13 Phase 11 — it would pass while seeing almost nothing)', now.blindGateScripts, []);
// declared-but-unproduced domain events: shrink-only (the vocabulary Constitution 8 declared ahead of its producers).
newOnes('domain event declared in the contract that nothing records (a consumer waiting on it waits forever)', now.unproducedDomainEvents, base.unproducedDomainEvents ?? now.unproducedDomainEvents);
// no baseline: a repository that writes must be built from the PRIMARY handle, never DATABASE_READ.
newOnes('repository that WRITES is built from the read-replica handle (its writes fail once DATABASE_REPLICA_URL is set)', now.writersOnReadReplica, []);
// Phase 9 (§343): direct emitter calls from domain services — shrink-only; convert to a domain event + projection.
newOnes('direct realtime emission from a domain module (§343 — emit a domain event, let the projection broadcast)', now.moduleDirectEmissions, base.moduleDirectEmissions ?? now.moduleDirectEmissions);
{ // per-file counts ("file:n") may only go DOWN — a file that drops from 3 to 2 is progress, not a new idiom (Oct 6 2026)
  const counts = (xs) => Object.fromEntries((xs || []).map((x) => { const i = x.lastIndexOf(':'); return [x.slice(0, i), Number(x.slice(i + 1))]; }));
  const was = counts(base.inlineUtcDayIdioms ?? now.inlineUtcDayIdioms); const up = Object.entries(counts(now.inlineUtcDayIdioms)).filter(([f, n]) => n > (was[f] ?? 0)).map(([f, n]) => `${f}:${n} (was ${was[f] ?? 0})`);
  if (up.length) fail.push(`inline UTC-day idiom toISOString().slice(0,10) (§87 — use utcDate() or businessDate(tz)): NEW (${up.length}) — ${up.slice(0, 6).join(' | ')}`);
}
{ // Unit 9: per-file counts may only go down (a file that drops is fine; a new file or a higher count fails)
  const prev = base.serverUtcDayIdioms ?? now.serverUtcDayIdioms; const up = Object.entries(now.serverUtcDayIdioms).filter(([f, n]) => n > (prev[f] ?? 0)).map(([f, n]) => `${f}:${n} (was ${prev[f] ?? 0})`);
  if (up.length) fail.push(`the database's/server's UTC day — date_trunc(…, now()), current_date, now()::date, setHours(0,0,0,0) — NEW (${up.length}); a salon's day is the branch's (dayStartMs/businessDate or at time zone): ${up.slice(0, 6).join(' | ')}`);
}
newOnes('platform→domain back-edge (§101)', now.backEdges, base.backEdges);
newOnes('hand-built system context (§72: use systemContext() from @aipowersalon/tenant-context)', now.handBuiltSystemContexts, base.handBuiltSystemContexts ?? []);
if (now.largestCycle > base.largestCycle) fail.push(`largest cycle grew: ${base.largestCycle} → ${now.largestCycle} directories (§230)`);
newOnes('provider endpoint in a new directory (§106)', now.providerDirs, base.providerDirs);
newOnes('deep import (§98)', now.deepImports, base.deepImports);
// Phase 15 (Oct 10 2026): the two nested lockfiles were deleted — the root lockfile is the only one (§125, D1). Absolute
// now (no baseline): `npm ci` runs at the root everywhere (Dockerfile, CI), so a nested lockfile is never read and only drifts.
if (now.nestedLockfiles.length) fail.push(`nested lockfile (§125 — the root package-lock.json is the only lockfile; delete it and run npm install at the root): ${now.nestedLockfiles.join(', ')}`);
// Phase 15: legacy apps and root archives removed under the zero-importer rule (§215, D8) — none may come back.
if (now.retiredPathsPresent.length) fail.push(`retired legacy path is back (Constitution 13 §388, Phase 15 — see RETIRED_PATHS in graph.mjs for each replacement): ${now.retiredPathsPresent.join(', ')}`);
const key = (x) => `${x.file}@${x.apps.join(',')}`;
newOnes('byte-identical file copied across apps (§207)', now.identicalGroups.map(key), base.identicalGroups.map(key));

console.log(`architecture: api dirs ${now.apiDirs}, edges ${now.apiEdges}, largest cycle ${now.largestCycle} (baseline ${base.largestCycle}), back-edges ${now.backEdges.length} (baseline ${base.backEdges.length}), provider dirs ${now.providerDirs.length}, identical groups ${now.identicalGroups.length} (baseline ${base.identicalGroups.length}), deep imports ${now.deepImports.length}, nested lockfiles ${now.nestedLockfiles.length}, mirrored API types ${now.mirroredApiTypes.length} (baseline ${base.mirroredApiTypes?.length ?? 'n/a'})`);
if (fail.length) { console.error('\nARCHITECTURE REGRESSION:\n  ' + fail.join('\n  ')); process.exit(1); }
console.log('architecture: no regression');
