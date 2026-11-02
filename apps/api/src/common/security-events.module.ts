// security-events.module.ts — Constitution 12 §189: one security-event recorder, available everywhere.
// Global because the emitters live in auth, webhooks, observability and Super Admin; importing it into each would
// be four chances to forget one.
import { Global, Module } from '@nestjs/common';
import { SecurityEvents } from '@aipowersalon/security-center';
import { SecretRotation } from './secret-rotation';
import { FraudDetector } from './fraud-detector';
import { SecurityPosture } from './security-posture';
import { PlatformLockdownGate, revokeAllNonSuperAdminSessions } from './platform-lockdown';
import { SECURITY_POSTURE, PLATFORM_LOCKDOWN, type PlatformLockdownPort } from '@aipowersalon/security';
import { DATABASE } from '@aipowersalon/database';
import { onKeyFallback } from './key-ring';

/** §41: a derived or constant encryption key in use (non-production only — production refuses to boot) is recorded
 *  as a CRITICAL security event. The API owns the key ring, so the API wires its fallback sink to the recorder. */
export class KeyFallbackReporter {
  constructor(events: SecurityEvents) {
    onKeyFallback((purpose, how) => { void events.record({ type: 'KEY_FALLBACK_IN_USE', actorType: 'service', resourceType: 'encryption_key', resourceId: purpose, reason: `derived via ${how}` }); });
  }
}

@Global()
@Module({ providers: [SecurityEvents, SecretRotation, FraudDetector, SecurityPosture, PlatformLockdownGate,
  // Constitution 13 §94: the Super Admin control plane reaches posture and the lockdown gate through these ports.
  { provide: SECURITY_POSTURE, useExisting: SecurityPosture },
  { provide: PLATFORM_LOCKDOWN, useFactory: (gate: PlatformLockdownGate, db: any): PlatformLockdownPort | null => (db ? { revokeAllNonSuperAdmin: (reason: string, keep: string | null) => revokeAllNonSuperAdminSessions(db, reason, keep), invalidate: () => gate.invalidate() } : null), inject: [PlatformLockdownGate, { token: DATABASE, optional: true }] },
  { provide: KeyFallbackReporter, useFactory: (e: SecurityEvents) => new KeyFallbackReporter(e), inject: [SecurityEvents] }], exports: [SecurityEvents, SecretRotation, FraudDetector, SecurityPosture, PlatformLockdownGate, SECURITY_POSTURE, PLATFORM_LOCKDOWN] })
export class SecurityEventsModule {}
