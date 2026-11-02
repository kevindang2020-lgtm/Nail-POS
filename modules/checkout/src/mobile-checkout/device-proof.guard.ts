// device-proof.guard.ts — Secure Tap to Pay mandate §4 / §16 / §61 / §70–§72 (Oct 23 2026). Runs on every Payment App route,
// after the session guards. When a request names a payment device (x-aps-device-id):
//   • the device must exist in THIS tenant, and a revoked / compromised phone is refused on EVERY route at once
//     (DEVICE_REVOKED) — the backend, not realtime, ends a lost phone (§16, §72);
//   • when the device has a registered key, the request must carry a valid signature by it (timestamp window, body hash)
//     and an unused nonce (DEVICE_KEY_MISMATCH / DEVICE_REQUEST_REPLAYED);
//   • the registration of a NEW key is verified with the key in its own body (proof of possession).
// A verified request carries req.verifiedDeviceId; the service's money operations require it for keyed devices (and, under
// the 'required' policy, for every device). A request that names no device passes untouched (POS routes, legacy apps).
// §51 (Oct 26 2026): every refusal here is counted, and a revoked phone still calling / a failed signature / a replay raises
// a (deduplicated) security event through device-security-signals.ts.
import { CanActivate, ExecutionContext, HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import { ERROR_REGISTRY } from '@aipowersalon/api-contracts';
import type { MobilePayDeviceStore } from './mobile-pay-device';
import { checkProof, readProof, DeviceProofError } from './device-proof';
import type { DeviceSecuritySignals, DeviceSecurityKind } from './device-security-signals';

function refuse(code: keyof typeof ERROR_REGISTRY, message?: string): never {
  const e = ERROR_REGISTRY[code];
  throw new HttpException({ error: code, code, message: message ?? e.message }, e.status);
}

@Injectable()
export class DeviceProofGuard implements CanActivate {
  constructor(@Optional() @Inject('MobilePayDeviceStore') private readonly devices?: MobilePayDeviceStore | null,
              @Optional() @Inject('DeviceSecuritySignals') private readonly signals?: DeviceSecuritySignals | null) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http' || !this.devices) return true;
    const req = context.switchToHttp().getRequest();
    const proof = readProof(req?.headers ?? {});
    if (!proof) return true;
    const tenantId = req?.ctx?.tenantId;
    if (!tenantId || !proof.deviceId) refuse('DEVICE_NOT_REGISTERED');
    const rec = await this.devices.get(tenantId, proof.deviceId);
    const path = String(req.originalUrl ?? req.url ?? '');
    const isRegister = /\/mobile-checkout\/device\/register(\?|$)/.test(path);
    const flag = (kind: DeviceSecurityKind, detail?: string) => this.signals?.signal(kind, { tenantId, deviceId: proof.deviceId, userId: req?.ctx?.userId ?? null, ip: req?.ip ?? null, detail: detail ?? null });
    if (rec && (rec.status === 'revoked' || rec.status === 'compromised')) { flag('revoked_device_attempt'); refuse('DEVICE_REVOKED'); }
    // the key to check: the registered one; for a registration that brings a key, the key it brings (possession proof)
    const bodyKey = isRegister && typeof req?.body?.publicKey === 'string' ? String(req.body.publicKey) : null;
    const key = rec?.publicKey ?? bodyKey;
    if (!rec && !bodyKey) refuse('DEVICE_NOT_REGISTERED');
    if (!key) return true;   // a legacy (key-less) phone: unsigned rules apply in the service
    if (!proof.sig) { flag('key_mismatch', 'device id without a signature'); refuse('DEVICE_KEY_MISMATCH', 'This payment device must sign its requests.'); }
    const raw = req.rawBody ?? (req.body && Object.keys(req.body).length ? JSON.stringify(req.body) : '');
    const r = checkProof({ method: req.method, path, headers: req.headers, rawBody: raw }, proof, key);
    if (!r.ok) {
      await this.devices.touchError?.(tenantId, proof.deviceId, 'DEVICE_KEY_MISMATCH').catch((e: unknown) => console.warn('[device-proof] could not stamp the key mismatch on the device:', (e as Error)?.message));   // the refusal stands
      flag('key_mismatch', `signature check failed (${r.reason ?? 'invalid'})`);
      refuse('DEVICE_KEY_MISMATCH');
    }
    if (this.devices.consumeNonce && !(await this.devices.consumeNonce(tenantId, proof.deviceId, proof.nonce))) { flag('request_replayed'); refuse('DEVICE_REQUEST_REPLAYED'); }
    req.verifiedDeviceId = proof.deviceId;
    return true;
  }
}
export { DeviceProofError };
