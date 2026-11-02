// SCAN (Oct 12 2026): the one import.meta.env key the app reads by name (the dev-server-only ?fixture=1 aid). Vitest and
// Vite replace the literal `import.meta.env` — a cast around it would hide it from both — so it is typed here instead.
interface ImportMetaEnv { readonly DEV: boolean }
interface ImportMeta { readonly env: ImportMetaEnv }
