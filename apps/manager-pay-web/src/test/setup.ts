import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '../i18n/catalog';   // the screens render through useT(); main.tsx loads this catalogue at runtime, the tests here

// A deterministic in-memory Web Storage for every test (some Node / jsdom combinations expose a broken or shared
// global localStorage); cleared after each test so no state leaks between them.
function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  };
}
const local = memoryStorage();
const session = memoryStorage();
for (const target of [globalThis, window] as object[]) {
  Object.defineProperty(target, 'localStorage', { value: local, writable: true, configurable: true });
  Object.defineProperty(target, 'sessionStorage', { value: session, writable: true, configurable: true });
}

afterEach(() => {
  cleanup();
  local.clear();
  session.clear();
});
