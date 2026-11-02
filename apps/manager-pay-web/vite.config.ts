import { defineConfig, loadEnv } from 'vite';import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { contractsFromSource } from '../../tooling/vite/contracts-from-source.mjs';
import { appVersion } from '../../tooling/vite/app-version.mjs';
// AIPowerSalon Owner & Manager Payment App (Vite + React). Tap-to-Pay backup checkout.
// Dev proxies /mobile-checkout and /auth to the NestJS backend on :3000.
export default defineConfig(({ mode }) => {
  // Load env file from the project root
  const envDir = fileURLToPath(new URL('../../', import.meta.url));
  const env = loadEnv(mode, envDir, '');
  const apiTarget = env.VITE_API_BASE || 'http://localhost:3000';

  // A browser navigation (Accept: text/html) to /auth/… or /mobile-checkout/… is the SPA, not the API — don't proxy it.
  const bypassHtml = (req: { headers: { accept?: string }; url?: string }) => (req.headers.accept?.includes('text/html') ? req.url : undefined);
  const proxyOpts = { target: apiTarget, changeOrigin: true, bypass: bypassHtml };

  return {
  root: fileURLToPath(new URL('./', import.meta.url)),
resolve: { alias: {
    '@aipowersalon/ui': fileURLToPath(new URL('../../packages/ui/src', import.meta.url)),
    '@aipowersalon/realtime-client': fileURLToPath(new URL('../../packages/realtime-client/src', import.meta.url)), '@aipowersalon/realtime-contracts': fileURLToPath(new URL('../../packages/realtime-contracts/src', import.meta.url)), '@aipowersalon/money': fileURLToPath(new URL('../../packages/money/src', import.meta.url)), '@aipowersalon/api-client': fileURLToPath(new URL('../../packages/api-client/src', import.meta.url)), '@aipowersalon/mobile-sdk': fileURLToPath(new URL('../../packages/mobile-sdk/src', import.meta.url)), '@aipowersalon/date-time': fileURLToPath(new URL('../../packages/date-time/src', import.meta.url)),
  } },
  plugins: [contractsFromSource(), appVersion(), react()],
  // host: true — reachable from a phone on the LAN (device testing against the dev server)
  server: { host: true, port: 5181, proxy: { '/api/v1': proxyOpts, '/mobile-checkout': proxyOpts, '/auth': proxyOpts } },
  build: { outDir: 'dist', sourcemap: false },

  };
});
