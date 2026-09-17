import { useMemo, useRef, useEffect, useCallback } from 'react';
import { useSyncExternalStore } from 'react';
import { OfflineStore } from './createOfflineStore';
import type { OfflineStatus, UseOfflineOptions } from './types';
import { isBrowser } from './utils/isBrowser';

/**
 * Registry of active stores, keyed by a stable serialization of the
 * config that produced them. This is what makes multiple useOffline()
 * calls with equivalent config share one underlying store — one
 * interval, one in-flight ping — instead of each hook instance running
 * its own independent polling loop.
 *
 * Ref-counted implicitly via OfflineStore's own subscriber count:
 * when a store's last subscriber unsubscribes, the store stops its
 * timers/listeners but the registry entry is lazily evicted on the
 * next lookup that finds subscriberCount === 0, rather than being torn
 * down synchronously — cheap to keep around for fast re-subscription
 * (e.g. React StrictMode's mount/unmount/mount, or route changes).
 */
const storeRegistry = new Map<string, OfflineStore>();

function configKey(options: UseOfflineOptions): string {
  // pingFn can't be serialized meaningfully; if provided, give it its
  // own store per unique function identity so behavior stays correct
  // (functionally-equivalent-but-distinct pingFns won't be shared,
  // which is the safe default — sharing based on a guess would be
  // surprising).
  if (options.pingFn) {
    return `pingFn:${getFnId(options.pingFn)}`;
  }

  return JSON.stringify({
    pingUrl: options.pingUrl ?? null,
    pingMethod: options.pingMethod ?? null,
    pingCredentials: options.pingCredentials ?? null,
    pingInterval: options.pingInterval ?? null,
    timeout: options.timeout ?? null,
    failureThreshold: options.failureThreshold ?? null,
    successThreshold: options.successThreshold ?? null,
    verifyOnBrowserOnlineEvent: options.verifyOnBrowserOnlineEvent ?? null,
    pauseWhenHidden: options.pauseWhenHidden ?? null,
  });
}

const fnIds = new WeakMap<object, number>();
let fnIdCounter = 0;
function getFnId(fn: object): number {
  let id = fnIds.get(fn);
  if (id === undefined) {
    id = fnIdCounter++;
    fnIds.set(fn, id);
  }
  return id;
}

function getOrCreateStore(options: UseOfflineOptions): OfflineStore {
  const key = configKey(options);
  const existing = storeRegistry.get(key);
  if (existing) return existing;

  const created = new OfflineStore(options);
  storeRegistry.set(key, created);
  return created;
}

const SERVER_SNAPSHOT: Omit<OfflineStatus, 'retry'> = {
  isOnline: true,
  isChecking: false,
  rawBrowserOnline: true,
  lastCheckedAt: null,
  lastOnlineAt: null,
  lastOfflineAt: null,
  consecutiveFailures: 0,
};

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
export function useOffline(options: UseOfflineOptions = {}): OfflineStatus {
  const store = useMemo(() => getOrCreateStore(options), [configKeyStable(options)]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(onStoreChange),
    [store],
  );
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);
  const getServerSnapshot = useCallback(() => SERVER_SNAPSHOT, []);

  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const onStatusChangeRef = useRef(options.onStatusChange);
  onStatusChangeRef.current = options.onStatusChange;

  const prevOnlineRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!isBrowser()) return;
    if (prevOnlineRef.current !== null && prevOnlineRef.current !== state.isOnline) {
      onStatusChangeRef.current?.({ ...state, retry: store.retry });
    }
    prevOnlineRef.current = state.isOnline;
  }, [state, store]);

  return useMemo(
    () => ({
      ...state,
      retry: store.retry,
    }),
    [state, store],
  );
}

// Small helper so useMemo's dependency array gets a stable primitive
// key rather than recomputing configKey twice per render.
function configKeyStable(options: UseOfflineOptions): string {
  return configKey(options);
}
