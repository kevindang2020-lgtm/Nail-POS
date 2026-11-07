import { fileURLToPath } from 'node:url';
import { webPushServiceWorker } from '../../tooling/vite/web-push-sw.mjs';   // Nov 5 2026: the CSP-safe push worker (aps-push-sw.js)
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { contractsFromSource } from '../../tooling/vite/contracts-from-source.mjs';
import { appVersion } from '../../tooling/vite/app-version.mjs';

// AIPowerSalon Technician web app (Vite + React). Dev proxies /api (and /tech, /auth) to the NestJS backend on :3000.
export default defineConfig({
  resolve: { alias: { '@aipowersalon/realtime-client': fileURLToPath(new URL('../../packages/realtime-client/src', import.meta.url)), '@aipowersalon/realtime-contracts': fileURLToPath(new URL('../../packages/realtime-contracts/src', import.meta.url)), '@aipowersalon/money': fileURLToPath(new URL('../../packages/money/src', import.meta.url)), '@aipowersalon/ui': fileURLToPath(new URL('../../packages/ui/src', import.meta.url)), '@aipowersalon/api-client': fileURLToPath(new URL('../../packages/api-client/src', import.meta.url)), '@aipowersalon/mobile-sdk': fileURLToPath(new URL('../../packages/mobile-sdk/src', import.meta.url)), '@aipowersalon/date-time': fileURLToPath(new URL('../../packages/date-time/src', import.meta.url)) } },
  plugins: [contractsFromSource(), webPushServiceWorker(), appVersion(), react()],
  server: { port: 5175, proxy: { '/api/v1': { target: 'http://localhost:3000', changeOrigin: true }, '/tech': { target: 'http://localhost:3000', changeOrigin: true }, '/auth': { target: 'http://localhost:3000', changeOrigin: true } } },
  build: { outDir: 'dist', sourcemap: false },
});
