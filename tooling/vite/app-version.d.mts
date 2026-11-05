import type { Plugin } from 'vite';
export declare function resolveAppVersion(appDir: string, env?: Record<string, string | undefined>): string;
export declare function appVersion(): Plugin;
