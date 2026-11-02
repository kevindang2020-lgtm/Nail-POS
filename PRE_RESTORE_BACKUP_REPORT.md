# PRE_RESTORE_BACKUP_REPORT

Restoration point created **before** any UI-restoration work, per §4 of the restore task.

## Current project
- **Path:** `/home/claude/proj/master/AIPowerSalon-Full-Handoff/aipowersalon-pos`
- **Version control:** not a Git repository in this workspace. No commit hash to record. Backups are file-based (below).

## Backups created
1. **Tarball (this session):** `/home/claude/proj/backups/aipowersalon-pos-PRE_RESTORE-<timestamp>.tgz`
   — full source minus `node_modules`, `dist`, `.vite`, `build`.
2. **Pristine delivery zip (pre-existing):** `/home/claude/proj/AIPowerSalon-Full-Handoff.zip`
   — the clean baseline used for every patch zero-diff check; serves as a second independent restore point.

No destructive commands were used (no `git reset --hard`, no `rm -rf src`, no folder replacement).

## Build status before restoration
- **Backend tests:** `npm test` → **215 passed** (32 vitest files + 20 plain-node harness suites), `RESULT: PASS`.
- **API build:** `tsc -p tsconfig.build.json` → exit 0.
- **Frontends:** `npm run build` exits 0 for all four — pos-web, admin-web, tech-web, customer-web.

## Known existing characteristics (not failures, but relevant to the restore)
- The production POS frontend is the **React/Vite app `apps/pos-web`** — the standalone `*.html` files are demos/mocks, not the app.
- POS sidebar is currently **grouped** (group headers) and includes an extra `Live Schedule` sub-route; labels differ slightly from the task's flat list (e.g. `Tech Appts` vs `Tech Appointments`). See `CURRENT_POS_STRUCTURE.md`.
- Realtime is wired into Checkout, Queue, Dashboard (SSE push bus).

## BLOCKER — restoration cannot proceed yet
The task's authoritative visual reference, **`AIPowerSalon-POS-APP_4_1.html`**, is **not available in this workspace**:
- Not in `/mnt/user-data/uploads` (the uploaded `files__3_.zip` contains delivery zips, no HTML reference).
- Not anywhere under `/home/claude` or `/mnt`.
- The `file:///C:/Users/Kevin/Downloads/...` links are local Windows paths and cannot be opened from here.

**To unblock:** upload `AIPowerSalon-POS-APP_4_1.html` directly into the chat (or a zip containing it). Every reference-dependent
deliverable (`OLD_V4_1_TO_CURRENT_DIFF.md`, `V4_1_VISUAL_COMPONENT_MAP.md`, `V4_1_ACTION_PRESERVATION_MAP.md`,
`V4_1_VISUAL_REGRESSION_REPORT.md`, and the actual layout restoration) is on hold until the file is provided. The current-side
inventory (`CURRENT_POS_STRUCTURE.md`) is done now so the merge can start immediately on upload.
