import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Render-test config for the Technician web app. jsdom + React plugin; tests mock the typed API client so screens
// render against canned /tech responses (no live backend). Mirrors apps/owner-web/vitest.config.ts.
export default defineConfig({
  resolve: { alias: { '@aipowersalon/realtime-client': fileURLToPath(new URL('../../packages/realtime-client/src', import.meta.url)), '@aipowersalon/realtime-contracts': fileURLToPath(new URL('../../packages/realtime-contracts/src', import.meta.url)), '@aipowersalon/money': fileURLToPath(new URL('../../packages/money/src', import.meta.url)), '@aipowersalon/ui': fileURLToPath(new URL('../../packages/ui/src', import.meta.url)), '@aipowersalon/api-client': fileURLToPath(new URL('../../packages/api-client/src', import.meta.url)), '@aipowersalon/mobile-sdk': fileURLToPath(new URL('../../packages/mobile-sdk/src', import.meta.url)), '@aipowersalon/date-time': fileURLToPath(new URL('../../packages/date-time/src', import.meta.url)) } },
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'], include: ['src/**/*.test.{ts,tsx}'] },
});
