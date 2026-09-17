import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

//#region src/ping.ts
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
async function performPing(config, fetchImpl = fetch) {
	if (config.pingFn) try {
		return await config.pingFn();
	} catch {
		return false;
	}
	if (!config.pingUrl) return true;
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), config.timeout);
	try {
		return (await fetchImpl(config.pingUrl, {
			method: config.pingMethod,
			cache: "no-store",
			credentials: config.pingCredentials,
			signal: controller.signal
		})).ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timeoutId);
	}
}

//#endregion
//#region src/utils/jitter.ts
/**
* Applies ±percent jitter to a base interval, to avoid many clients
* polling in lockstep (which would cause a synchronized spike of
* requests against a shared ping endpoint after a shared outage ends).
*
* @param baseMs base interval in ms
* @param percent jitter range as a fraction (0.2 = ±20%)
*/
function applyJitter(baseMs, percent = .2) {
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
function computeBackoffDelay(attempt, baseDelayMs = 2e3, capMs = 3e4) {
	const exponential = baseDelayMs * Math.pow(2, Math.max(1, attempt) - 1);
	return applyJitter(Math.min(exponential, capMs), .2);
}

//#endregion
//#region src/utils/isBrowser.ts
function isBrowser() {
	return typeof window !== "undefined" && typeof navigator !== "undefined";
}
function getRawBrowserOnline() {
	if (!isBrowser()) return true;
	return typeof navigator.onLine === "boolean" ? navigator.onLine : true;
}
/**
* Safe read of document.hidden. Returns `false` (i.e. "visible") when
* not in a browser or when the Page Visibility API is unavailable, so
* pause-when-hidden logic simply never pauses in that case.
*/
function isDocumentHidden() {
	if (typeof document === "undefined") return false;
	return typeof document.hidden === "boolean" ? document.hidden : false;
}

//#endregion
//#region src/createOfflineStore.ts
const DEFAULTS = {
	pingMethod: "HEAD",
	pingCredentials: "omit",
	pingInterval: 3e4,
	timeout: 5e3,
	failureThreshold: 2,
	successThreshold: 1,
	verifyOnBrowserOnlineEvent: true,
	pauseWhenHidden: true
};
function resolveConfig(options) {
	var _options$pingMethod, _options$pingCredenti, _options$pingInterval, _options$timeout, _options$failureThres, _options$successThres, _options$verifyOnBrow, _options$pauseWhenHid;
	return {
		pingUrl: options.pingUrl,
		pingFn: options.pingFn,
		pingMethod: (_options$pingMethod = options.pingMethod) !== null && _options$pingMethod !== void 0 ? _options$pingMethod : DEFAULTS.pingMethod,
		pingCredentials: (_options$pingCredenti = options.pingCredentials) !== null && _options$pingCredenti !== void 0 ? _options$pingCredenti : DEFAULTS.pingCredentials,
		pingInterval: (_options$pingInterval = options.pingInterval) !== null && _options$pingInterval !== void 0 ? _options$pingInterval : DEFAULTS.pingInterval,
		timeout: (_options$timeout = options.timeout) !== null && _options$timeout !== void 0 ? _options$timeout : DEFAULTS.timeout,
		failureThreshold: (_options$failureThres = options.failureThreshold) !== null && _options$failureThres !== void 0 ? _options$failureThres : DEFAULTS.failureThreshold,
		successThreshold: (_options$successThres = options.successThreshold) !== null && _options$successThres !== void 0 ? _options$successThres : DEFAULTS.successThreshold,
		verifyOnBrowserOnlineEvent: (_options$verifyOnBrow = options.verifyOnBrowserOnlineEvent) !== null && _options$verifyOnBrow !== void 0 ? _options$verifyOnBrow : DEFAULTS.verifyOnBrowserOnlineEvent,
		pauseWhenHidden: (_options$pauseWhenHid = options.pauseWhenHidden) !== null && _options$pauseWhenHid !== void 0 ? _options$pauseWhenHid : DEFAULTS.pauseWhenHidden
	};
}
function hasActiveVerification(config) {
	return Boolean(config.pingFn || config.pingUrl);
}
function initialState() {
	const rawBrowserOnline = getRawBrowserOnline();
	return {
		isOnline: rawBrowserOnline,
		isChecking: false,
		rawBrowserOnline,
		lastCheckedAt: null,
		lastOnlineAt: null,
		lastOfflineAt: null,
		consecutiveFailures: 0
	};
}
/**
* A single store instance, scoped to one resolved config. Consumers
* that call useOffline() with the *same* effective config share one of
* these (see getStore below), so there is only ever one interval and
* one in-flight ping per distinct configuration, regardless of how
* many components use the hook.
*/
var OfflineStore = class {
	constructor(options, fetchImpl = fetch) {
		this.listeners = /* @__PURE__ */ new Set();
		this.pollTimeoutId = null;
		this.inFlight = null;
		this.destroyed = false;
		this.onlineHandler = () => this.handleBrowserOnlineEvent();
		this.offlineHandler = () => this.handleBrowserOfflineEvent();
		this.visibilityHandler = () => this.handleVisibilityChange();
		this.retry = async () => {
			return this.runCheck();
		};
		this.consecutiveSuccessesInternal = 0;
		this.config = resolveConfig(options);
		this.state = initialState();
		this.fetchImpl = fetchImpl;
	}
	/** Number of components currently subscribed. Used for lifecycle/debugging. */
	get subscriberCount() {
		return this.listeners.size;
	}
	getSnapshot() {
		return this.state;
	}
	subscribe(listener) {
		const isFirstSubscriber = this.listeners.size === 0;
		this.listeners.add(listener);
		if (isFirstSubscriber) this.start();
		return () => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0) this.stop();
		};
	}
	start() {
		if (!isBrowser() || this.destroyed) return;
		window.addEventListener("online", this.onlineHandler);
		window.addEventListener("offline", this.offlineHandler);
		if (this.config.pauseWhenHidden) document.addEventListener("visibilitychange", this.visibilityHandler);
		this.patchState({ rawBrowserOnline: getRawBrowserOnline() });
		if (hasActiveVerification(this.config) && this.config.pingInterval > 0) this.scheduleNextPoll(0);
	}
	stop() {
		if (!isBrowser()) return;
		window.removeEventListener("online", this.onlineHandler);
		window.removeEventListener("offline", this.offlineHandler);
		document.removeEventListener("visibilitychange", this.visibilityHandler);
		if (this.pollTimeoutId !== null) {
			clearTimeout(this.pollTimeoutId);
			this.pollTimeoutId = null;
		}
	}
	/** Fully tears down the store, e.g. in tests. Not used in normal app lifecycle. */
	destroy() {
		this.stop();
		this.listeners.clear();
		this.destroyed = true;
	}
	handleBrowserOnlineEvent() {
		this.patchState({ rawBrowserOnline: true });
		if (this.config.verifyOnBrowserOnlineEvent && hasActiveVerification(this.config)) this.scheduleNextPoll(0);
		else if (!hasActiveVerification(this.config)) this.transitionTo(true);
	}
	handleBrowserOfflineEvent() {
		this.patchState({ rawBrowserOnline: false });
		if (!hasActiveVerification(this.config)) this.transitionTo(false);
		if (hasActiveVerification(this.config)) this.scheduleNextPoll(0);
	}
	handleVisibilityChange() {
		if (!this.config.pauseWhenHidden) return;
		if (!isDocumentHidden()) {
			if (hasActiveVerification(this.config)) this.scheduleNextPoll(0);
		}
	}
	scheduleNextPoll(delayMs) {
		if (!isBrowser() || this.destroyed) return;
		if (this.pollTimeoutId !== null) clearTimeout(this.pollTimeoutId);
		this.pollTimeoutId = setTimeout(() => {
			if (this.config.pauseWhenHidden && isDocumentHidden()) return;
			this.runCheck();
		}, delayMs);
	}
	async runCheck() {
		if (!hasActiveVerification(this.config)) return this.state.rawBrowserOnline;
		if (this.inFlight) return this.inFlight;
		this.patchState({ isChecking: true });
		this.inFlight = performPing(this.config, this.fetchImpl).finally(() => {
			this.inFlight = null;
		});
		const success = await this.inFlight;
		const now = Date.now();
		const consecutiveFailures = success ? 0 : this.state.consecutiveFailures + 1;
		this.consecutiveSuccessesInternal = success ? this.consecutiveSuccessesInternal + 1 : 0;
		this.patchState({
			isChecking: false,
			lastCheckedAt: now,
			consecutiveFailures
		});
		if (success && this.consecutiveSuccessesInternal >= this.config.successThreshold) this.transitionTo(true);
		else if (!success && consecutiveFailures >= this.config.failureThreshold) this.transitionTo(false);
		if (!this.destroyed && this.listeners.size > 0 && this.config.pingInterval > 0) {
			const nextDelay = this.state.isOnline ? applyJitter(this.config.pingInterval) : computeBackoffDelay(consecutiveFailures, 2e3, this.config.pingInterval);
			this.scheduleNextPoll(nextDelay);
		}
		return success;
	}
	transitionTo(isOnline) {
		if (this.state.isOnline === isOnline) return;
		const now = Date.now();
		this.patchState({
			isOnline,
			lastOnlineAt: isOnline ? now : this.state.lastOnlineAt,
			lastOfflineAt: !isOnline ? now : this.state.lastOfflineAt
		});
	}
	patchState(patch) {
		this.state = {
			...this.state,
			...patch
		};
		this.notify();
	}
	notify() {
		for (const listener of this.listeners) listener();
	}
};

