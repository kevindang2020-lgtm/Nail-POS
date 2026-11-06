// @aipowersalon/ui — canonical shared design system. Import tokens once at app root: `import '@aipowersalon/ui/tokens.css'`.
export * from './components';
export type { Tone, Column } from './components';
export { parseDollarsToCents, formatCentsUsd, keypadPress } from './money-input';
export { TipKeypad } from './TipKeypad';
export { AppErrorBoundary, configureErrorReporting, installGlobalErrorHandlers, installFetchObserver, initErrorReporting, noteResponse, reportClientError, lastRequestReference, resolveApiBase, resolveAppVersion, resolveClientPlatform, setCurrentScreen, MAX_REPORTS_PER_PAGE } from './error-reporting';
export type { ClientApp, ErrorKind } from './error-reporting';
// Constitution 13 Phase 5: the platform brand and the inline dialogs, formerly copied into every app (brand ×6 by
// scripts/sync-brand.mjs; dialogs ×5 and ×2 by hand) — one implementation, one import.
export { PlatformLogo } from './brand/PlatformLogo';
export * from './brand/platform-brand';
export { applyPlatformBranding } from './brand/branding-client';
export { useInlineConfirm } from './InlineConfirm';
export { useInlineAsk } from './InlineAsk';
export { useEscapeKey } from './useEscapeKey';
export { AnimatedSplash } from './AnimatedSplash';   // developer merge Sep 2026 — was copied into customer/owner/tech apps
export { ProfileAvatarWithPreview, resolveAvatarUrl, setAvatarPreviewTitle } from './ProfileAvatarWithPreview';   // developer merge Sep 2026 — was copied into admin/pos apps
// 23-inch dual-screen spec §47–§57: one advertisement renderer for the customer display AND the POS preview
export { DisplayAdSlide, AdRotator, AdFallbackPanel, AdQrCode, qrPath, AD_PANEL_FRACTION, AD_CROSSFADE_MS, type AdSlideContent, type AdSlideImage, type RotatingAd } from './DisplayAdSlide';
export { useEventCallback, useStableValue } from './stable-hooks';   // exhaustive-deps → 0 (Oct 27 2026): latest-closure callbacks + structurally stable values
export { EnableNotificationsBanner, pushPromptSnoozed, snoozePushPrompt, PUSH_PROMPT_DISMISS_KEY, PUSH_PROMPT_SNOOZE_MS, type EnableNotificationsBannerProps } from './EnableNotificationsBanner';   // Nov 6 2026: notification permission from a tap
