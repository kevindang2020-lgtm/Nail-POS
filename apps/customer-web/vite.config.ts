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
  resolve: { alias: { '@aipowersalon/ui': fileURLToPath(new URL('../../packages/ui/src', import.meta.url)), '@aipowersalon/money': fileURLToPath(new URL('../../packages/money/src', import.meta.url)) } },
  plugins: [react()],
  server: { port: 5176, proxy: { '/customer': { target: apiTarget, changeOrigin: true }, '/auth': { target: apiTarget, changeOrigin: true } } },
  build: { outDir: 'dist', sourcemap: false },

  };
});
