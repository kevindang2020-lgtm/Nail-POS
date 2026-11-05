// @aipowersalon/auth — Constitution 13 §70: authentication primitives, framework-free, with no business roles (roles
// and the catalog are @aipowersalon/permissions). Starts with what 11 API directories were blocked on: credential
// hashing and the password policy. Sessions, MFA, passkeys and device auth join as each is measured and extracted.
export * from './password';   // moved from apps/api/src/auth/password.ts (Constitution 13 §219)
export * from './password-policy';   // moved from apps/api/src/auth/password-policy.ts (Constitution 13 §219)
export * from './security';   // moved from apps/api/src/auth/security.ts (Constitution 13 §219)
export * from './ephemeral-grants';   // moved from apps/api/src/common/ephemeral-grants.ts (Constitution 13 §219)
export * from './service-principals';   // Constitution 3 Step 6: service principals
