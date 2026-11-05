import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
// Register the EN/VI catalogues once (as main.tsx does) so screens render English text, not raw i18n keys.
import '../i18n';

afterEach(() => cleanup());

// jsdom doesn't implement scrollIntoView; stub it so async ref.scrollIntoView() calls (e.g. Booking Assistant) don't
// throw an unhandled error during teardown. Harmless no-op in tests; real browsers provide the real method.
if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => {};
