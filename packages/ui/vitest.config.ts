import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
// Canonical UI kit render-tests. Mirrors apps/admin-web + apps/pos-web vitest config.
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'], include: ['src/**/*.test.{ts,tsx}'] },
});
