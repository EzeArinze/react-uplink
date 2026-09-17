import type { ResolvedOfflineConfig } from './types';

/**
 * Injectable fetch type, defaulting to the global fetch. Exists so tests
 * (and advanced consumers) can supply a mock implementation without
 * monkey-patching globalThis.fetch.
 */
export type FetchImpl = typeof fetch;

/**
 * Performs a single connectivity check and resolves to true/false.
 * Never throws — any error (network failure, timeout, abort, DNS
 * failure, CORS rejection) resolves to `false`, since from the
 * caller's perspective those are all "could not verify connectivity".
 *
 * Precedence: if `config.pingFn` is set, it is used and `pingUrl` is
 * ignored. If neither is set, this resolves to `true` unconditionally
 * — callers without a configured ping source should rely on
 * navigator.onLine alone, not on this function.
 */
export async function performPing(
  config: Pick<ResolvedOfflineConfig, 'pingUrl' | 'pingFn' | 'pingMethod' | 'pingCredentials' | 'timeout'>,
  fetchImpl: FetchImpl = fetch,
): Promise<boolean> {
  if (config.pingFn) {
    try {
      return await config.pingFn();
    } catch {
      return false;
    }
  }

  if (!config.pingUrl) {
    // No active verification source configured — nothing to check.
    // The store should not be calling performPing in this case, but
    // fail safe (assume reachable) rather than reporting false offline.
    return true;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout);

  try {
    const response = await fetchImpl(config.pingUrl, {
      method: config.pingMethod,
      cache: 'no-store',
      credentials: config.pingCredentials,
      signal: controller.signal,
      // 'no-cors' would make the response opaque (status always 0),
      // which is fine for round-trip-only checks, but since pingUrl is
      // expected to be same-origin (the recommended pattern), default
      // request mode ('cors') lets us actually read response.ok.
    });
    return response.ok;
  } catch {
    // Covers: timeout (abort), DNS failure, connection refused,
    // CORS rejection, and any other network-level error. fetch()
    // deliberately doesn't distinguish these via error type, so we
    // treat them all as "not reachable".
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}
