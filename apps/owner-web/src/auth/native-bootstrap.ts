// native-bootstrap.ts — call once at app start.
//
// On the WEB this does nothing: no plugin resolves, no store is installed, and the app keeps using the httpOnly
// cookie. That is deliberate — the web must not gain a token or a native code path, because the cookie (which
// JavaScript cannot read) is the stronger option there.
//
// On NATIVE it installs the Keychain-backed token store, which is what lets the bearer token survive an app
// restart. Without the plugin the app still works; the token simply lives in memory for the session.
import { setSecureStore } from './native-auth';
import { apiBase } from '../api/client';
import { setBiometricStore } from './native-faceid';
import { isNativePlatform, makeSecureStore, makeBiometrics } from './capacitor-adapters';

export interface NativeCapabilities { native: boolean; secureStorage: boolean; biometrics: boolean }


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
    console.warn(
      'Native build notice: VITE_API_BASE is unset. Falling back to default http://localhost:3000.',
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
