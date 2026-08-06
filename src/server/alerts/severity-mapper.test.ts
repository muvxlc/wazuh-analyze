import { describe, expect, it } from "vitest";
import { severityFromLevel, severityLabel } from "./severity-mapper";

describe("severityFromLevel", () => {
  it("maps critical level >= 15", () => {
    expect(severityFromLevel(15)).toBe("critical");
    expect(severityFromLevel(16)).toBe("critical");
  });

  it("maps high levels 12-14", () => {
    for (const level of [12, 13, 14]) {
      expect(severityFromLevel(level)).toBe("high");
    }
  });

  it("maps medium levels 7-11", () => {
    for (const level of [7, 8, 9, 10, 11]) {
      expect(severityFromLevel(level)).toBe("medium");
    }
  });

  it("maps low levels 0-6", () => {
    for (const level of [0, 1, 2, 3, 4, 5, 6]) {
      expect(severityFromLevel(level)).toBe("low");
    }
  });

  it("handles boundary values correctly", () => {
    expect(severityFromLevel(0)).toBe("low");
    expect(severityFromLevel(6)).toBe("low");
    expect(severityFromLevel(7)).toBe("medium");
    expect(severityFromLevel(11)).toBe("medium");
    expect(severityFromLevel(12)).toBe("high");
    expect(severityFromLevel(14)).toBe("high");
    expect(severityFromLevel(15)).toBe("critical");
  });

  it("defaults to low for negative levels", () => {
    expect(severityFromLevel(-1)).toBe("low");
  });
});

describe("severityLabel", () => {
  it("returns human-readable labels", () => {
    expect(severityLabel("critical")).toBe("Critical");
    expect(severityLabel("high")).toBe("High");
    expect(severityLabel("medium")).toBe("Medium");
    expect(severityLabel("low")).toBe("Low");
  });
});
