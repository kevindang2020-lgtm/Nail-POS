import { defineConfig } from 'vitest/config';
import { workspaceAliases } from '../../tooling/vitest/workspace-aliases.mjs';
export default defineConfig({
  resolve: { alias: workspaceAliases(import.meta.url) },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.vitest.spec.ts'], passWithNoTests: true, hookTimeout: 120000 },
});
