import { describe, it, expect, vi } from "vitest";
import { setQueuePhase } from "./progress";

function makeChain() {
  const last = { values: vi.fn(), set: vi.fn(), where: vi.fn() };
  last.values.mockReturnValue(last);
  last.set.mockReturnValue(last);
  last.where.mockResolvedValue(undefined);
  return last;
}

function makeDb(currentRow: unknown) {
  const insertChain = makeChain();
  const updateChain = makeChain();
  const limit = vi.fn().mockResolvedValue(currentRow);
  const where = vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit }) });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return {
    db: {
      select: () => ({ from }),
      update: () => updateChain,
      insert: () => insertChain,
    } as unknown as Parameters<typeof setQueuePhase>[0],
    insertChain,
    updateChain,
  };
}

describe("setQueuePhase", () => {
  it("inserts a new progress row when none exists", async () => {
    const { db, insertChain, updateChain } = makeDb([]);
    await setQueuePhase(db, "analyze-alert", "alert-1", "queued");
    expect(insertChain.values).toHaveBeenCalled();
    expect(updateChain.set).not.toHaveBeenCalled();
  });

  it("updates an existing running row when one exists", async () => {
    const { db, insertChain, updateChain } = makeDb([{ id: "row-1" }]);
    await setQueuePhase(db, "analyze-alert", "alert-1", "loading", { jobId: "job-1" });
    expect(updateChain.set).toHaveBeenCalled();
    expect(updateChain.where).toHaveBeenCalled();
    expect(insertChain.values).not.toHaveBeenCalled();
  });

  it("marks completed phase as done status", async () => {
    const { db, updateChain } = makeDb([{ id: "row-1" }]);
    await setQueuePhase(db, "analyze-alert", "alert-1", "completed");
    const args = updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.status).toBe("done");
    expect(args.phase).toBe("completed");
  });

  it("marks failed phase as error status", async () => {
    const { db, updateChain } = makeDb([{ id: "row-1" }]);
    await setQueuePhase(db, "analyze-alert", "alert-1", "failed", { detail: "boom" });
    const args = updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.status).toBe("error");
    expect(args.detail).toBe("boom");
  });
});
