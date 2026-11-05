// contracts-from-source.mjs — a Vite plugin that compiles @aipowersalon/api-contracts from its TypeScript SOURCE in the
// browser apps, the way they already take @aipowersalon/ui, api-client, money and the realtime packages.
//
// WHY (Oct 6 2026): the contracts package is built to CommonJS for the API (dist, `exports.X = …` behind TypeScript's
// __exportStar). Vite's production build does not run the CommonJS transform on a linked workspace package (only on
// node_modules), so the moment @aipowersalon/api-client imported RUNTIME values from the contracts (the error registry,
// Constitution 5) every app that uses the client stopped building: `"isClientAction" is not exported by
// packages/api-contracts/dist/index.js`. tsc and vitest never noticed — both resolve the CommonJS fine. Taking the source
// keeps ONE definition (the package's own src) and gives Rollup real ES exports.
//
// Usage (vite.config.ts):  import { contractsFromSource } from '../../tooling/vite/contracts-from-source.mjs';
//                          plugins: [react(), contractsFromSource(), …]
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'api-contracts', 'src');

export function contractsFromSource() {
  return {
    name: 'aipowersalon:contracts-from-source',
    enforce: 'pre',
    config: () => ({
      resolve: {
        alias: [
          // realm subpaths first (anchored — a bare prefix would turn ".../tenant" into "src/index.ts/tenant")
          { find: /^@aipowersalon\/api-contracts\/(tenant|customer|platform)$/, replacement: join(SRC, '$1', 'index.ts') },
          { find: /^@aipowersalon\/api-contracts$/, replacement: join(SRC, 'index.ts') },
        ],
      },
    }),
  };
}
