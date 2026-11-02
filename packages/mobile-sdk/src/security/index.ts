// security/ — BUILD_PLAN Phase 13 D (Constitution 6 §130, §179, §245–246): privacy screen + auto-lock.
export { installPrivacyScreen, createAutoLock, PRIVACY_SCREEN_ID, type AppStatePluginLike, type AutoLock, type AutoLockOptions } from './privacy';
export { AppLock, type AppLockProps } from './AppLock';
export { BIOMETRIC_MAX_FAILURES, biometricFailures, recordBiometricFailure, resetBiometricFailures, biometricLockedOut } from './biometric-failures';   // §12
