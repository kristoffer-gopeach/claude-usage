export const AUTO_REFRESH_INTERVAL_MS = 60_000;
export const FAILED_REFRESH_INTERVAL_MS = 5 * AUTO_REFRESH_INTERVAL_MS;

/** Manual refresh is independent of this automatic retry policy. */
export function nextRefreshDelay(lastAttemptAt: number, now: number, failed: boolean): number {
  if (lastAttemptAt === 0) return 0;
  const interval = failed ? FAILED_REFRESH_INTERVAL_MS : AUTO_REFRESH_INTERVAL_MS;
  // A wall-clock adjustment must not postpone refresh indefinitely.
  return Math.min(interval, Math.max(0, lastAttemptAt + interval - now));
}
