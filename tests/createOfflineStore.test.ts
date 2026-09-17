import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OfflineStore } from '../src/createOfflineStore';
import type { FetchImpl } from '../src/ping';

function makeFetchImpl(resultsQueue: boolean[]): FetchImpl {
  let i = 0;
  return vi.fn(() => {
    const ok = resultsQueue[Math.min(i, resultsQueue.length - 1)];
    i++;
    return Promise.resolve({ ok } as Response);
  }) as unknown as FetchImpl;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('OfflineStore — subscriber fan-out', () => {
  it('starts polling only when the first subscriber attaches', async () => {
    const fetchImpl = makeFetchImpl([true]);
    const store = new OfflineStore(
      { pingUrl: '/health', pingInterval: 10000, failureThreshold: 1 },
      fetchImpl,
    );

    expect(store.subscriberCount).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();

    const unsubscribe = store.subscribe(() => {});
    await vi.runOnlyPendingTimersAsync(); // fires the immediate (0ms) initial check

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.destroy();
  });

  it('shares one underlying poll across multiple subscribers (no duplicated network calls)', async () => {
    const fetchImpl = makeFetchImpl([true]);
    const store = new OfflineStore(
      { pingUrl: '/health', pingInterval: 10000, failureThreshold: 1 },
      fetchImpl,
    );

    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const unsubA = store.subscribe(listenerA);
    const unsubB = store.subscribe(listenerB);

    await vi.runOnlyPendingTimersAsync();

    expect(fetchImpl).toHaveBeenCalledTimes(1); // not 2
    expect(listenerA).toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalled();

    unsubA();
    unsubB();
    store.destroy();
  });

  it('stops polling once the last subscriber unsubscribes', async () => {
    const fetchImpl = makeFetchImpl([true]);
    const store = new OfflineStore(
      { pingUrl: '/health', pingInterval: 1000, failureThreshold: 1 },
      fetchImpl,
    );

    const unsubscribe = store.subscribe(() => {});
    await vi.runOnlyPendingTimersAsync();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    unsubscribe();
    await vi.advanceTimersByTimeAsync(5000);
    // No further calls after unsubscribe, even though interval elapsed
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    store.destroy();
  });
});

describe('OfflineStore — threshold debouncing', () => {
  it('does not flip to offline after a single failure below failureThreshold', async () => {
    const fetchImpl = makeFetchImpl([false]);
    const store = new OfflineStore(
      { pingUrl: '/health', pingInterval: 100000, failureThreshold: 2 },
      fetchImpl,
    );

    store.subscribe(() => {});
    await vi.runOnlyPendingTimersAsync();

    expect(store.getSnapshot().isOnline).toBe(true);
    expect(store.getSnapshot().consecutiveFailures).toBe(1);

    store.destroy();
  });

  it('flips to offline once failureThreshold consecutive failures occur', async () => {
    const fetchImpl = makeFetchImpl([false, false]);
    const store = new OfflineStore(
      { pingUrl: '/health', pingInterval: 100000, failureThreshold: 2 },
      fetchImpl,
    );

    store.subscribe(() => {});
    await vi.runOnlyPendingTimersAsync(); // failure 1
    expect(store.getSnapshot().isOnline).toBe(true);

    await store.retry(); // failure 2
    expect(store.getSnapshot().isOnline).toBe(false);
    expect(store.getSnapshot().lastOfflineAt).not.toBeNull();

    store.destroy();
  });

  it('recovers to online after successThreshold consecutive successes', async () => {
    const fetchImpl = makeFetchImpl([false, false, true]);
    const store = new OfflineStore(
      { pingUrl: '/health', pingInterval: 100000, failureThreshold: 2, successThreshold: 1 },
      fetchImpl,
    );

    store.subscribe(() => {});
    await vi.runOnlyPendingTimersAsync();
    await store.retry();
    expect(store.getSnapshot().isOnline).toBe(false);

    await store.retry();
    expect(store.getSnapshot().isOnline).toBe(true);
    expect(store.getSnapshot().lastOnlineAt).not.toBeNull();

    store.destroy();
  });

  it('requires successThreshold > 1 consecutive successes before recovering', async () => {
    const fetchImpl = makeFetchImpl([false, false, true, false, true, true]);
    const store = new OfflineStore(
      { pingUrl: '/health', pingInterval: 100000, failureThreshold: 2, successThreshold: 2 },
      fetchImpl,
    );

    store.subscribe(() => {});
    await vi.runOnlyPendingTimersAsync(); // false -> failures=1
    await store.retry(); // false -> failures=2, offline
    expect(store.getSnapshot().isOnline).toBe(false);

    await store.retry(); // true -> success streak 1, not enough yet
    expect(store.getSnapshot().isOnline).toBe(false);

    await store.retry(); // false -> resets success streak to 0
    await store.retry(); // true -> success streak 1
    await store.retry(); // true -> success streak 2, threshold met
    expect(store.getSnapshot().isOnline).toBe(true);

    store.destroy();
  });
});

describe('OfflineStore — retry()', () => {
  it('coalesces concurrent calls into a single ping', async () => {
    let resolveFetch: (v: { ok: boolean }) => void;
    const fetchImpl = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    ) as unknown as FetchImpl;

    const store = new OfflineStore(
      { pingUrl: '/health', pingInterval: 0, failureThreshold: 1 },
      fetchImpl,
    );
    store.subscribe(() => {});

    const p1 = store.retry();
    const p2 = store.retry();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resolveFetch!({ ok: true });
    await Promise.all([p1, p2]);

    store.destroy();
  });
});

describe('OfflineStore — no active verification configured', () => {
  it('tracks rawBrowserOnline directly without making any ping calls', async () => {
    const fetchImpl = vi.fn() as unknown as FetchImpl;
    const store = new OfflineStore({}, fetchImpl);

    store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(60000);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.getSnapshot().isOnline).toBe(true);

    store.destroy();
  });
});

describe('OfflineStore — cleanup', () => {
  it('does not throw and stops cleanly when destroyed with active subscribers', async () => {
    const fetchImpl = makeFetchImpl([true]);
    const store = new OfflineStore({ pingUrl: '/health', pingInterval: 1000 }, fetchImpl);
    store.subscribe(() => {});
    await vi.runOnlyPendingTimersAsync();

    expect(() => store.destroy()).not.toThrow();
    expect(store.subscriberCount).toBe(0);
  });
});
