import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '../i18n';   // the POS EN / VI catalogues (t() in every screen resolves to today's English by default)
import '../components/uiText';   // WP-C4: the shared @aipowersalon/ui components' text (as main.tsx does)

afterEach(() => cleanup());

// jsdom doesn't implement scrollIntoView; stub it so async ref.scrollIntoView() calls (e.g. Booking Assistant) don't
// throw an unhandled error during teardown. Harmless no-op in tests; real browsers provide the real method.
if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => {};
