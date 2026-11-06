// egress-install.ts — Security Deep Scan §93 (Nov 5 2026): imported SECOND by main.ts and worker.ts (right after the UTC
// clock), so the process-wide egress allowlist wraps fetch / node:http(s) before any provider client is created.
// EGRESS_POLICY=report (default) logs + counts unlisted hosts; enforce refuses them; off installs nothing.
import { installEgressPolicy } from '@aipowersalon/security';

export const EGRESS_POLICY_ACTIVE = installEgressPolicy(process.env);
