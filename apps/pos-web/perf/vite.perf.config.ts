// vite.perf.config.ts — builds ONLY the real-browser harnesses (perf/booking-harness.html, perf/realtime-harness.html) in production mode,
// with react-dom swapped for React's profiling build so <Profiler> timings exist. Never part of the app build.
import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import base from '../vite.config';

export default defineConfig((env) => {
  const b = typeof base === 'function' ? (base as any)(env) : base;
  return mergeConfig(b, {
    root: fileURLToPath(new URL('.', import.meta.url)),
    resolve: { alias: [{ find: /^react-dom$/, replacement: 'react-dom/profiling' }] },
    build: { outDir: '/tmp/booking-perf-dist', emptyOutDir: true, sourcemap: false, rollupOptions: { input: { booking: fileURLToPath(new URL('./booking-harness.html', import.meta.url)), realtime: fileURLToPath(new URL('./realtime-harness.html', import.meta.url)) } } },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
});
