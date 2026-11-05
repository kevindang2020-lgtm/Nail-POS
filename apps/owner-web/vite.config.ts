import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// AIPowerSalon Owner web app (Vite + React). Dev proxies /owner and /auth to the NestJS backend on :3000.
export default defineConfig({
  plugins: [react()],
  server: { port: 5177, proxy: { '/owner': { target: 'http://localhost:3000', changeOrigin: true }, '/auth': { target: 'http://localhost:3000', changeOrigin: true }, '/push': { target: 'http://localhost:3000', changeOrigin: true } } },
  build: { outDir: 'dist', sourcemap: false },
});
