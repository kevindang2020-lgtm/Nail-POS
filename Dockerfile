# AIPowerSalon API — production image (npm-workspaces monorepo; builds & runs the @aipowersalon/api workspace).
# Multi-stage: a full build (with devDependencies) compiles TypeScript, then node_modules is pruned to production-only and
# copied into a lean runtime stage that runs as the unprivileged `node` user.
# BUILD_PLAN Phase 11 (Constitution 4 §71/§73, audit E4/E8): migrations run ONCE per release as Railway's pre-deploy
# command (railway.json deploy.preDeployCommand), not on every container start; MIGRATE_ON_START=1 restores the old
# start-time migration for a single-container host with no pre-deploy hook. CI builds, scans and (on a manual dispatch)
# publishes this image: .github/workflows/build-image.yml.

# ---- build ----
FROM node:26-slim AS build
WORKDIR /app
# Copy the whole repo (a .dockerignore keeps node_modules/dist/.git out of the build context).
COPY . .
# Install all workspaces from the lockfile and build the API...
RUN npm ci \
 && npm run build:packages \
 && npm run build:modules \
 && npm run build --workspace @aipowersalon/api
# ...then reinstall PRODUCTION dependencies of the API's dependency closure only (Phase 11, §141/§142). A plain
# `npm prune --omit=dev` kept every workspace's runtime deps — the SPAs' Capacitor/Vite/esbuild shipped in the API image
# and the image scan failed on them.
# npm keeps a dev-only edge of the API (vitest → vite → esbuild/rollup) when another workspace needs that package at
# runtime (the SPAs' Vite), so the build/test toolchain is removed by name; the API never imports it (the image boot
# check in CI proves it). esbuild ships a Go binary the image scan flags.
RUN rm -rf node_modules apps/*/node_modules packages/*/node_modules modules/*/node_modules \
 && npm ci --omit=dev --workspace @aipowersalon/api \
 && rm -rf node_modules/vite node_modules/vite-node node_modules/vitest node_modules/@vitest node_modules/esbuild \
           node_modules/@esbuild node_modules/rollup node_modules/@rollup node_modules/lightningcss* node_modules/playwright*

# ---- run ----
FROM node:26-slim AS run
# Phase 11: take the base image's Debian security fixes now, not at the next upstream node:22-slim rebuild.
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    REPO_DRIVER=postgres
WORKDIR /app/apps/api
# node_modules is hoisted at the repo root (/app/node_modules); Node resolves it from /app/apps/api by walking up.
COPY --from=build /app/node_modules /app/node_modules
# Constitution 13: node_modules/@aipowersalon/* are npm-workspace SYMLINKS to ../../packages/<p> and ../../modules/<m>.
# Without these two lines every one of them dangles and `node dist/main.js` dies on its first @aipowersalon import.
# (That was true from the first backend package, 0edf73d, until this commit -- the build stage passed, the runtime
# stage was never exercised. architecture:test now fails if the runtime stage stops copying a workspace the API uses.)
COPY --from=build /app/packages /app/packages
COPY --from=build /app/modules /app/modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/db/migrations ./db/migrations
# Constitution 1 §57: the retention policy the central executor (retention.execute) and the ownership registry read
COPY --from=build /app/apps/api/db/retention-policy.json ./db/retention-policy.json
COPY --from=build /app/apps/api/scripts/migrate.mjs ./scripts/migrate.mjs
# Phase 10: migrate.mjs imports the shared migration rules; the DB pre-flight runs before it (the pre-deploy step).
COPY --from=build /app/apps/api/db/migration-sql.mjs ./db/migration-sql.mjs
COPY --from=build /app/apps/api/scripts/db-preflight.mjs ./scripts/db-preflight.mjs
# Nov 5 2026: after migrate, list paired card terminals with no location (warn only; see the script header)
COPY --from=build /app/apps/api/scripts/check-unassigned-terminals.mjs ./scripts/check-unassigned-terminals.mjs
COPY --from=build /app/apps/api/package.json ./package.json
# Phase 11 (E8): the app code stays ROOT-owned and read-only to the process (a compromised process cannot rewrite its own
# code); only the directories the app writes at runtime belong to `node`. Local media (MEDIA_STORE unset) and private
# support attachments live there — both are EPHEMERAL in a container (use MEDIA_STORE=s3, or a Railway volume; a volume
# is mounted root-owned, so on Railway also set RAILWAY_RUN_UID=0 or keep MEDIA_STORE=s3 — DEPLOY_RAILWAY.md).
RUN mkdir -p /app/apps/api/media /app/apps/api/private-attachments \
 && chown -R node:node /app/apps/api/media /app/apps/api/private-attachments
USER node
EXPOSE 3000
# Liveness only (§85): /health/live touches no database or provider, so a DB outage does not get the container killed
# (readiness — /health/ready — is what Railway's deploy gate uses). node:22-slim has no curl; Node's fetch does it.
# The worker (PROCESS_ROLE=worker) serves no HTTP: its liveness is its job heartbeats (Super Admin → Jobs / health
# aggregator), so the probe passes there instead of marking every worker container unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "if(process.env.PROCESS_ROLE==='worker')process.exit(0);fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# ONE image, two entry points (Constitution 13 section 238). The web service keeps this CMD; a worker service uses the same
# image with its start command overridden to `node dist/worker.js` and PROCESS_ROLE=worker (railway.worker.json). Once a
# worker runs, set the web service's PROCESS_ROLE=api so no job runs twice.
# Migrations: Railway runs `node scripts/db-preflight.mjs && node scripts/migrate.mjs` as the PRE-DEPLOY command (one
# container, before any new replica starts; a failure stops the release). Hosts without a pre-deploy hook set
# MIGRATE_ON_START=1 (single replica only — migrate.mjs takes an advisory lock, but a pre-deploy step is the design).
# `exec` replaces the shell with node, so SIGTERM reaches the API and the graceful drain runs.
CMD ["sh", "-c", "if [ \"$MIGRATE_ON_START\" = \"1\" ]; then node scripts/db-preflight.mjs && node scripts/migrate.mjs || exit 1; fi; exec node dist/main.js"]
