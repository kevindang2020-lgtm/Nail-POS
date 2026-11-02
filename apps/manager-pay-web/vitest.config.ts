import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
// Render/unit-test config for the Manager Payment App. jsdom + React plugin; tests mock the typed API client.
export default defineConfig({
  resolve: { alias: {
    '@aipowersalon/ui': fileURLToPath(new URL('../../packages/ui/src', import.meta.url)),
    '@aipowersalon/realtime-client': fileURLToPath(new URL('../../packages/realtime-client/src', import.meta.url)), '@aipowersalon/realtime-contracts': fileURLToPath(new URL('../../packages/realtime-contracts/src', import.meta.url)), '@aipowersalon/money': fileURLToPath(new URL('../../packages/money/src', import.meta.url)), '@aipowersalon/api-client': fileURLToPath(new URL('../../packages/api-client/src', import.meta.url)), '@aipowersalon/mobile-sdk': fileURLToPath(new URL('../../packages/mobile-sdk/src', import.meta.url)), '@aipowersalon/date-time': fileURLToPath(new URL('../../packages/date-time/src', import.meta.url)),
  } },
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'], include: ['src/**/*.test.{ts,tsx}'] },
});
