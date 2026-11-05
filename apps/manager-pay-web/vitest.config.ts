import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
// Render/unit-test config for the Manager Payment App. jsdom + React plugin; tests mock the typed API client.
export default defineConfig({
  resolve: { alias: { '@aipowersalon/ui': fileURLToPath(new URL('../../packages/ui/src', import.meta.url)) } },
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'], include: ['src/**/*.test.{ts,tsx}'] },
});
