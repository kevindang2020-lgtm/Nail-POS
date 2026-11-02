# Scaling Roadmap — Phase 4 (code side): S3 / object-storage media adapter (2026-07-03)

_Phase 4 is "CDN". The CDN network layer itself is infrastructure, but the code that makes it real — and that fixes a
real production data-loss risk — is an object-storage backend for media. This ticket adds it behind the existing
`MediaStorage` port, off by default._

## Why this matters (not just "for the CDN later")
Media currently uses `LocalDiskMediaStorage` — uploads land on the API container's local disk. On any PaaS
(Railway/Render/Fly) and most container hosts, that filesystem is **ephemeral: it resets on every redeploy**. So tech
avatars, salon logos, and showcase photos would silently **vanish on the next deploy**. Moving media to object storage:
1. makes uploads durable across redeploys, and
2. lets a CDN serve `/media/*` from the edge (the returned URL points at the CDN, and the client loads it directly).

## What was built
A second implementation behind the SAME `MediaStorage` interface (`put` / `remove` / `resolvePath`), plus an env
selector — mirroring the codebase's established opt-in pattern (`makeTenantCache`, `makeTenantRateLimiter`, the ioredis
lazy-require):

- **`S3MediaStorage`** — stores objects in an S3-compatible bucket. `put()` uploads and returns the object's public
  URL (the CDN base if `MEDIA_CDN_BASE_URL` is set, else the bucket URL). `resolvePath()` returns `null` because objects
  are NOT local — serving is via the returned URL, never a local stream (that's the CDN model). Works with AWS S3 and
  S3-compatible providers (Cloudflare R2, DigitalOcean Spaces, MinIO) via `MEDIA_S3_ENDPOINT` / path-style.
- **`makeMediaStorage(env)`** — returns `S3MediaStorage` when `MEDIA_STORE=s3` (+ `MEDIA_S3_BUCKET`), else
  `LocalDiskMediaStorage`. If S3 is requested but misconfigured or the SDK isn't installed, it **falls back to local
  disk with a warning rather than crashing** (fail-safe, like the Redis features).
- The AWS SDK (`@aws-sdk/client-s3`) is **lazy-required** (only loaded when S3 is enabled) and **injectable** for tests,
  so a local-disk deployment never needs the dependency.

Wired the selector into the two providers of PUBLIC media: `tech-profile` (avatars) and `nail-showcase` (photos).
**Deliberately left `support-attachments` on local disk** — it uses a separate PRIVATE root for ticket attachments,
which must not become public/CDN-served. (When you want durable private attachments, the same adapter can back it with
a private bucket + signed URLs — a follow-up, not this ticket.)

## Safety / behavior
- **No behavior change by default:** with `MEDIA_STORE` unset, both providers use local disk exactly as before. Pure
  no-op until you opt in.
- **Path-traversal guard preserved:** S3 keys reject `..`.
- **Fail-safe:** a bad S3 config degrades to local disk instead of taking the app down.

## Verification (fresh runs)
- **Typecheck:** api `tsc` **0 errors**.  **Lint:** changed files **0**.
- **New tests:** `media-storage-s3.vitest.spec.ts` **7/7** — selector defaults to local disk; falls back on missing
  bucket; S3 `put()` builds correct object key (with prefix) + CDN URL and bucket URL; rejects path traversal;
  `resolvePath()` is null; `remove()` issues a delete and never throws. (AWS SDK is injected as a fake — no live S3, no
  installed dependency.)
- **Full api suite:** **2582/2582 across 411 files** (was 2575/410).
- **Build:** api production build **clean**.

## Files changed
- `apps/api/src/tech-profile/media-storage.ts` — added `S3MediaStorage`, `S3MediaConfig`, `makeMediaStorage()`.
- `apps/api/src/tech-profile/tech-profile.module.ts` + `apps/api/src/nail-showcase/nail-showcase.module.ts` — provide
  via `makeMediaStorage()`.
- `apps/api/src/tech-profile/media-storage-s3.vitest.spec.ts` — new.
- `.env.production.template` — documented `MEDIA_STORE` + `MEDIA_S3_*` + `MEDIA_CDN_BASE_URL`.

## How to turn it on (Phase 4)
1. Create a bucket (S3 / R2 / Spaces). Optionally front it with a CDN and set `MEDIA_CDN_BASE_URL`.
2. `npm i @aws-sdk/client-s3 -w @aipowersalon/api` (only needed for S3 mode).
3. Set `MEDIA_STORE=s3`, `MEDIA_S3_BUCKET`, `MEDIA_S3_REGION` (+ `MEDIA_S3_ENDPOINT` for non-AWS), and
   `MEDIA_CDN_BASE_URL`.
New uploads then persist in the bucket and serve from the CDN. (Existing local-disk files, if any, would be migrated
with a one-time copy — not needed pre-launch.)

## Phase 4 status
Code side done: media is now object-storage/CDN-capable behind the existing port, durable across redeploys. The
remaining Phase 4 work is pure infra — provision the bucket + CDN and point DNS — per `SCALING_TURNON_RUNBOOK.md`.
