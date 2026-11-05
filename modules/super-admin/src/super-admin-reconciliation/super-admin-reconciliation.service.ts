// super-admin-reconciliation.service.ts — thin service over the platform-aggregate repo. No tenant financial
// detail is ever assembled here.
import type { SuperAdminReconRepositoryPort, ReconOversight } from './super-admin-reconciliation.repository';

export class SuperAdminReconService {
  constructor(private readonly repo: SuperAdminReconRepositoryPort) {}
  async overview(): Promise<ReconOversight & { note: string }> {
    const o = await this.repo.overview();
    return { ...o, note: 'Platform aggregates only. Tenant bank deposits, settlement details, and merchant IDs are not exposed here.' };
  }
}
