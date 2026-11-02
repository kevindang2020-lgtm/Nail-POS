// enroll.ts — Secure Tap to Pay M6-4: register THIS phone (POST mobile-checkout/device/register) with its public key,
// signed by that key (proof of possession), optionally presenting a POS pairing code (pre-approval for this location).
//
//   • A plain registration lands 'pending' until the owner approves it (or is already active / keyless-legacy → key attached).
//   • DEVICE_KEY_MISMATCH on registration means the server holds ANOTHER key for this id (the old key was lost with the
//     phone's storage): the identity is replaced ONCE by a new id + key and registered as a new device (owner approval).
//   • DEVICE_REVOKED: the client's device rules wipe the identity and lock the app (api/client.ts).
//   • PAIRING_CODE_INVALID and every other refusal are returned to the caller with a plain-English message.
import { mobileCheckoutApi } from '../api/mobileCheckoutApi';
import { isTapToPayAvailable } from '../native/tapToPay';
import { devicePlatform } from '@aipowersalon/mobile-sdk';
import { currentKey, markEnrolled, trackEnrollment, wipeDeviceIdentity, keyUnavailableReason } from './deviceKeys';
import { deviceErrorCode } from './deviceErrors';
import { setDeviceStanding, standingFromStatus } from './deviceState';

export interface EnrollResult { deviceId: string; status: string }
export class EnrollError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = 'EnrollError'; } }

async function registerOnce(pairingCode?: string | null): Promise<EnrollResult> {
  const k = await currentKey();
  if (!k) throw new EnrollError('DEVICE_KEY_UNAVAILABLE', keyUnavailableReason() || 'This phone cannot create its secure payment key.');
  let capable = false; try { capable = isTapToPayAvailable(); } catch { capable = false; }
  const p = devicePlatform();
  const r = await mobileCheckoutApi.registerDevice({
    deviceId: k.deviceId,
    platform: p === 'web' ? 'ios' : p,   // the server's platform enum is ios | android; the web preview stands in for the iPhone build
    appVersion: (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_APP_VERSION || undefined,
    tapToPayCapable: capable,
    publicKey: k.publicKey,
    ...(pairingCode ? { pairingCode } : {}),
  });
  await markEnrolled();
  setDeviceStanding(standingFromStatus(r?.status));
  return r;
}

/** Register (or re-register) this phone's key. Re-running it is safe: the server answers with the phone's current status. */
export function enrollDevice(opts: { pairingCode?: string | null } = {}): Promise<EnrollResult> {
  return trackEnrollment((async () => {
    try { return await registerOnce(opts.pairingCode); }
    catch (e) {
      const code = deviceErrorCode(e) ?? (e as { code?: unknown } | null)?.code;
      if (code === 'DEVICE_KEY_MISMATCH') {   // our key is not the one on file for this id: become a NEW device, once
        await wipeDeviceIdentity();
        return await registerOnce(opts.pairingCode);
      }
      throw e;
    }
  })());
}
