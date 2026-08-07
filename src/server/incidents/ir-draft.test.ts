import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateIncidentNumber } from "./ir-draft";
import * as schema from "../db/schema";
import { like } from "drizzle-orm";

describe("generateIncidentNumber", () => {
  const dbMock = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should generate IR0001 for the first case of the day", async () => {
    dbMock.where.mockResolvedValueOnce([]);
    const now = new Date("2026-08-07T12:00:00Z");

    // @ts-expect-error Mock DB
    const result = await generateIncidentNumber(dbMock, now);

    expect(result).toBe("IR260807001");
    expect(dbMock.where).toHaveBeenCalled();
  });

  it("should increment the highest running number found", async () => {
    dbMock.where.mockResolvedValueOnce([
      { number: "IR260807001" },
      { number: "IR260807042" },
      { number: "IR260807005" },
    ]);
    const now = new Date("2026-08-07T12:00:00Z");

    // @ts-expect-error Mock DB
    const result = await generateIncidentNumber(dbMock, now);

    expect(result).toBe("IR260807043");
  });

  it("should handle null or invalid numbers safely", async () => {
    dbMock.where.mockResolvedValueOnce([
      { number: null },
      { number: "IR260807foo" },
      { number: "IR260807002" },
    ]);
    const now = new Date("2026-08-07T12:00:00Z");

    // @ts-expect-error Mock DB
    const result = await generateIncidentNumber(dbMock, now);

    expect(result).toBe("IR260807003");
  });
});