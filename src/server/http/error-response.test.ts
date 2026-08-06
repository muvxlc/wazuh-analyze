import { describe, expect, it, vi } from "vitest";

import { AppError } from "../errors";
import { toErrorResponse } from "./error-response";
import { getRequestMetadata } from "./request-metadata";

describe("toErrorResponse", () => {
  it("maps AppError to stable JSON", async () => {
    const response = toErrorResponse(new AppError("forbidden", 403), "req-1");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "forbidden", requestId: "req-1" },
    });
  });

  it("does not expose unexpected error details", async () => {
    const response = toErrorResponse(
      new Error("database password leaked"),
      "req-2",
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: "internal_error", requestId: "req-2" },
    });
  });
});

describe("getRequestMetadata", () => {
  it("uses trusted request headers and first forwarded IP", () => {
    const request = new Request("https://dashboard.example.test/alerts", {
      headers: {
        "x-request-id": "req-existing",
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
        "user-agent": "acceptance-agent",
      },
    });

    expect(getRequestMetadata(request)).toEqual({
      requestId: "req-existing",
      ip: "203.0.113.10",
      userAgent: "acceptance-agent",
    });
  });

  it("creates a request ID when the header is absent", () => {
    const randomUuid = vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000001",
    );

    expect(
      getRequestMetadata(new Request("https://dashboard.example.test")),
    ).toEqual({
      requestId: "00000000-0000-4000-8000-000000000001",
      ip: null,
      userAgent: null,
    });

    randomUuid.mockRestore();
  });
});
