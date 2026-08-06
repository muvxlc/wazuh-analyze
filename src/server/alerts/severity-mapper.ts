export type SeverityLevel = "critical" | "high" | "medium" | "low";

export const SEVERITY_COLORS: Record<SeverityLevel, string> = {
  critical: "#DC2626",
  high: "#EA580C",
  medium: "#D97706",
  low: "#2563EB",
};

export function severityFromLevel(level: number): SeverityLevel {
  if (level >= 15) return "critical";
  if (level >= 12) return "high";
  if (level >= 7) return "medium";
  return "low";
}

export function severityLabel(severity: SeverityLevel): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}
