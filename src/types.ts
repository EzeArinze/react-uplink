/**
 * Configuration options for useOffline().
 */
export interface UseOfflineOptions {
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
export interface OfflineStatus {
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

/**
 * Fully-resolved internal config, after defaults have been applied.
 * Not exported publicly — internal use by the store only.
 */
export interface ResolvedOfflineConfig {
  pingUrl: string | undefined;
  pingFn: (() => Promise<boolean>) | undefined;
  pingMethod: 'HEAD' | 'GET';
  pingCredentials: RequestCredentials;
  pingInterval: number;
  timeout: number;
  failureThreshold: number;
  successThreshold: number;
  verifyOnBrowserOnlineEvent: boolean;
  pauseWhenHidden: boolean;
}

/**
 * Internal mutable state held by the store, minus the `retry` function
 * (which is attached separately since it's stable per-store, not
 * per-snapshot).
 */
export type OfflineState = Omit<OfflineStatus, 'retry'>;

/** A subscriber callback used by the internal store. */
export type Listener = () => void;
