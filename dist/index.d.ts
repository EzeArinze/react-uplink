//#region src/types.d.ts
/**
 * Configuration options for useOffline().
 */
interface UseOfflineOptions {
  /**
   * URL to ping for active connectivity verification.
   * If omitted (and `pingFn` is also omitted), the hook relies solely on
   * navigator.onLine + browser online/offline events — fast but less
   * accurate, since navigator.onLine only reflects OS-level network
   * interface state, not real internet reachability.
   */
  pingUrl?: string;
  /**
   * Custom ping implementation, for consumers who want to verify
   * connectivity via something other than a plain HTTP request
   * (e.g. a WebSocket ping, a GraphQL query, an RPC health check).
   *
   * Mutually exclusive with `pingUrl` — if both are provided, `pingFn`
   * takes precedence.
   *
   * Must resolve to `true` (reachable) or `false` (unreachable). Should
   * not throw; if it does, it is treated as `false`.
   */
  pingFn?: () => Promise<boolean>;
  /**
   * HTTP method used for the ping request when `pingUrl` is used.
   * HEAD is preferred (no response body transfer) but some endpoints
   * only support GET.
   * @default 'HEAD'
   */
  pingMethod?: 'HEAD' | 'GET';
  /**
   * Credentials mode for the ping request when `pingUrl` is used.
   * Defaults to 'omit' — a health check has no business carrying cookies,
   * and this avoids accidentally leaking auth to a misconfigured pingUrl.
   * @default 'omit'
   */
  pingCredentials?: RequestCredentials;
  /**
   * How often to actively verify connectivity, in ms, while online.
   * Set to 0 to disable polling entirely (only check on browser
   * online/offline events + manual retry()).
   *
   * Actual interval is jittered by ±20% to avoid many clients
   * polling in lockstep (thundering herd on your ping endpoint).
   * @default 30000
   */
  pingInterval?: number;
  /**
   * Max time to wait for a ping response before treating it as a
   * failure, in ms.
   * @default 5000
   */
  timeout?: number;
  /**
   * Number of consecutive failed pings required before transitioning
   * to isOnline: false. Prevents flicker from a single dropped packet
   * or transient blip.
   * @default 2
   */
  failureThreshold?: number;
  /**
   * Number of consecutive successful pings required before
   * transitioning back to isOnline: true after being offline.
   * Deliberately asymmetric with failureThreshold: recovering should
   * feel instant, going offline should be conservative.
   * @default 1
   */
  successThreshold?: number;
  /**
   * Whether to immediately re-verify when the browser fires a native
   * 'online' event, rather than waiting for the next poll tick.
   * @default true
   */
  verifyOnBrowserOnlineEvent?: boolean;
  /**
   * Whether to pause polling when the tab is not visible
   * (document.hidden), and re-check immediately on becoming visible
   * again. Saves battery/data for backgrounded tabs.
   * @default true
   */
  pauseWhenHidden?: boolean;
  /**
   * Called every time the resolved (debounced) online/offline state
   * changes — not on every individual ping attempt.
   */
  onStatusChange?: (status: OfflineStatus) => void;
}
/**
 * The value returned by useOffline().
 */
interface OfflineStatus {
  /**
   * Final, debounced connectivity verdict. This is the primary value
   * to react to in UI.
   */
  isOnline: boolean;
  /** True while a ping request is currently in flight. */
  isChecking: boolean;
  /**
   * Raw navigator.onLine value, updated live from browser events.
   * Exposed for advanced use; isOnline is the recommended signal since
   * it accounts for active verification.
   */
  rawBrowserOnline: boolean;
  /** Timestamp (ms since epoch) of the last completed ping attempt, success or fail. Null if no ping has completed yet. */
  lastCheckedAt: number | null;
  /** Timestamp of the last time isOnline transitioned to true. */
  lastOnlineAt: number | null;
  /** Timestamp of the last time isOnline transitioned to false. */
  lastOfflineAt: number | null;
  /** Current consecutive failure count (resets to 0 on any success). */
  consecutiveFailures: number;
  /**
   * Manually trigger an immediate ping check, bypassing the poll
   * interval and any backoff currently in effect. Resolves with the
   * raw result of that single check (not necessarily the new debounced
   * isOnline value, if thresholds haven't been met yet).
   */
  retry: () => Promise<boolean>;
}
//#endregion
//#region src/useOffline.d.ts
/**
 * React hook for accurate network connectivity detection.
 *
 * With no options, it's a thin wrapper over navigator.onLine and the
 * browser's online/offline events. With `pingUrl` or `pingFn`, it adds
 * active verification (periodic pings, consecutive-failure/success
 * thresholds, jittered polling, exponential backoff while offline) so
 * the reported state reflects real reachability rather than just OS-
 * level network interface status.
 *
 * Safe to call from multiple components simultaneously with the same
 * options — they transparently share one underlying store, so you get
 * one poll loop and one network call, not one per component.
 *
 * SSR-safe: returns a static "online" snapshot on the server and syncs
 * to real state after hydration.
 */
export declare function useOffline(options?: UseOfflineOptions): OfflineStatus;
//#endregion
export type { OfflineStatus, UseOfflineOptions };
//# sourceMappingURL=index.d.ts.map