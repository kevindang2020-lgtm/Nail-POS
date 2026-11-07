import { defineConfig, loadEnv } from 'vite';
import { webPushServiceWorker } from '../../tooling/vite/web-push-sw.mjs';
import { appVersion } from '../../tooling/vite/app-version.mjs';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { contractsFromSource } from '../../tooling/vite/contracts-from-source.mjs';
import { appVersion } from '../../tooling/vite/app-version.mjs';
import { webPushServiceWorker } from '../../tooling/vite/web-push-sw.mjs';   // developer merge (Oct 6 2026): /aps-push-sw.js from ONE source
// POS web app (Vite + React). Dev proxies /pos to the NestJS backend on :3000 (backend has no /api prefix).
export default defineConfig(({ mode }) => {
  // Load env file from the project root
  const envDir = fileURLToPath(new URL('../../', import.meta.url));
  const env = loadEnv(mode, envDir, '');
  const apiTarget = env.VITE_API_BASE || 'http://localhost:3000';

  const bypassHtml = (req: any) => { if (req.headers.accept?.includes('text/html')) return req.url; };
  const proxyOpts = { target: apiTarget, changeOrigin: true, bypass: bypassHtml };

  return {
    plugins: [contractsFromSource(), appVersion(), webPushServiceWorker(),
      react(),
      tailwindcss(),
    ],
    resolve: { alias: { '@aipowersalon/ui': fileURLToPath(new URL('../../packages/ui/src', import.meta.url)), '@aipowersalon/realtime-client': fileURLToPath(new URL('../../packages/realtime-client/src', import.meta.url)), '@aipowersalon/realtime-contracts': fileURLToPath(new URL('../../packages/realtime-contracts/src', import.meta.url)), '@aipowersalon/money': fileURLToPath(new URL('../../packages/money/src', import.meta.url)), '@aipowersalon/date-time': fileURLToPath(new URL('../../packages/date-time/src', import.meta.url)), '@aipowersalon/mobile-sdk/i18n': fileURLToPath(new URL('../../packages/mobile-sdk/src/i18n', import.meta.url)), '@aipowersalon/api-client': fileURLToPath(new URL('../../packages/api-client/src', import.meta.url)), '@aipowersalon/web-push': fileURLToPath(new URL('../../packages/web-push/src', import.meta.url)) } },
    server: { port: 5173, proxy: { '^/api/v1([/?#]|$)': proxyOpts, '^/pos([/?#]|$)': proxyOpts, '^/tenant([/?#]|$)': proxyOpts, '^/ai([/?#]|$)': proxyOpts, '^/auth([/?#]|$)': proxyOpts, '^/public([/?#]|$)': proxyOpts, '^/owner([/?#]|$)': proxyOpts, '^/tech([/?#]|$)': proxyOpts, '^/customer([/?#]|$)': proxyOpts, '^/super-admin([/?#]|$)': proxyOpts, '^/community([/?#]|$)': proxyOpts, '^/realtime([/?#]|$)': proxyOpts, '^/mobile-checkout([/?#]|$)': proxyOpts, '^/media([/?#]|$)': proxyOpts } },
    build: { outDir: 'dist', sourcemap: false },
  };
});
