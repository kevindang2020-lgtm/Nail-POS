import { Injectable, NestMiddleware } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { maintenanceDecision } from './maintenance-core';

// Applied globally AFTER TenantContextMiddleware, so req.ctx.role is available. Uses the pure maintenanceDecision:
// SUPER_ADMIN and unauthenticated entry points (login/health/public) always pass, so maintenance can never lock
// everyone out. Fails OPEN — if the state read errors, the request proceeds (maintenance must not cause an outage).
@Injectable()
export class MaintenanceMiddleware implements NestMiddleware {
  constructor(private readonly svc: MaintenanceService) {}
  async use(req: any, res: any, next: () => void): Promise<void> {
    try {
      const state = await this.svc.cachedState();
      if (!state.active) return next();
      const decision = maintenanceDecision(state, { role: req?.ctx?.role ?? null, method: req.method, path: req.path || req.url || '' });
      if (decision.allow) return next();
      res.status(decision.status).json(decision.body);
    } catch {
      next();
    }
  }
}
