// Types for contracts-from-source.mjs — admin-web's tsconfig includes vite.config.ts, and without this its
// `npm run build` (tsc --noEmit && vite build) stopped at TS7016 before Vite ran (found Oct 6 2026).
import type { Plugin } from 'vite';
export declare function contractsFromSource(): Plugin;
