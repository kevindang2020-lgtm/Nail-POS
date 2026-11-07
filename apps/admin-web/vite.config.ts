import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { contractsFromSource } from "../../tooling/vite/contracts-from-source.mjs";
import { appVersion } from "../../tooling/vite/app-version.mjs";
import { webPushServiceWorker } from "../../tooling/vite/web-push-sw.mjs";

// AIPowerSalon Super-Admin web app (Vite + React). Dev proxies /super-admin and /auth to the NestJS backend on :3000.
// The canonical shared UI kit (@aipowersalon/ui) is aliased to its source so Vite transpiles it as in-repo code.
export default defineConfig(({ mode }) => {
  // Load env file from the project root
  const envDir = fileURLToPath(new URL("../../", import.meta.url));
  const env = loadEnv(mode, envDir, "");
  const apiTarget = env.VITE_API_BASE || "http://localhost:3000";

  return {
    plugins: [contractsFromSource(), appVersion(), webPushServiceWorker(), react(), tailwindcss()],
    resolve: {
      alias: {
        "@aipowersalon/ui": fileURLToPath(
          new URL("../../packages/ui/src", import.meta.url),
        ),
        // Like every other app (pos-web, owner-web, …), the shared packages come from SOURCE: their dist is CommonJS, which
        // Vite's production build does not transform for a linked workspace package (`"X" is not exported by …/dist`).
        "@aipowersalon/money": fileURLToPath(
          new URL("../../packages/money/src", import.meta.url),
        ),
        "@aipowersalon/realtime-client": fileURLToPath(
          new URL("../../packages/realtime-client/src", import.meta.url),
        ),
        "@aipowersalon/realtime-contracts": fileURLToPath(
          new URL("../../packages/realtime-contracts/src", import.meta.url),
        ),
      },
    },
    server: {
      port: 5174,
      proxy: {
        "/api/v1": { target: apiTarget, changeOrigin: true },   // BUILD_PLAN Phase 12: every call is /api/v1/<path>
        "/super-admin": { target: apiTarget, changeOrigin: true },
        "/auth": { target: apiTarget, changeOrigin: true },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: false,
    },
  };
});