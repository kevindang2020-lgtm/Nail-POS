import { defineConfig } from 'vitest/config';
// @aipowersalon/realtime-client — pure TS tests; jsdom only for the React hooks. No render-test setup needed.
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@aipowersalon/realtime-contracts': fileURLToPath(new URL('../realtime-contracts/src/index.ts', import.meta.url)) } },
  test: { environment: 'jsdom', globals: true, include: ['src/**/*.test.{ts,tsx}'] },
});
