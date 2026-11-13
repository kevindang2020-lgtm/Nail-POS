import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Render-test config for the POS web app. jsdom environment + the React plugin (TSX transform). Tests mock global fetch
// so screens render against canned API responses — no live backend or browser needed.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@aipowersalon/ui': fileURLToPath(new URL('../../packages/ui/src', import.meta.url)), '@aipowersalon/booking-schedule-board': fileURLToPath(new URL('../../packages/booking-schedule-board/src', import.meta.url)), '@aipowersalon/realtime-client': fileURLToPath(new URL('../../packages/realtime-client/src', import.meta.url)), '@aipowersalon/realtime-contracts': fileURLToPath(new URL('../../packages/realtime-contracts/src', import.meta.url)), '@aipowersalon/money': fileURLToPath(new URL('../../packages/money/src', import.meta.url)), '@aipowersalon/date-time': fileURLToPath(new URL('../../packages/date-time/src', import.meta.url)), '@aipowersalon/mobile-sdk/i18n': fileURLToPath(new URL('../../packages/mobile-sdk/src/i18n', import.meta.url)), '@aipowersalon/api-client': fileURLToPath(new URL('../../packages/api-client/src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
