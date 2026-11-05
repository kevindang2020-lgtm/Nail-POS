#!/usr/bin/env sh
# write-saturation-report.sh — Phase 4 Stage 1 measurement harness.
#
# Phase 4 (scale DB writes / sharding) must NOT be acted on without production evidence that WRITES are the bottleneck.
# This script produces that evidence from PostgreSQL's own statistics views, formatted as the spec's decision table.
# Run it against the PRODUCTION primary (read-only; it only SELECTs from pg_stat_* / pg_stat_statements) during peak
# load, on several days, before making any sharding or partitioning decision.
#
# Usage:  DATABASE_URL=postgres://user:pass@primary-host:5432/db  sh write-saturation-report.sh
#         (or pass a psql-style URL as $1)
#
# Requires: psql on PATH. pg_stat_statements gives the richest write/latency signal — enable it if available
# (shared_preload_libraries='pg_stat_statements'); the script degrades gracefully if it's absent.

set -e
URL="${1:-$DATABASE_URL}"
if [ -z "$URL" ]; then echo "error: set DATABASE_URL (or pass a connection URL as arg 1)"; exit 1; fi
PSQL="psql $URL -X -q -t -A -F|"

echo "AIPowerSalon — Phase 4 write-saturation report"
echo "generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=============================================================================="

echo ""
echo "## 1. Largest tables (append-only growth candidates)"
echo "table|total_size|rows|seq_scan|idx_scan"
$PSQL -c "
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)), n_live_tup, seq_scan, idx_scan
FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 15;" || true

echo ""
echo "## 2. Highest-write tables (inserts + updates + deletes since stats reset)"
echo "table|inserts|updates|deletes|hot_update_ratio|dead_tup"
$PSQL -c "
SELECT relname, n_tup_ins, n_tup_upd, n_tup_del,
       CASE WHEN n_tup_upd>0 THEN round(100.0*n_tup_hot_upd/n_tup_upd,1) ELSE NULL END AS hot_upd_pct,
       n_dead_tup
FROM pg_stat_user_tables ORDER BY (n_tup_ins+n_tup_upd+n_tup_del) DESC LIMIT 15;" || true

echo ""
echo "## 3. Write vs read work + commit/rollback (database-wide)"
echo "metric|value"
$PSQL -c "
SELECT 'xact_commit', xact_commit FROM pg_stat_database WHERE datname=current_database()
UNION ALL SELECT 'xact_rollback', xact_rollback FROM pg_stat_database WHERE datname=current_database()
UNION ALL SELECT 'tup_inserted', tup_inserted FROM pg_stat_database WHERE datname=current_database()
UNION ALL SELECT 'tup_updated', tup_updated FROM pg_stat_database WHERE datname=current_database()
UNION ALL SELECT 'tup_deleted', tup_deleted FROM pg_stat_database WHERE datname=current_database()
UNION ALL SELECT 'blks_read(disk)', blks_read FROM pg_stat_database WHERE datname=current_database()
UNION ALL SELECT 'blks_hit(cache)', blks_hit FROM pg_stat_database WHERE datname=current_database()
UNION ALL SELECT 'deadlocks', deadlocks FROM pg_stat_database WHERE datname=current_database()
UNION ALL SELECT 'temp_bytes', temp_bytes FROM pg_stat_database WHERE datname=current_database();" || true

echo ""
echo "## 4. Cache hit ratio (low ratio => reads dominate; a READ problem, not a write problem)"
$PSQL -c "
SELECT round(100.0*sum(blks_hit)/nullif(sum(blks_hit)+sum(blks_read),0),2) || '% buffer cache hit'
FROM pg_stat_database WHERE datname=current_database();" || true

echo ""
echo "## 5. WAL generation (write volume signal; needs pg_stat_wal, PG14+)"
$PSQL -c "SELECT 'wal_bytes='||wal_bytes||' wal_records='||wal_records||' wal_fpi='||wal_fpi FROM pg_stat_wal;" 2>/dev/null || echo "pg_stat_wal unavailable (needs PG14+)"

echo ""
echo "## 6. Lock waits right now (sustained waiters => write contention)"
echo "waiting_pid|blocked_by|wait_event|query_snip"
$PSQL -c "
SELECT a.pid, pg_blocking_pids(a.pid)::text, a.wait_event, left(regexp_replace(a.query,'\s+',' ','g'),60)
FROM pg_stat_activity a
WHERE cardinality(pg_blocking_pids(a.pid))>0;" || echo "(no current lock waits)"

echo ""
echo "## 7. Top statements by total write time (needs pg_stat_statements)"
echo "calls|mean_ms|total_ms|rows|query_snip"
$PSQL -c "
SELECT calls, round(mean_exec_time::numeric,2), round(total_exec_time::numeric,2), rows,
       left(regexp_replace(query,'\s+',' ','g'),70)
FROM pg_stat_statements
WHERE query ~* '^(insert|update|delete)'
ORDER BY total_exec_time DESC LIMIT 15;" 2>/dev/null || echo "pg_stat_statements not enabled — enable it for write-latency evidence"

echo ""
echo "=============================================================================="
echo "## Decision guidance (fill the threshold column from your infra SLOs):"
echo "  - Writes are the bottleneck ONLY if: sustained high commit latency + high WAL rate + lock waits +"
echo "    PgBouncer write-pool saturation, WITH read load already offloaded (cache hit ratio high, replica in use)."
echo "  - A low cache-hit ratio or seq_scan-heavy big tables => a READ/index problem (Phase 1), NOT sharding."
echo "  - One tenant dominating writes => Phase 3 rate limiting, NOT sharding."
echo "  - Fill the Phase 4 decision table with these numbers vs. your approved thresholds, then conclude"
echo "    REQUIRED / NOT REQUIRED. Do not shard on general slowness."
