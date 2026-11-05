// config/ — BUILD_PLAN Phase 13 B (Constitution 6 §52–57, §219–220): /app-config on launch + resume, the hard update screen,
// the recommended-update / maintenance / module banners, and the remote-flag hooks.
export { AppConfigGate, useAppConfig, useRemoteFlag, useModuleNotice, useUpdateState, appConfigPath, resetAppConfig, RESUME_REFETCH_MS, type AppConfigGateProps, type GateApp } from './gate';
export { UPDATE_REQUIRED_EVENT } from './events';
