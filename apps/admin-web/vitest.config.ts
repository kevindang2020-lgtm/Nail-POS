import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
// Render-test config for the Super Admin web app. jsdom environment + the React plugin (TSX transform). Tests mock the
// typed API client modules so components render and respond to interaction against canned responses — no live backend
// or browser needed. Mirrors apps/pos-web/vitest.config.ts. Shared UI kit aliased to source (same as vite.config).
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@aipowersalon/realtime-client': fileURLToPath(new URL('../../packages/realtime-client/src', import.meta.url)), '@aipowersalon/realtime-contracts': fileURLToPath(new URL('../../packages/realtime-contracts/src', import.meta.url)), '@aipowersalon/money': fileURLToPath(new URL('../../packages/money/src', import.meta.url)), '@aipowersalon/api-client': fileURLToPath(new URL('../../packages/api-client/src', import.meta.url)),  '@aipowersalon/ui': fileURLToPath(new URL('../../packages/ui/src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
