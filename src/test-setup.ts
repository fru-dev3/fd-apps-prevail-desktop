import "@testing-library/jest-dom/vitest";

// jsdom in this setup doesn't expose a global localStorage; provide a minimal
// in-memory one so components using `localStorage.*` (and the tests) work.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

// The shared query cache is module state: start every test with it empty so a
// page never paints the previous test's data. Imported lazily: a static
// import here would load ./bridge before a test file's vi.mock("./bridge").
import { afterEach } from "vitest";
afterEach(async () => { (await import("./query")).clearQueryCache(); });
