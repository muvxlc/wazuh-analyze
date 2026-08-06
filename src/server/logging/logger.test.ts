import { describe, expect, it } from "vitest";

import { createLogger, redact } from "./logger";

describe("redact", () => {
  it("redacts nested secrets without mutating safe values", () => {
    expect(
      redact({
        password: "p",
        safe: "visible",
        nested: { authorization: "Bearer x", count: 2 },
      }),
    ).toEqual({
      password: "[REDACTED]",
      safe: "visible",
      nested: { authorization: "[REDACTED]", count: 2 },
    });
  });

  it("redacts case-insensitive secret keys inside arrays", () => {
    expect(
      redact([{ sessionToken: "token" }, { WEBHOOK_SECRET: "secret" }]),
    ).toEqual([
      { sessionToken: "[REDACTED]" },
      { WEBHOOK_SECRET: "[REDACTED]" },
    ]);
  });

  it("redacts nested credential-bearing fields case-insensitively", () => {
    expect(
      redact({
        databaseUrl: "postgresql://user:password@database/app",
        nested: {
          APIKEY: "api-key",
          PrivateKey: "private-key",
          credentials: { username: "user", password: "password" },
        },
      }),
    ).toEqual({
      databaseUrl: "[REDACTED]",
      nested: {
        APIKEY: "[REDACTED]",
        PrivateKey: "[REDACTED]",
        credentials: "[REDACTED]",
      },
    });
  });

  it("replaces circular references with a stable marker", () => {
    const context: Record<string, unknown> = { requestId: "req-1" };
    context.self = context;

    expect(redact(context)).toEqual({
      requestId: "req-1",
      self: "[CIRCULAR]",
    });
  });

  it("does not mark repeated non-circular references as circular", () => {
    const shared = { status: "safe" };

    expect(redact({ first: shared, second: shared })).toEqual({
      first: { status: "safe" },
      second: { status: "safe" },
    });
  });
});

describe("createLogger", () => {
  it("writes structured JSON with redacted context", () => {
    const entries: string[] = [];
    const logger = createLogger((entry) => entries.push(entry));

    logger.info("request complete", {
      requestId: "req-1",
      password: "do-not-log",
    });

    expect(entries).toHaveLength(1);
    expect(JSON.parse(entries[0] ?? "{}")).toMatchObject({
      level: "info",
      message: "request complete",
      context: {
        requestId: "req-1",
        password: "[REDACTED]",
      },
    });
  });

  it("does not throw when structured context is circular", () => {
    const entries: string[] = [];
    const logger = createLogger((entry) => entries.push(entry));
    const context: Record<string, unknown> = { requestId: "req-2" };
    context.parent = context;

    expect(() => logger.error("request failed", context)).not.toThrow();
    expect(JSON.parse(entries[0] ?? "{}")).toMatchObject({
      level: "error",
      context: {
        requestId: "req-2",
        parent: "[CIRCULAR]",
      },
    });
  });
});
