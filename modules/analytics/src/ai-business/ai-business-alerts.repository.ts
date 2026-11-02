// ai-business-alerts.repository.ts — DTOs + repo port + in-memory adapter for business alert rules (§34).
// Every op is tenant-scoped from ctx. Branch is server-derived (null = all authorized branches). No cross-tenant data.
export const ALERT_METRICS = ['net_sales', 'average_ticket', 'completed_appointments', 'cancellation_rate', 'no_show_rate', 'customer_retention'] as const;
export type AlertMetric = (typeof ALERT_METRICS)[number];
export type AlertOperator = 'lt' | 'gt';
export type AlertChannel = 'in_app' | 'email' | 'sms';
export type AlertFrequency = 'hourly' | 'daily';

export interface AlertContext { tenantId: string; branchId: string; userId: string }

export interface BusinessAlert {
  id: string;
  title: string;
  metricId: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  preset: string;
  minSampleSize: number;
  frequency: AlertFrequency;
  channel: AlertChannel;
  active: boolean;
  createdAt: string;
  lastCheckedAt: string | null;
  lastTriggeredAt: string | null;
}

export interface CreateAlertInput {
  title: string;
  metricId: string;
  operator: string;
  threshold: number;
  preset?: string;
  minSampleSize?: number;
  frequency?: string;
  channel?: string;
}
export interface UpdateAlertInput { active?: boolean; threshold?: number; title?: string }

export interface AlertsRepositoryPort {
  list(ctx: AlertContext): Promise<BusinessAlert[]>;
  get(ctx: AlertContext, id: string): Promise<BusinessAlert | null>;
  create(ctx: AlertContext, input: CreateAlertInput & { metricId: AlertMetric; operator: AlertOperator }): Promise<BusinessAlert>;
  update(ctx: AlertContext, id: string, patch: UpdateAlertInput): Promise<BusinessAlert | null>;
  remove(ctx: AlertContext, id: string): Promise<boolean>;
  markChecked(ctx: AlertContext, id: string, triggered: boolean): Promise<void>;
}

interface Stored extends BusinessAlert { tenantId: string; branchId: string | null }

export class InMemoryAlertsRepository implements AlertsRepositoryPort {
  private rows: Stored[] = [];
  private seq = 0;
  private view(r: Stored): BusinessAlert {
    const { tenantId, branchId, ...pub } = r; void tenantId; void branchId; return pub;
  }
  async list(ctx: AlertContext): Promise<BusinessAlert[]> {
    return this.rows.filter((r) => r.tenantId === ctx.tenantId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((r) => this.view(r));
  }
  async get(ctx: AlertContext, id: string): Promise<BusinessAlert | null> {
    const r = this.rows.find((x) => x.id === id && x.tenantId === ctx.tenantId);
    return r ? this.view(r) : null;
  }
  async create(ctx: AlertContext, input: CreateAlertInput & { metricId: AlertMetric; operator: AlertOperator }): Promise<BusinessAlert> {
    const r: Stored = {
      id: `al_${++this.seq}`, tenantId: ctx.tenantId, branchId: ctx.branchId || null,
      title: input.title, metricId: input.metricId, operator: input.operator, threshold: input.threshold,
      preset: input.preset ?? 'today', minSampleSize: input.minSampleSize ?? 5,
      frequency: (input.frequency as AlertFrequency) ?? 'daily', channel: (input.channel as AlertChannel) ?? 'in_app',
      active: true, createdAt: new Date().toISOString(), lastCheckedAt: null, lastTriggeredAt: null,
    };
    this.rows.push(r);
    return this.view(r);
  }
  async update(ctx: AlertContext, id: string, patch: UpdateAlertInput): Promise<BusinessAlert | null> {
    const r = this.rows.find((x) => x.id === id && x.tenantId === ctx.tenantId);
    if (!r) return null;
    if (patch.active !== undefined) r.active = patch.active;
    if (patch.threshold !== undefined) r.threshold = patch.threshold;
    if (patch.title !== undefined) r.title = patch.title;
    return this.view(r);
  }
  async remove(ctx: AlertContext, id: string): Promise<boolean> {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.id === id && r.tenantId === ctx.tenantId));
    return this.rows.length < before;
  }
  async markChecked(ctx: AlertContext, id: string, triggered: boolean): Promise<void> {
    const r = this.rows.find((x) => x.id === id && x.tenantId === ctx.tenantId);
    if (!r) return;
    const now = new Date().toISOString();
    r.lastCheckedAt = now;
    if (triggered) r.lastTriggeredAt = now;
  }
}
