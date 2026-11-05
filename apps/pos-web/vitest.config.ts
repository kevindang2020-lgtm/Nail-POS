import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Render-test config for the POS web app. jsdom environment + the React plugin (TSX transform). Tests mock global fetch
// so screens render against canned API responses — no live backend or browser needed.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@aipowersalon/ui': fileURLToPath(new URL('../../packages/ui/src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
