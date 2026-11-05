import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Render-test config for the Technician web app. jsdom + React plugin; tests mock the typed API client so screens
// render against canned /tech responses (no live backend). Mirrors apps/owner-web/vitest.config.ts.
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'], include: ['src/**/*.test.{ts,tsx}'] },
});
