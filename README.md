# use-offline

Accurate, SSR-safe React hook for detecting real network connectivity — not
just `navigator.onLine`.

`navigator.onLine` only reflects whether the OS reports an active network
interface. If you're on Wi-Fi but the router's upstream ISP connection is
down, `navigator.onLine` still reports `true`. This hook adds optional
**active verification** — periodic pings to an endpoint you control — so
`isOnline` reflects whether you can actually reach something, with
debouncing so a single dropped packet doesn't flip your UI.

## Install

```bash
npm install use-offline
```

React 16.8+ is a peer dependency (hooks are required; it is not bundled).

## Quick start

### Zero-config (navigator.onLine only)

```tsx
import { useOffline } from 'use-offline';

function App() {
  const { isOnline } = useOffline();
  return isOnline ? <Main /> : <OfflineBanner />;
}
```

This is fast and free, but inherits `navigator.onLine`'s limitation above.

### Accurate mode (recommended)

Point `pingUrl` at a lightweight endpoint on **your own domain** — see
[Choosing a ping endpoint](#choosing-a-ping-endpoint) below.

```tsx
const { isOnline, isChecking, consecutiveFailures, retry } = useOffline({
  pingUrl: '/api/health',
  pingInterval: 15000,
  failureThreshold: 2,
});
```

### Reacting to transitions

```tsx
useOffline({
  pingUrl: '/api/health',
  onStatusChange: (status) => {
    if (!status.isOnline) toast.error('You are offline');
    else toast.success('Back online');
  },
});
```

## Choosing a ping endpoint

**Use your own backend, not a third-party URL.** A one-line health check is
enough:

```js
// e.g. /api/health, or an edge function (Cloudflare Workers, Vercel Edge)
export default function handler(req, res) {
  res.status(204).end();
}
```

Why not a public endpoint (Google's `generate_204`, Cloudflare's trace URL,
etc.)? Those tell you "the internet exists somewhere," not "my app's
backend is reachable" — which is usually what actually matters. You also
don't control their uptime or rate limits, and sending third-party traffic
from every user's browser at package scale is a footprint you don't own.
If you have no backend to check against, omit `pingUrl` and rely on
`navigator.onLine` alone rather than pinging infrastructure you don't
control.

If you need to verify connectivity via something other than a plain HTTP
request (a WebSocket ping, a GraphQL query), use `pingFn` instead of
`pingUrl` — see [API](#api) below.

## API

### `useOffline(options?): OfflineStatus`

#### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `pingUrl` | `string` | — | Endpoint to ping for active verification. Omit to rely on `navigator.onLine` only. |
| `pingFn` | `() => Promise<boolean>` | — | Custom verification function. Takes precedence over `pingUrl` if both are set. |
| `pingMethod` | `'HEAD' \| 'GET'` | `'HEAD'` | HTTP method for the ping request. |
| `pingCredentials` | `RequestCredentials` | `'omit'` | Credentials mode for the ping request. Defaults to omitting cookies — a health check has no business carrying auth. |
| `pingInterval` | `number` (ms) | `30000` | Poll cadence while online. Jittered by ±20% to avoid synchronized request spikes across clients. Set `0` to disable polling (checks only on browser events / manual `retry()`). |
| `timeout` | `number` (ms) | `5000` | Max time to wait for a ping before treating it as a failure. |
| `failureThreshold` | `number` | `2` | Consecutive failed pings required before `isOnline` flips to `false`. |
| `successThreshold` | `number` | `1` | Consecutive successful pings required before `isOnline` flips back to `true`. Deliberately asymmetric with `failureThreshold` — recovering feels instant, going offline is conservative. |
| `verifyOnBrowserOnlineEvent` | `boolean` | `true` | Re-verify immediately when the browser fires its native `online` event, rather than waiting for the next poll. |
| `pauseWhenHidden` | `boolean` | `true` | Pause polling while the tab is backgrounded (`document.hidden`); re-check immediately on becoming visible. |
| `onStatusChange` | `(status: OfflineStatus) => void` | — | Called when the debounced `isOnline` value changes (not on every ping attempt). |

#### Return value (`OfflineStatus`)

| Field | Type | Description |
|---|---|---|
| `isOnline` | `boolean` | The debounced connectivity verdict — the value to build UI around. |
| `isChecking` | `boolean` | `true` while a ping is in flight. |
| `rawBrowserOnline` | `boolean` | Live `navigator.onLine` value, before debouncing/verification. Exposed for advanced use. |
| `lastCheckedAt` | `number \| null` | Timestamp of the last completed ping (success or failure). |
| `lastOnlineAt` | `number \| null` | Timestamp of the last transition to online. |
| `lastOfflineAt` | `number \| null` | Timestamp of the last transition to offline. |
| `consecutiveFailures` | `number` | Current failure streak (resets to `0` on any success). |
| `retry` | `() => Promise<boolean>` | Manually trigger an immediate check, bypassing the poll schedule. |

## Behavior notes

- **Multiple components, one network call.** Calling `useOffline()` with
  the same options in several components shares a single underlying poll
  loop and a single in-flight ping — you don't get N timers or N requests
  for N components. Sharing is keyed by the *value* of your options
  object, not its identity, so passing a fresh literal on every render
  (`useOffline({ pingUrl: '/api/health' })`) still shares correctly.

  **Exception:** if you use `pingFn`, sharing is keyed by function
  *identity* (it can't be serialized), so an inline `pingFn` defined fresh
  on every render will not share a store across components. Define it
  outside the component (or memoize it) if you need multiple components
  with the same `pingFn` to share one poll loop.

- **SSR-safe.** During server rendering, `useOffline()` returns a static
  `{ isOnline: true, ... }` snapshot without touching `window` or
  `navigator`, and syncs to real state after the client mounts.

- **Detection only, not offline *support*.** This hook tells your UI
  whether the network is reachable. It does not cache responses, serve
  stale data, or queue failed requests for retry — that's the job of a
  Service Worker + Cache API (and Background Sync for queued mutations),
  which is a separate concern with a different risk profile (cache
  invalidation, storage quotas, sync conflicts). Pair this hook with a
  service worker if you need your app to actually *work* offline, not
  just know that it's offline.

## Security notes

- Ping requests default to `credentials: 'omit'` — they never send cookies
  unless you explicitly opt in via `pingCredentials`.
- Every ping is bounded by `timeout` via `AbortController`; a hung request
  can't dangle indefinitely.
- Polling is jittered and backs off exponentially while offline (capped at
  `pingInterval`), so a shared outage across many users doesn't cause a
  synchronized spike of requests against your health endpoint the moment
  connectivity returns.

## License

MIT
