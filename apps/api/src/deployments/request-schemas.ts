// request-schemas.ts — BUILD_PLAN Phase 12 (#17): deployment & update control (pos-web posDeploymentsApi). The service
// keeps the status vocabulary and the advance rules (deployments.service); this declares the shape.
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
export const DEPLOYMENT_CREATE_BODY: BodySchema = S.object({ component: str(200), componentKind: str(20), installedVersion: str(64), latestVersion: str(64), targetCount: { type: ['number', 'string', 'null'], maxLength: 12 }, status: str(20) });
export const DEPLOYMENT_ADVANCE_BODY: BodySchema = S.object({ action: str(32), idempotencyKey: str(200) });
