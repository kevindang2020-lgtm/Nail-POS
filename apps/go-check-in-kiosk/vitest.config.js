// BUILD_PLAN Phase 6: the kiosk's own tests (the alternate-technician offer in index.html) run in the CI apps lane
// (tooling/ci/run-tests.mjs picks up any app with a vitest config).
export default { test: { include: ['test/**/*.test.mjs'], environment: 'node' } };
