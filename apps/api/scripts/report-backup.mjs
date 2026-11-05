#!/usr/bin/env node
// report-backup.mjs — tell AIPowerSalon that a backup (or restore drill) ran. Constitution 11 §114–116.
//
// Run it at the end of whatever job takes the backup — a Railway cron service, a GitHub Action, a laptop cron:
//
//   BACKUP_REPORT_URL=https://<your-api>/internal/backups/report \
//   BACKUP_REPORT_TOKEN=<same value as the API's BACKUP_REPORT_TOKEN> \
//   node scripts/report-backup.mjs --status success --size 123456789 --pitr true
//
//   node scripts/report-backup.mjs --kind restore_drill --status success --integrity true --smoke true
//
// It only REPORTS. It never takes, restores or deletes a backup. Exit code 0 when the report was accepted, 1 otherwise,
// so the job that called it fails visibly if the report did not land. Never prints the token.
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const bool = (v) => (v === undefined ? undefined : v === 'true');
const url = process.env.BACKUP_REPORT_URL, token = process.env.BACKUP_REPORT_TOKEN;
if (!url || !token) { console.error('BACKUP_REPORT_URL and BACKUP_REPORT_TOKEN must be set.'); process.exit(1); }
const body = {
  kind: args.kind || 'backup',
  status: args.status || 'success',
  completedAt: args.completed || new Date().toISOString(),
  startedAt: args.started,
  sizeBytes: args.size !== undefined ? Number(args.size) : undefined,
  pitrEnabled: bool(args.pitr), integrityOk: bool(args.integrity), smokeTestOk: bool(args.smoke),
  detail: args.detail,
};
const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-backup-report-token': token }, body: JSON.stringify(body) }).catch((e) => ({ status: 0, text: async () => e.message }));
if (res.status === 204) { console.log(`Reported ${body.kind} ${body.status} at ${body.completedAt}.`); process.exit(0); }
console.error(`Report NOT accepted (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
process.exit(1);
