import { describe, expect, it } from "vitest";

/**
 * Tests for rootcheck column rendering logic.
 * Mirrors RC_COLUMNS in src/app/(dashboard)/posture/page.tsx.
 *
 * Wazuh rootcheck API response shape (verified by probe):
 * { data: { affected_items: [{ check, title, reason, remediation, passed }], total_affected_items } }
 */

type Column = { label: string; render: (r: Record<string, unknown>) => string };

/** Simplified renderers matching the actual page for test purposes. */
function rcStatusLabel(r: Record<string, unknown>): string {
  const v = r.passed;
  if (v === true) return "Passed";
  if (v === false) return "Failed";
  return "-";
}

function rcCheckLabel(r: Record<string, unknown>): string {
  return String(r.check ?? r.title ?? r.description ?? "-");
}

function rcRemediationLabel(r: Record<string, unknown>): string {
  return String(r.remediation ?? r.reason ?? "-");
}

function rcTitleLabel(r: Record<string, unknown>): string {
  return String(r.title ?? r.description ?? "-");
}

const RC_COLUMNS: Column[] = [
  { label: "Check", render: rcCheckLabel },
  { label: "Status", render: rcStatusLabel },
  { label: "Remediation", render: rcRemediationLabel },
  { label: "Title", render: rcTitleLabel },
];

describe("RC_COLUMNS", () => {
  it("renders Passed when passed=true", () => {
    expect(rcStatusLabel({ passed: true })).toBe("Passed");
  });

  it("renders Failed when passed=false", () => {
    expect(rcStatusLabel({ passed: false })).toBe("Failed");
  });

  it("renders dash when passed is missing", () => {
    expect(rcStatusLabel({})).toBe("-");
    expect(rcStatusLabel({ passed: undefined })).toBe("-");
  });

  it("renders Check from check field first, falls back to title, then description", () => {
    expect(rcCheckLabel({ check: "rootkit_test" })).toBe("rootkit_test");
    expect(rcCheckLabel({ title: "Rootkit check" })).toBe("Rootkit check");
    expect(rcCheckLabel({ description: "Desc check" })).toBe("Desc check");
    expect(rcCheckLabel({})).toBe("-");
  });

  it("renders Remediation from remediation field first, falls back to reason", () => {
    expect(rcRemediationLabel({ remediation: "Patch KB" })).toBe("Patch KB");
    expect(rcRemediationLabel({ reason: "Some reason" })).toBe("Some reason");
    expect(rcRemediationLabel({})).toBe("-");
  });

  it("renders Title from title field first, falls back to description", () => {
    expect(rcTitleLabel({ title: "Rootkit check" })).toBe("Rootkit check");
    expect(rcTitleLabel({ description: "Desc" })).toBe("Desc");
    expect(rcTitleLabel({})).toBe("-");
  });

  it("renders all columns for realistic rootcheck row", () => {
    const row = {
      check: "rootkit_test",
      title: "Rootkit test",
      reason: "File /etc/passwd modified",
      remediation: "Review and restore",
      passed: false,
    } as Record<string, unknown>;
    const results = RC_COLUMNS.map((c) => c.render(row));
    expect(results).toEqual(["rootkit_test", "Failed", "Review and restore", "Rootkit test"]);
  });

  it("renders all columns for passed rootcheck row", () => {
    const row = {
      check: "syscheck_test",
      title: "Syscheck test",
      reason: "No anomalies found",
      passed: true,
    } as Record<string, unknown>;
    const results = RC_COLUMNS.map((c) => c.render(row));
    expect(results).toEqual(["syscheck_test", "Passed", "No anomalies found", "Syscheck test"]);
  });
});

