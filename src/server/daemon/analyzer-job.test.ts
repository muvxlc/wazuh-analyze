import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { analyzeBacklog } from "./analyzer-job";
import { AppConfig } from "../config";
import * as analyzeService from "../ai/analyze-service";
import * as correlator from "../incidents/correlator";
import { ActorContext } from "../authorization/permissions";
import { Database } from "../db/types";

vi.mock("../ai/analyze-service", () => ({
  runAlertAnalysis: vi.fn(),
}));

vi.mock("../incidents/correlator", () => ({
  correlateAlert: vi.fn(),
}));

const mockActor: ActorContext = {
  userId: "system-daemon",
  role: "admin",
  permissions: new Set(["alerts.analyze"]),
};

const mockConfig: AppConfig = {
  socAutoAnalyzeMinLevel: 7,
} as AppConfig;

describe("analyzeBacklog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips if interrupted before query", async () => {
    const db = {} as Database;
    await analyzeBacklog(db, mockActor, mockConfig, () => true);
    expect(analyzeService.runAlertAnalysis).not.toHaveBeenCalled();
  });

  it("processes pending alerts and correlates them", async () => {
    // Mock Drizzle query builder chain
    const mockLimit = vi.fn().mockResolvedValue([
      { id: "alert-1", level: 8 },
      { id: "alert-2", level: 12 },
    ]);
    const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
    const mockLeftJoin = vi.fn().mockReturnValue({ where: mockWhere });
    const mockFrom = vi.fn().mockReturnValue({ leftJoin: mockLeftJoin });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
    const db = { select: mockSelect } as unknown as Database;

    vi.mocked(analyzeService.runAlertAnalysis).mockResolvedValue({ id: "analysis-1", alertId: "alert-1", verdict: { summary: "test", confidence: 0.9 } });
    vi.mocked(correlator.correlateAlert).mockResolvedValue(null);

    // Run without awaiting to advance timers
    const promise = analyzeBacklog(db, mockActor, mockConfig, () => false);

    // First alert
    await vi.advanceTimersToNextTimerAsync();

    // Second alert
    await vi.advanceTimersToNextTimerAsync();

    await promise;

    expect(analyzeService.runAlertAnalysis).toHaveBeenCalledTimes(2);
    expect(analyzeService.runAlertAnalysis).toHaveBeenNthCalledWith(
      1,
      db,
      mockActor,
      "alert-1",
      { enrich: true },
      expect.anything(),
      mockConfig
    );
    expect(correlator.correlateAlert).toHaveBeenCalledTimes(2);
    expect(correlator.correlateAlert).toHaveBeenNthCalledWith(1, db, "alert-1");
  });

  it("skips failed alerts but continues processing", async () => {
    const mockLimit = vi.fn().mockResolvedValue([
      { id: "alert-1", level: 8 },
      { id: "alert-2", level: 9 },
    ]);
    const db = { select: () => ({ from: () => ({ leftJoin: () => ({ where: () => ({ orderBy: () => ({ limit: mockLimit }) }) }) }) }) } as unknown as Database;

    vi.mocked(analyzeService.runAlertAnalysis)
      .mockRejectedValueOnce(new Error("Analysis failed"))
      .mockResolvedValueOnce({ id: "analysis-2", alertId: "alert-2", verdict: { summary: "test", confidence: 0.9 } });

    const promise = analyzeBacklog(db, mockActor, mockConfig, () => false);
    await vi.advanceTimersToNextTimerAsync(); // alert 1
    await vi.advanceTimersToNextTimerAsync(); // alert 2
    await promise;

    // Both were attempted
    expect(analyzeService.runAlertAnalysis).toHaveBeenCalledTimes(2);
    // Only the second one correlated because first failed
    expect(correlator.correlateAlert).toHaveBeenCalledTimes(1);
    expect(correlator.correlateAlert).toHaveBeenCalledWith(db, "alert-2");
  });

  it("stops immediately if interrupted mid-loop", async () => {
    const mockLimit = vi.fn().mockResolvedValue([
      { id: "alert-1", level: 8 },
      { id: "alert-2", level: 9 },
    ]);
    const db = { select: () => ({ from: () => ({ leftJoin: () => ({ where: () => ({ orderBy: () => ({ limit: mockLimit }) }) }) }) }) } as unknown as Database;

    let interrupted = false;
    vi.mocked(analyzeService.runAlertAnalysis).mockImplementation(async () => {
      interrupted = true; // Interrupt after first call
      return { id: "a1", alertId: "a1", verdict: { summary: "test", confidence: 0.9 } };
    });

    const promise = analyzeBacklog(db, mockActor, mockConfig, () => interrupted);
    // Even though we have timers, the interrupt check happens synchronously in the loop
    await promise;

    // Only called once because of interrupt
    expect(analyzeService.runAlertAnalysis).toHaveBeenCalledTimes(1);
  });
});
