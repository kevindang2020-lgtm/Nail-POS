import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// AIPowerSalon Customer web app (Vite + React). Dev proxies /customer and /auth to the NestJS backend on :3000.
export default defineConfig(({ mode }) => {
  // Load env file from the project root
  const envDir = fileURLToPath(new URL('../../', import.meta.url));
  const env = loadEnv(mode, envDir, '');
  const apiTarget = env.VITE_API_BASE || 'http://localhost:3000';

  return {
    root: fileURLToPath(new URL('./', import.meta.url)),
    envDir,
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
  plugins: [react()],
  server: { port: 5176, proxy: { '/api/v1': { target: apiTarget, changeOrigin: true }, '/customer': { target: apiTarget, changeOrigin: true }, '/auth': { target: apiTarget, changeOrigin: true } } },
  build: { outDir: 'dist', sourcemap: false },

  };
});
