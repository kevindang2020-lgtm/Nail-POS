// web-push-sw.mjs — a Vite plugin that serves the ONE browser push service worker (packages/web-push/src/sw.js) at
// /aps-push-sw.js in dev and emits it into dist/ at build, for every desktop app that opts in. Developer merge (Oct 6
// 2026): he copied a firebase-messaging-sw.js into three apps' public/ folders (the architecture gate ratchets
// byte-identical files across apps, and three copies of one worker drift). One source, served three times.
//
// Usage (vite.config.ts):  import { webPushServiceWorker } from '../../tooling/vite/web-push-sw.mjs';
//                          plugins: [react(), webPushServiceWorker(), …]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SW_SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'web-push', 'src', 'sw.js');
export const WEB_PUSH_SW_FILE = 'aps-push-sw.js';

export function webPushServiceWorker() {
  return {
    name: 'aipowersalon:web-push-sw',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url || '').split('?')[0] !== `/${WEB_PUSH_SW_FILE}`) return next();
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(readFileSync(SW_SRC, 'utf8'));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: WEB_PUSH_SW_FILE, source: readFileSync(SW_SRC, 'utf8') });
    },
  };
}
