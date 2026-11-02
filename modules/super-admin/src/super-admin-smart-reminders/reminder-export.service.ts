// reminder-export.service.ts — audited CSV export for Smart Reminders (§51). Reuses the injection-guarded toCsv and
// pulls from the same real overview aggregates, so exports reconcile with what's on screen and respect tenant scope.
// Exports carry NO customer contact details — only tenant names, channels, statuses, reasons, and counts. Audited when
// tenant-scoped (platform-wide exports are recorded by the returned artifact + logs).
import { BadRequestException } from '@nestjs/common';
import { parseScope, type OverviewScope } from '@aipowersalon/database';
import { toCsv } from '@aipowersalon/reports';
import { SmartRemindersService, type AdminCtx } from './smart-reminders.service';
import { SmartRemindersRepository } from './smart-reminders.kysely.repository';

const DATASETS = ['tenant-usage', 'failures', 'activity', 'performance'] as const;
type Dataset = (typeof DATASETS)[number];

export class ReminderExportService {
  constructor(private readonly overview: SmartRemindersService, private readonly repo: SmartRemindersRepository) {}

  async exportCsv(ctx: AdminCtx, q: any) {
    const dataset = String(q?.dataset ?? 'tenant-usage') as Dataset;
    if (!DATASETS.includes(dataset)) throw new BadRequestException('invalid dataset');
    const scope: OverviewScope = parseScope(q?.tenantId);
    // Build from the same aggregate the dashboard uses, so totals reconcile and scope is honored.
    const o: any = await this.overview.getOverview(ctx, q || {});

    let headers: string[] = [];
    let rows: (string | number)[][] = [];
    if (dataset === 'tenant-usage') {
      headers = ['Tenant', 'Total', 'Delivered', 'Failed', 'SMS', 'Email', 'Push', 'Delivery %'];
      rows = o.tenantUsage.map((t: any) => [t.tenant, t.total, t.delivered, t.failed, t.sms, t.email, t.push, `${t.deliveryRate}%`]);
    } else if (dataset === 'failures') {
      headers = ['Tenant', 'Channel', 'Failure Reason', 'Status', 'Time'];
      rows = o.deliveryFailures.map((f: any) => [f.tenant, f.channel, f.reason, f.status, f.time]);
    } else if (dataset === 'activity') {
      headers = ['Tenant', 'Channel', 'Status', 'Time'];
      rows = o.recentActivity.map((a: any) => [a.tenant, a.channel, a.status, a.time]);
    } else {
      headers = ['Tenant', 'Delivered', 'Delivery %', 'Open Rate'];
      rows = o.performanceByTenant.map((t: any) => [t.tenant, t.delivered, `${t.deliveryRate}%`, 'Not tracked']);
    }

    const content = toCsv(headers, rows);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `smart-reminders-${dataset}-${stamp}.csv`;
    if (scope.tenantId) await this.repo.writeAudit(ctx, 'export', scope, `Exported Smart Reminders ${dataset} (${rows.length} rows)`, { dataset, rows: rows.length });
    return { ok: true, filename, mimeType: 'text/csv', dataset, rowCount: rows.length, content };
  }
}
