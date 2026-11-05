import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// AIPowerSalon Technician web app (Vite + React). Dev proxies /tech and /auth to the NestJS backend on :3000.
export default defineConfig({
  // shared UI (error boundary + reporting) and its money helpers, from source like the other apps
  resolve: { alias: { '@aipowersalon/ui': fileURLToPath(new URL('../../packages/ui/src', import.meta.url)), '@aipowersalon/money': fileURLToPath(new URL('../../packages/money/src', import.meta.url)) } },
  plugins: [react()],
  server: { port: 5175, proxy: { '/tech': { target: 'http://localhost:3000', changeOrigin: true }, '/auth': { target: 'http://localhost:3000', changeOrigin: true } } },
  build: { outDir: 'dist', sourcemap: false },
});
