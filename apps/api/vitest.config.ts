import { defineConfig } from 'vitest/config';
import { workspaceAliases } from '../../tooling/vitest/workspace-aliases.mjs';
// Only the vitest-based specs. The Nest-free *-core harnesses run via scripts/run-core-specs.sh (node), not vitest.
// hookTimeout: pgtest suites boot ALL 420 migrations into PGlite in beforeAll, which sits right at vitest's 10s
// default ("Hook timed out in 10000ms" — flaked in clean-extract verification and deterministically as the
// migration count grew). 120s gives real-schema boots room on cold caches without masking genuine hangs.
export default defineConfig({
  // Backend packages are consumed COMPILED by the API's tsc (rootDir-safe .d.ts from dist/); tests resolve them to
  // source so `vitest` needs no prior build. The aliases are derived from package.json + each package's exports map
  // (root AND subpath entries, anchored) — see tooling/vitest/workspace-aliases.mjs for the prefix-match trap.
  resolve: { alias: workspaceAliases(import.meta.url) },
  test: {
    include: ['src/**/*.vitest.spec.ts'],
    environment: 'node',
    hookTimeout: 120_000,
  },
});
