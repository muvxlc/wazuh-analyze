import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const shared = {
  environment: "node" as const,
  setupFiles: ["./vitest.setup.ts"],
};

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    projects: [
      {
        test: {
          ...shared,
          name: "unit",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/**/*.integration.test.{ts,tsx}"],
        },
      },
      {
        test: {
          ...shared,
          name: "integration",
          include: ["src/**/*.integration.test.{ts,tsx}"],
        },
      },
      {
        test: {
          ...shared,
          name: "live",
          include: ["tests/live/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});