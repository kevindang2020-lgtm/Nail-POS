import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// AIPowerSalon Technician web app (Vite + React). Dev proxies /tech and /auth to the NestJS backend on :3000.
export default defineConfig({
  plugins: [react()],
  server: { port: 5175, proxy: { '/tech': { target: 'http://localhost:3000', changeOrigin: true }, '/auth': { target: 'http://localhost:3000', changeOrigin: true } } },
  build: { outDir: 'dist', sourcemap: false },
});
