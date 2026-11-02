// voice-auth.guard.ts — the enforcement point for the Voice Booking Gateway (Phase 2). Every voice route passes through
// here. It reads the presented integration key from a header, resolves it to a VoiceContext (tenant+branch) via the key
// service, and attaches it to the request as req.voiceCtx. No valid key → 401. tenant/branch are NEVER taken from the
// request body or the provider — only from the key — so the AI cannot choose a tenant.
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { VoiceKeyService } from './voice-key.service';

/** Extract the raw key from the standard header or an Authorization: Bearer header. */
export function presentedVoiceKey(headers: Record<string, any>): string | null {
  const direct = headers['x-voice-key'] ?? headers['X-Voice-Key'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const auth = headers['authorization'] ?? headers['Authorization'];
  if (typeof auth === 'string' && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  return null;
}

@Injectable()
export class VoiceAuthGuard implements CanActivate {
  constructor(private readonly keys: VoiceKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const presented = presentedVoiceKey(req?.headers ?? {});
    const ctx = await this.keys.resolveContext(presented);
    if (!ctx) throw new UnauthorizedException('Invalid or missing voice integration key.');
    // Attach the server-derived context; downstream tools read tenant/branch from here, never from the body.
    req.voiceCtx = { tenantId: ctx.tenantId, branchId: ctx.branchId };
    req.voiceKeyId = ctx.keyId;
    req.voiceProvider = ctx.provider;
    return true;
  }
}
