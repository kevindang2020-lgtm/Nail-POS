import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { contractsFromSource } from '../../tooling/vite/contracts-from-source.mjs';
import { appVersion } from '../../tooling/vite/app-version.mjs';
// AIPowerSalon Customer Display (kiosk/iPad). Dev proxies the PUBLIC device API to the NestJS backend on :3000.
export default defineConfig(({ mode }) => {
  // Load env file from the project root
  const envDir = fileURLToPath(new URL('../../', import.meta.url));
  const env = loadEnv(mode, envDir, '');
  const apiTarget = env.VITE_API_BASE || 'http://localhost:3000';

  return {
    root: fileURLToPath(new URL('./', import.meta.url)),
    resolve: { alias: { '@aipowersalon/api-client': fileURLToPath(new URL('../../packages/api-client/src', import.meta.url)), '@aipowersalon/realtime-client': fileURLToPath(new URL('../../packages/realtime-client/src', import.meta.url)), '@aipowersalon/realtime-contracts': fileURLToPath(new URL('../../packages/realtime-contracts/src', import.meta.url)), '@aipowersalon/money': fileURLToPath(new URL('../../packages/money/src', import.meta.url)), '@aipowersalon/date-time': fileURLToPath(new URL('../../packages/date-time/src', import.meta.url)),  '@aipowersalon/ui': fileURLToPath(new URL('../../packages/ui/src', import.meta.url)) } },
  // the contracts from their TypeScript source, as every other web app takes them: the display now uses RUNTIME values
  // from them (pairing-code format, heartbeat timing, display profile — 23-inch spec §8–§12, §85–§87)
  plugins: [contractsFromSource(), appVersion(), react()],
  // 23-inch spec §86: the version the display reports with its heartbeat (package version + build time)
  define: { __DISPLAY_VERSION__: JSON.stringify(`${(JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version}+${new Date().toISOString().slice(0, 10)}`) },
  // the display's three server paths: its own device API, the Go Check-In it shows between checkouts, and the salon's
  // pictures (ads, logo). `vite preview` uses the same proxy (preview.proxy defaults to server.proxy).
  server: { port: 5180, proxy: { '/api/v1': { target: apiTarget, changeOrigin: true }, '/customer-display': { target: apiTarget, changeOrigin: true }, '/go-check-in': { target: apiTarget, changeOrigin: true }, '/media': { target: apiTarget, changeOrigin: true } } },
  build: { outDir: 'dist', sourcemap: false },

  };
});
