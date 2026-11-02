import { defineConfig } from 'vitest/config';
// @aipowersalon/web-push — pure TS tests against fakes (Notification / serviceWorker / firebase messaging are injected).
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@aipowersalon/api-contracts': fileURLToPath(new URL('../api-contracts/src/index.ts', import.meta.url)) } },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
});
