import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
// Booking Schedule Board package tests (jsdom, Testing Library). Mirrors packages/ui + apps/pos-web vitest config.
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/tests/setup.ts'], include: ['src/**/*.test.{ts,tsx}'], css: false },
});
