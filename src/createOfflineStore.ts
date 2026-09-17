import type {
  Listener,
  OfflineState,
  ResolvedOfflineConfig,
  UseOfflineOptions,
} from './types';
import { performPing, type FetchImpl } from './ping';
import { applyJitter, computeBackoffDelay } from './utils/jitter';
import { isBrowser, getRawBrowserOnline, isDocumentHidden } from './utils/isBrowser';

const DEFAULTS: Omit<ResolvedOfflineConfig, 'pingUrl' | 'pingFn'> = {
  pingMethod: 'HEAD',
  pingCredentials: 'omit',
  pingInterval: 30000,
  timeout: 5000,
  failureThreshold: 2,
  successThreshold: 1,
  verifyOnBrowserOnlineEvent: true,
  pauseWhenHidden: true,
};

function resolveConfig(options: UseOfflineOptions): ResolvedOfflineConfig {
  return {
    pingUrl: options.pingUrl,
    pingFn: options.pingFn,
    pingMethod: options.pingMethod ?? DEFAULTS.pingMethod,
    pingCredentials: options.pingCredentials ?? DEFAULTS.pingCredentials,
    pingInterval: options.pingInterval ?? DEFAULTS.pingInterval,
    timeout: options.timeout ?? DEFAULTS.timeout,
    failureThreshold: options.failureThreshold ?? DEFAULTS.failureThreshold,
    successThreshold: options.successThreshold ?? DEFAULTS.successThreshold,
    verifyOnBrowserOnlineEvent:
      options.verifyOnBrowserOnlineEvent ?? DEFAULTS.verifyOnBrowserOnlineEvent,
    pauseWhenHidden: options.pauseWhenHidden ?? DEFAULTS.pauseWhenHidden,
  };
}

function hasActiveVerification(config: ResolvedOfflineConfig): boolean {
  return Boolean(config.pingFn || config.pingUrl);
}

function initialState(): OfflineState {
  const rawBrowserOnline = getRawBrowserOnline();
  return {
    isOnline: rawBrowserOnline,
    isChecking: false,
    rawBrowserOnline,
    lastCheckedAt: null,
    lastOnlineAt: null,
    lastOfflineAt: null,
    consecutiveFailures: 0,
  };
}

/**
 * A single store instance, scoped to one resolved config. Consumers
 * that call useOffline() with the *same* effective config share one of
 * these (see getStore below), so there is only ever one interval and
 * one in-flight ping per distinct configuration, regardless of how
 * many components use the hook.
 */
export class OfflineStore {
  private config: ResolvedOfflineConfig;
  private state: OfflineState;
  private listeners = new Set<Listener>();
  private fetchImpl: FetchImpl;

  private pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<boolean> | null = null;
  private destroyed = false;

  private onlineHandler = () => this.handleBrowserOnlineEvent();
  private offlineHandler = () => this.handleBrowserOfflineEvent();
  private visibilityHandler = () => this.handleVisibilityChange();

  constructor(options: UseOfflineOptions, fetchImpl: FetchImpl = fetch) {
    this.config = resolveConfig(options);
    this.state = initialState();
    this.fetchImpl = fetchImpl;
  }

  /** Number of components currently subscribed. Used for lifecycle/debugging. */
  get subscriberCount(): number {
    return this.listeners.size;
  }

  getSnapshot(): OfflineState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    const isFirstSubscriber = this.listeners.size === 0;
    this.listeners.add(listener);

