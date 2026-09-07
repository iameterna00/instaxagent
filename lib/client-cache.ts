// ============================================================
// A tiny in-memory cache for GET responses the dashboard re-reads every time a
// tab is mounted.
//
// The problem it solves is navigation, not bandwidth. Moving between dashboard
// tabs unmounts the panel and throws its state away, so returning to Content
// Studio replayed every fetch behind a full-panel spinner — including the
// writer's library read, which makes an Instagram round trip. The data had not
// changed; only the component had.
//
// So: serve the last value synchronously on mount (no spinner), then revalidate
// in the background and swap in the fresh copy. A module-level Map is the right
// lifetime for this — it survives client-side navigation and dies on a hard
// reload, which is exactly when a user expects to see fresh everything.
// ============================================================

interface Entry {
  value: unknown
  at: number
}

const store = new Map<string, Entry>()

/** Past this, a cached value is too old to show before its revalidation lands. */
const MAX_AGE_MS = 10 * 60_000

/**
 * The last value for `key`, or undefined if there is none or it has aged out.
 * Safe to call from a `useState` initialiser — it never suspends or throws.
 */
export function cacheRead<T>(key: string, maxAgeMs = MAX_AGE_MS): T | undefined {
  const entry = store.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.at > maxAgeMs) {
    store.delete(key)
    return undefined
  }
  return entry.value as T
}

export function cacheWrite(key: string, value: unknown): void {
  store.set(key, { value, at: Date.now() })
}

/**
 * Drop cached entries so the next mount refetches. Pass a prefix to clear one
 * family of keys — call it after a write (a new script, a deleted plan) so the
 * cache cannot hand back a value the user has already changed.
 */
export function cacheClear(prefix?: string): void {
  if (!prefix) {
    store.clear()
    return
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}
