import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

const store = new Map<string, string>();
const storageMock: Storage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
  get length() { return store.size; },
  key: (i: number) => Array.from(store.keys())[i] ?? null,
};
Object.defineProperty(globalThis, 'localStorage', { value: storageMock, writable: true, configurable: true });
Object.defineProperty(window, 'localStorage', { value: storageMock, writable: true, configurable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: storageMock, writable: true, configurable: true });
Object.defineProperty(window, 'sessionStorage', { value: storageMock, writable: true, configurable: true });

afterEach(() => {
  cleanup();
  store.clear();
});

