import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Render-test config for the Customer web app. jsdom + React plugin; tests mock the typed API client so screens render
// against canned responses (no live backend). Mirrors apps/admin-web/vitest.config.ts.
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'], include: ['src/**/*.test.{ts,tsx}'] },
});
