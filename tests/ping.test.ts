import { describe, it, expect, vi } from 'vitest';
import { performPing, type FetchImpl } from '../src/ping';

const baseConfig = {
  pingUrl: 'https://example.com/health',
  pingFn: undefined,
  pingMethod: 'HEAD' as const,
  pingCredentials: 'omit' as RequestCredentials,
  timeout: 1000,
};

describe('performPing', () => {
  it('returns true when pingFn resolves true', async () => {
    const pingFn = vi.fn().mockResolvedValue(true);
    const result = await performPing({ ...baseConfig, pingFn, pingUrl: undefined });
    expect(result).toBe(true);
    expect(pingFn).toHaveBeenCalledOnce();
  });

  it('returns false when pingFn rejects, without throwing', async () => {
    const pingFn = vi.fn().mockRejectedValue(new Error('boom'));
    const result = await performPing({ ...baseConfig, pingFn, pingUrl: undefined });
    expect(result).toBe(false);
  });

  it('prefers pingFn over pingUrl when both are set', async () => {
    const pingFn = vi.fn().mockResolvedValue(true);
    const fetchImpl = vi.fn() as unknown as FetchImpl;
    const result = await performPing({ ...baseConfig, pingFn }, fetchImpl);
    expect(result).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns true (fail-safe) when neither pingFn nor pingUrl is set', async () => {
    const result = await performPing({ ...baseConfig, pingFn: undefined, pingUrl: undefined });
    expect(result).toBe(true);
  });

  it('returns true when the fetch response is ok', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true }) as unknown as FetchImpl;
    const result = await performPing(baseConfig, fetchImpl);
    expect(result).toBe(true);
  });

  it('returns false when the fetch response is not ok', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false }) as unknown as FetchImpl;
    const result = await performPing(baseConfig, fetchImpl);
    expect(result).toBe(false);
  });

  it('returns false when fetch throws (network error)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as FetchImpl;
    const result = await performPing(baseConfig, fetchImpl);
    expect(result).toBe(false);
  });

  it('aborts and returns false when the request exceeds the timeout', async () => {
    const fetchImpl: FetchImpl = vi.fn((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit).signal;
        signal?.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as unknown as FetchImpl;

    const result = await performPing({ ...baseConfig, timeout: 10 }, fetchImpl);
    expect(result).toBe(false);
  });

  it('passes credentials: omit by default to fetch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true }) as unknown as FetchImpl;
    await performPing(baseConfig, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      baseConfig.pingUrl,
      expect.objectContaining({ credentials: 'omit', cache: 'no-store', method: 'HEAD' }),
    );
  });

  it('respects a non-default pingCredentials value when explicitly set', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true }) as unknown as FetchImpl;
    await performPing({ ...baseConfig, pingCredentials: 'include' }, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      baseConfig.pingUrl,
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
