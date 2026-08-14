/**
 * Relative / absolute time formatting for the alert feed.
 * Native Intl only — no date library dependency.
 *
 * DEFAULT_NEW_THRESHOLD_MINUTES is the single source of truth for both the
 * "NEW" badge (Feature 2) and the grouping window default (Feature 1).
 */
export const DEFAULT_NEW_THRESHOLD_MINUTES = 15;

function toDate(input: Date | string | number | null | undefined): Date | null {
  if (input == null) return null;
  const d = input instanceof Date ? input : new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

/** "5m ago" / "2h ago" / "3d ago", falling back to an absolute date for older. */
export function formatRelativeTime(
  input: Date | string | number | null | undefined,
  now: number = Date.now(),
): string {
  const date = toDate(input);
  if (!date) return "—";

  const diffMs = now - date.getTime();
  const sec = Math.round(diffMs / 1000);
  const min = Math.round(sec / 60);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);

  if (sec < 0) {
    // Future-dated (clock skew): show absolute.
    return formatAbsoluteTime(date);
  }
  if (sec < 45) return "just now";
  if (min < 60) return `${min}m ago`;
  if (hr < 24) return `${hr}h ago`;
  if (day < 7) return `${day}d ago`;
  return formatAbsoluteTime(date);
}

/** Locale-formatted absolute timestamp for tooltips / old items. */
export function formatAbsoluteTime(
  input: Date | string | number | null | undefined,
): string {
  const date = toDate(input);
  if (!date) return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

/** True when the alert was ingested within the last `thresholdMinutes`. */
export function isNew(
  input: Date | string | number | null | undefined,
  now: number = Date.now(),
  thresholdMinutes: number = DEFAULT_NEW_THRESHOLD_MINUTES,
): boolean {
  const date = toDate(input);
  if (!date) return false;
  return now - date.getTime() <= thresholdMinutes * 60 * 1000;
}
