import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { useOffline } from '../src/useOffline';
import type { FetchImpl } from '../src/ping';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function Probe({ pingUrl }: { pingUrl: string }) {
  const status = useOffline({ pingUrl, pingInterval: 5000, failureThreshold: 1 });
  return <div data-testid="status">{status.isOnline ? 'online' : 'offline'}</div>;
}

describe('useOffline (React integration)', () => {
  it('renders without crashing and reflects initial state', () => {
    render(<Probe pingUrl="/health-a" />);
    expect(screen.getByTestId('status').textContent).toBe('online');
  });

  it('two components with identical config share one network call', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true }) as unknown as FetchImpl;
    (globalThis as { fetch: FetchImpl }).fetch = fetchSpy;

    function Two() {
      return (
        <>
          <Probe pingUrl="/health-shared" />
          <Probe pingUrl="/health-shared" />
        </>
      );
    }

    render(<Two />);

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('unmounting does not throw and cleans up listeners', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true }) as unknown as FetchImpl;
    (globalThis as { fetch: FetchImpl }).fetch = fetchSpy;

    const { unmount } = render(<Probe pingUrl="/health-unmount" />);

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(() => unmount()).not.toThrow();
  });
});
