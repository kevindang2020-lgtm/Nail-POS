import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

// jsdom doesn't implement scrollIntoView; stub it so async ref.scrollIntoView() calls (e.g. Booking Assistant) don't
// throw an unhandled error during teardown. Harmless no-op in tests; real browsers provide the real method.
if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => {};