//#endregion
//#region src/useOffline.ts
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
const storeRegistry = /* @__PURE__ */ new Map();
function configKey(options) {
	var _options$pingUrl, _options$pingMethod, _options$pingCredenti, _options$pingInterval, _options$timeout, _options$failureThres, _options$successThres, _options$verifyOnBrow, _options$pauseWhenHid;
	if (options.pingFn) return `pingFn:${getFnId(options.pingFn)}`;
	return JSON.stringify({
		pingUrl: (_options$pingUrl = options.pingUrl) !== null && _options$pingUrl !== void 0 ? _options$pingUrl : null,
		pingMethod: (_options$pingMethod = options.pingMethod) !== null && _options$pingMethod !== void 0 ? _options$pingMethod : null,
		pingCredentials: (_options$pingCredenti = options.pingCredentials) !== null && _options$pingCredenti !== void 0 ? _options$pingCredenti : null,
		pingInterval: (_options$pingInterval = options.pingInterval) !== null && _options$pingInterval !== void 0 ? _options$pingInterval : null,
		timeout: (_options$timeout = options.timeout) !== null && _options$timeout !== void 0 ? _options$timeout : null,
		failureThreshold: (_options$failureThres = options.failureThreshold) !== null && _options$failureThres !== void 0 ? _options$failureThres : null,
		successThreshold: (_options$successThres = options.successThreshold) !== null && _options$successThres !== void 0 ? _options$successThres : null,
		verifyOnBrowserOnlineEvent: (_options$verifyOnBrow = options.verifyOnBrowserOnlineEvent) !== null && _options$verifyOnBrow !== void 0 ? _options$verifyOnBrow : null,
		pauseWhenHidden: (_options$pauseWhenHid = options.pauseWhenHidden) !== null && _options$pauseWhenHid !== void 0 ? _options$pauseWhenHid : null
	});
}
const fnIds = /* @__PURE__ */ new WeakMap();
let fnIdCounter = 0;
function getFnId(fn) {
	let id = fnIds.get(fn);
	if (id === void 0) {
		id = fnIdCounter++;
		fnIds.set(fn, id);
	}
	return id;
}
function getOrCreateStore(options) {
	const key = configKey(options);
	const existing = storeRegistry.get(key);
	if (existing) return existing;
	const created = new OfflineStore(options);
	storeRegistry.set(key, created);
	return created;
}
const SERVER_SNAPSHOT = {
	isOnline: true,
	isChecking: false,
	rawBrowserOnline: true,
	lastCheckedAt: null,
	lastOnlineAt: null,
	lastOfflineAt: null,
	consecutiveFailures: 0
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
function useOffline(options = {}) {
	const store = useMemo(() => getOrCreateStore(options), [configKeyStable(options)]);
	const subscribe = useCallback((onStoreChange) => store.subscribe(onStoreChange), [store]);
	const getSnapshot = useCallback(() => store.getSnapshot(), [store]);
	const getServerSnapshot = useCallback(() => SERVER_SNAPSHOT, []);
	const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
	const onStatusChangeRef = useRef(options.onStatusChange);
	onStatusChangeRef.current = options.onStatusChange;
	const prevOnlineRef = useRef(null);
	useEffect(() => {
		if (!isBrowser()) return;
		if (prevOnlineRef.current !== null && prevOnlineRef.current !== state.isOnline) {
			var _onStatusChangeRef$cu;
			(_onStatusChangeRef$cu = onStatusChangeRef.current) === null || _onStatusChangeRef$cu === void 0 || _onStatusChangeRef$cu.call(onStatusChangeRef, {
				...state,
				retry: store.retry
			});
		}
		prevOnlineRef.current = state.isOnline;
	}, [state, store]);
	return useMemo(() => ({
		...state,
		retry: store.retry
	}), [state, store]);
}
function configKeyStable(options) {
	return configKey(options);
}

//#endregion
export { useOffline };
//# sourceMappingURL=index.js.map