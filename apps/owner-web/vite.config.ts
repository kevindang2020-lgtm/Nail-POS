import { fileURLToPath, URL } from 'node:url';
import { webPushServiceWorker } from '../../tooling/vite/web-push-sw.mjs';
import { appVersion } from '../../tooling/vite/app-version.mjs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// AIPowerSalon Owner web app (Vite + React). Dev proxies /owner and /auth to the NestJS backend on :3000.
export default defineConfig({
  // shared UI (error boundary + reporting) and its money helpers, from source like the other apps
  resolve: {
    alias: {
      '@aipowersalon/ui': fileURLToPath(new URL('../../packages/ui/src', import.meta.url)),
      '@aipowersalon/money': fileURLToPath(new URL('../../packages/money/src', import.meta.url)),
      '@aipowersalon/mobile-sdk': fileURLToPath(new URL('../../packages/mobile-sdk/src', import.meta.url)),
      '@aipowersalon/api-contracts': fileURLToPath(new URL('../../packages/api-contracts/src', import.meta.url)),
      '@aipowersalon/date-time': fileURLToPath(new URL('../../packages/date-time/src', import.meta.url)),
      '@aipowersalon/realtime-contracts': fileURLToPath(new URL('../../packages/realtime-contracts/src', import.meta.url)),
      '@aipowersalon/realtime-client': fileURLToPath(new URL('../../packages/realtime-client/src', import.meta.url)),
    },
  },
  plugins: [webPushServiceWorker(), appVersion(), react()],
  server: { port: 5177, proxy: { '/api/v1': { target: 'http://localhost:3000', changeOrigin: true }, '/owner': { target: 'http://localhost:3000', changeOrigin: true }, '/auth': { target: 'http://localhost:3000', changeOrigin: true }, '/push': { target: 'http://localhost:3000', changeOrigin: true } } },
  build: { outDir: 'dist', sourcemap: false },
});
