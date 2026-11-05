// native-bootstrap.ts — call once, at app start.
//
// On the WEB this does nothing at all: no plugins resolve, no stores are installed, and the app keeps using the
// httpOnly cookie and WebAuthn. That is deliberate — the web must not gain a token or a native code path.
//
// On NATIVE it installs the Keychain-backed token store and the biometric store, which is what turns on bearer
// auth and Face ID. If a plugin is missing, that capability is simply absent: the token lives in memory for the
// session, or Face ID is unavailable. **It never falls back to `localStorage`** — a bearer token in a plain file
// on a jailbroken device is exactly what someone holding the handset would look for.
import { setSecureStore } from './native-auth';
import { apiBase } from '../api/client';
import { setBiometricStore } from './native-faceid';
import { isNativePlatform, makeSecureStore, makeBiometrics } from './capacitor-adapters';

export interface NativeCapabilities {
  native: boolean;
  secureStorage: boolean;
  biometrics: boolean;
}


/**
 * A native build MUST call an absolute https API base.
 *
 * On the web an empty base means "same-origin", which is exactly right. Inside the Capacitor shell the origin is
 * `capacitor://localhost`, so an empty base makes every request resolve to `capacitor://localhost/customer/...`
 * — a path that does not exist. **Every API call fails**, and it surfaces as a generic network error with no clue
 * as to why. An app shipped this way is simply dead, and nothing in the build would have told you.
 *
 * So: fail LOUDLY, at start-up, on the developer's machine — not silently, on a customer's phone.
 */
function assertNativeApiBase(): void {
  const base = apiBase();
  if (!base || !/^https?:\/\//i.test(base)) {
    throw new Error(
      'Native build misconfigured: VITE_API_BASE must be an absolute http(s):// URL (e.g. https://api.aipowersalon.com). ' +
      `Got ${base ? `"${base}"` : 'nothing'}. Inside the native shell a relative base resolves against ` +
      'capacitor://localhost and EVERY API call fails.',
    );
  }
}

export function initNative(): NativeCapabilities {
  if (!isNativePlatform()) return { native: false, secureStorage: false, biometrics: false };

  assertNativeApiBase();   // a relative base on native = a dead app. Fail here, loudly.

  const store = makeSecureStore();
  if (store) setSecureStore(store);

  const bio = makeBiometrics();
  if (bio) setBiometricStore(bio);

  return { native: true, secureStorage: !!store, biometrics: !!bio };
}
