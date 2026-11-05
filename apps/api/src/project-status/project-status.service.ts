// project-status.service.ts — Super Admin project status for POS Settings (framework-free, testable).
// Read-only to everyone except Super Admin (enforced at the controller via SuperAdminGuard).
// Completion is computed honestly from POS_SETTINGS_MODULES facts; recheck only refreshes lastCheckedAt.
import { ProjectTaskStatus, ModuleFact, POS_SETTINGS_MODULES, computeModule } from './project-status.dto';

export class NotFoundError extends Error { constructor(m: string) { super(m); this.name = 'NotFoundError'; } }

export class ProjectStatusService {
  private checkedAt = new Map<string, string>();

  private factOf(key: string): ModuleFact | undefined { return POS_SETTINGS_MODULES.find((m) => m.moduleKey === key); }

  private childStatuses(): ProjectTaskStatus[] {
    return POS_SETTINGS_MODULES.filter((m) => !m.isParent).map((m) => computeModule(m, undefined, this.checkedAt.get(m.moduleKey)));
  }

  // GET /super-admin/project-status/pos-settings  -> parent rollup + every section
  getPosSettings(): { parent: ProjectTaskStatus; sections: ProjectTaskStatus[] } {
    const children = this.childStatuses();
    const parentFact = POS_SETTINGS_MODULES.find((m) => m.isParent)!;
    const parent = computeModule(parentFact, children, this.checkedAt.get(parentFact.moduleKey));
    return { parent, sections: children };
  }

  // GET /super-admin/project-status -> flat list of all modules (parent + sections)
  getAll(): ProjectTaskStatus[] {
    const { parent, sections } = this.getPosSettings();
    return [parent, ...sections];
  }

  // GET /super-admin/project-status/pos-settings/:moduleKey
  getModule(moduleKey: string): ProjectTaskStatus {
    const fact = this.factOf(moduleKey);
    if (!fact) throw new NotFoundError('unknown module: ' + moduleKey);
    if (fact.isParent) return this.getPosSettings().parent;
    return computeModule(fact, undefined, this.checkedAt.get(moduleKey));
  }

  // PATCH /super-admin/project-status/pos-settings/:moduleKey/recheck -> refresh lastCheckedAt, recompute
  recheck(moduleKey: string): ProjectTaskStatus {
    const fact = this.factOf(moduleKey);
    if (!fact) throw new NotFoundError('unknown module: ' + moduleKey);
    this.checkedAt.set(moduleKey, new Date().toISOString());
    return this.getModule(moduleKey);
  }
}
