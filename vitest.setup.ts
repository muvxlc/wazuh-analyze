import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("server-only", () => ({}));

// jsdom may block Storage on opaque origins (SecurityError). Provide a
// minimal in-memory fallback so client-component tests match runtime.
function installStorageMock(name: "localStorage" | "sessionStorage") {
  if (typeof window === "undefined") return;
  try {
    const probe = window[name];
    probe.setItem("__ls_probe__", "1");
    probe.removeItem("__ls_probe__");
  } catch {
    const store = new Map<string, string>();
    Object.defineProperty(window, name, {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, String(v)),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: (i: number) => Array.from(store.keys())[i] ?? null,
        get length() {
          return store.size;
        },
      },
    });
  }
}
installStorageMock("localStorage");
installStorageMock("sessionStorage");
