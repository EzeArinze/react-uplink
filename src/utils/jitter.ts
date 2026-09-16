/**
 * Applies ±percent jitter to a base interval, to avoid many clients
 * polling in lockstep (which would cause a synchronized spike of
 * requests against a shared ping endpoint after a shared outage ends).
 *
 * @param baseMs base interval in ms
 * @param percent jitter range as a fraction (0.2 = ±20%)
 */
export function applyJitter(baseMs: number, percent = 0.2): number {
  if (baseMs <= 0) return 0;
  const clampedPercent = Math.min(Math.max(percent, 0), 1);
  const min = baseMs * (1 - clampedPercent);
  const max = baseMs * (1 + clampedPercent);
  return Math.round(min + Math.random() * (max - min));
}

/**
 * Computes the next retry delay while offline, using exponential
 * backoff starting small (fast recovery detection right after going
 * offline) and capping at the configured poll interval (so we never
 * back off slower than the "normal" online polling cadence).
 *
 * @param attempt 1-indexed consecutive failure count
 * @param baseDelayMs starting delay for attempt 1
 * @param capMs maximum delay (typically the configured pingInterval)
 */
export function computeBackoffDelay(
  attempt: number,
  baseDelayMs = 2000,
  capMs = 30000,
): number {
  const safeAttempt = Math.max(1, attempt);
  const exponential = baseDelayMs * Math.pow(2, safeAttempt - 1);
  const capped = Math.min(exponential, capMs);
  return applyJitter(capped, 0.2);
}
