#!/usr/bin/env bash
# backup-and-report.sh — BUILD_PLAN Phase 14 C (Constitution 11 §114–117): take an OFF-SITE logical backup of the production
# database, prove it is readable, upload it, and REPORT the outcome to the API (scripts/report-backup.mjs) so the
# staleness rule (no successful backup within 26 h → high alert → on-call chain) has something to watch.
#
# This complements Railway's own Postgres backups (HOSTING_ACTIONS_FOR_KEVIN A1); it does not replace them.
# Run it from a Railway cron service (deploy/backup/RAILWAY_CRON.txt) or the GitHub workflow template next to this file.
#
# Environment (values are set in the host's secret store — never in this repository):
#   BACKUP_DATABASE_URL     read-only connection string to the production database (a pg_dump-capable role)
#   BACKUP_S3_URI           s3://bucket/prefix — where the dump goes (any S3-compatible store)
#   BACKUP_S3_ENDPOINT      optional — endpoint URL for a non-AWS S3-compatible store (R2, B2, MinIO)
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION   credentials of a write-only bucket key
#   BACKUP_REPORT_URL       https://<api>/api/v1/internal/backups/report
#   BACKUP_REPORT_TOKEN     same value as the API service's BACKUP_REPORT_TOKEN
#   BACKUP_PITR_ENABLED     optional, true|false — whether point-in-time recovery is on for the database
#
# Behaviour:
#   • not configured (no database URL, destination or report URL) → exit 2, NO report (a job that was never set up is not
#     an outage — set BACKUP_REPORTS_REQUIRED=1 on the API once this job runs, so silence alerts from then on);
#   • any failure (dump, verification, upload) → reports status=failure (the API raises it at once) and exits 1;
#   • success → reports status=success with the size, exits with the reporter's exit code (a report that did not land
#     fails the job visibly).
# Never prints a connection string, a key or the token. The local dump is deleted on exit either way.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORTER="${BACKUP_REPORTER:-$HERE/../../apps/api/scripts/report-backup.mjs}"
NODE_BIN="${NODE_BIN:-node}"

if [[ -z "${BACKUP_DATABASE_URL:-}" || -z "${BACKUP_S3_URI:-}" || -z "${BACKUP_REPORT_URL:-}" || -z "${BACKUP_REPORT_TOKEN:-}" ]]; then
  echo "backup: not configured (BACKUP_DATABASE_URL, BACKUP_S3_URI, BACKUP_REPORT_URL and BACKUP_REPORT_TOKEN are required) — nothing done, nothing reported." >&2
  exit 2
fi

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DUMP="$WORK/aipowersalon-$STAMP.dump"
PITR_ARGS=()
[[ -n "${BACKUP_PITR_ENABLED:-}" ]] && PITR_ARGS=(--pitr "$BACKUP_PITR_ENABLED")

report() { # status detail [size]
  local args=(--kind backup --status "$1" --started "$STARTED" --detail "$2" "${PITR_ARGS[@]}")
  [[ -n "${3:-}" ]] && args+=(--size "$3")
  "$NODE_BIN" "$REPORTER" "${args[@]}"
}
fail() { echo "backup: FAILED at step: $1" >&2; report failure "failed at: $1" || true; exit 1; }

echo "backup: dumping…"
pg_dump --format=custom --no-owner --no-privileges --file="$DUMP" "$BACKUP_DATABASE_URL" 2>"$WORK/dump.err" || { sed -E 's#postgres(ql)?://[^ ]+#<redacted-url>#g' "$WORK/dump.err" >&2; fail dump; }
[[ -s "$DUMP" ]] || fail "dump (empty file)"

echo "backup: verifying the archive is readable…"
pg_restore --list "$DUMP" >"$WORK/toc.txt" 2>/dev/null || fail verify
TABLES="$(grep -c ' TABLE DATA ' "$WORK/toc.txt" || true)"
[[ "${TABLES:-0}" -gt 0 ]] || fail "verify (no table data in the archive)"

SIZE="$(wc -c <"$DUMP" | tr -d ' ')"
echo "backup: uploading ${SIZE} bytes…"
S3_ARGS=(s3 cp "$DUMP" "${BACKUP_S3_URI%/}/aipowersalon-$STAMP.dump" --only-show-errors)
[[ -n "${BACKUP_S3_ENDPOINT:-}" ]] && S3_ARGS+=(--endpoint-url "$BACKUP_S3_ENDPOINT")
aws "${S3_ARGS[@]}" || fail upload

report success "pg_dump custom format, ${TABLES} tables, uploaded off-site" "$SIZE"
