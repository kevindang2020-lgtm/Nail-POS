import { defineConfig } from 'vitest/config';
// @aipowersalon/realtime-client — pure TS tests; jsdom only for the React hooks. No render-test setup needed.
export default defineConfig({
  test: { environment: 'jsdom', globals: true, include: ['src/**/*.test.{ts,tsx}'] },
});