    if (isFirstSubscriber) {
      this.start();
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stop();
      }
    };
  }

  /** Manual, on-demand check. Bypasses the poll schedule and any backoff. */
  retry = async (): Promise<boolean> => {
    return this.runCheck();
  };

  private start(): void {
    if (!isBrowser() || this.destroyed) return;

    window.addEventListener('online', this.onlineHandler);
    window.addEventListener('offline', this.offlineHandler);
    if (this.config.pauseWhenHidden) {
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    // Sync raw browser state immediately in case it changed between
    // module load and first subscription.
    this.patchState({ rawBrowserOnline: getRawBrowserOnline() });

    if (hasActiveVerification(this.config) && this.config.pingInterval > 0) {
      this.scheduleNextPoll(0);
    }
  }

  private stop(): void {
    if (!isBrowser()) return;

    window.removeEventListener('online', this.onlineHandler);
    window.removeEventListener('offline', this.offlineHandler);
    document.removeEventListener('visibilitychange', this.visibilityHandler);

    if (this.pollTimeoutId !== null) {
      clearTimeout(this.pollTimeoutId);
      this.pollTimeoutId = null;
    }
    // Note: an in-flight fetch's AbortController lives inside
    // performPing()'s own timeout; we don't hold a reference to abort
    // it early here, but its timeout ceiling means it can't dangle
    // beyond `config.timeout` ms, and its resolution is a no-op once
    // there are no listeners (setState still runs, harmlessly, since
    // this is a module-level object, not a React component).
  }

  /** Fully tears down the store, e.g. in tests. Not used in normal app lifecycle. */
  destroy(): void {
    this.stop();
    this.listeners.clear();
    this.destroyed = true;
  }

  private handleBrowserOnlineEvent(): void {
    this.patchState({ rawBrowserOnline: true });
    if (this.config.verifyOnBrowserOnlineEvent && hasActiveVerification(this.config)) {
      this.scheduleNextPoll(0);
    } else if (!hasActiveVerification(this.config)) {
      // No active verification configured — trust the browser signal directly.
      this.transitionTo(true);
    }
  }

  private handleBrowserOfflineEvent(): void {
    this.patchState({ rawBrowserOnline: false });
    if (!hasActiveVerification(this.config)) {
      // No active verification configured — trust the browser signal directly.
      this.transitionTo(false);
    }
    // With active verification configured, we deliberately do NOT
    // immediately flip isOnline to false here — we let the next ping
    // (scheduled below) confirm it, consistent with failureThreshold
    // debouncing. But we do check sooner rather than waiting a full
    // interval, since the browser telling us "offline" is a strong hint.
    if (hasActiveVerification(this.config)) {
      this.scheduleNextPoll(0);
    }
  }

  private handleVisibilityChange(): void {
    if (!this.config.pauseWhenHidden) return;
    if (!isDocumentHidden()) {
      // Became visible again — re-check immediately rather than
      // waiting for a possibly-paused poll to resume naturally.
      if (hasActiveVerification(this.config)) {
        this.scheduleNextPoll(0);
      }
    }
  }

  private scheduleNextPoll(delayMs: number): void {
    if (!isBrowser() || this.destroyed) return;
    if (this.pollTimeoutId !== null) {
      clearTimeout(this.pollTimeoutId);
    }

    this.pollTimeoutId = setTimeout(() => {
      if (this.config.pauseWhenHidden && isDocumentHidden()) {
        // Skip this tick; visibilitychange handler will re-trigger
        // a check as soon as the tab becomes visible again.
        return;
      }
      void this.runCheck();
    }, delayMs);
  }

  private async runCheck(): Promise<boolean> {
    if (!hasActiveVerification(this.config)) {
      // Nothing to actively verify against; state already tracks
      // rawBrowserOnline directly via the event handlers.
      return this.state.rawBrowserOnline;
    }

    // Coalesce concurrent calls (e.g. retry() called while a scheduled
    // poll is already in flight) into a single underlying ping.
    if (this.inFlight) {
      return this.inFlight;
    }

    this.patchState({ isChecking: true });

    this.inFlight = performPing(this.config, this.fetchImpl).finally(() => {
      this.inFlight = null;
    });

    const success = await this.inFlight;
    const now = Date.now();

    // These two counters are independent running streaks, updated on
    // every result regardless of current isOnline state, so threshold
    // comparisons are correct even while a transition hasn't fired yet
    // (e.g. tracking successes while still marked offline, working
    // toward successThreshold).
    const consecutiveFailures = success ? 0 : this.state.consecutiveFailures + 1;
    this.consecutiveSuccessesInternal = success ? this.consecutiveSuccessesInternal + 1 : 0;

    this.patchState({
      isChecking: false,
      lastCheckedAt: now,
      consecutiveFailures,
    });

    if (success && this.consecutiveSuccessesInternal >= this.config.successThreshold) {
      this.transitionTo(true);
    } else if (!success && consecutiveFailures >= this.config.failureThreshold) {
      this.transitionTo(false);
    }

    // Schedule the next tick: normal jittered interval if online,
    // faster exponential backoff if currently offline (so recovery is
    // detected quickly without hammering the endpoint).
    if (!this.destroyed && this.listeners.size > 0 && this.config.pingInterval > 0) {
      const nextDelay = this.state.isOnline
        ? applyJitter(this.config.pingInterval)
        : computeBackoffDelay(consecutiveFailures, 2000, this.config.pingInterval);
      this.scheduleNextPoll(nextDelay);
    }

    return success;
  }

  // Tracks consecutive successful pings, independent of the exposed
  // `consecutiveFailures` state field. Not reset here — it's
  // maintained entirely in runCheck() so it advances on every result,
  // even before a transition actually fires.
  private consecutiveSuccessesInternal = 0;

  private transitionTo(isOnline: boolean): void {
    if (this.state.isOnline === isOnline) {
      return;
    }

    const now = Date.now();

    this.patchState({
      isOnline,
      lastOnlineAt: isOnline ? now : this.state.lastOnlineAt,
      lastOfflineAt: !isOnline ? now : this.state.lastOfflineAt,
    });
  }

  private patchState(patch: Partial<OfflineState>): void {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
