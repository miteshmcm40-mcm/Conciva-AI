// Stale-while-revalidate cache helpers — session-scoped (per browser tab,
// cleared when the tab closes) and keyed by user id so cached data never
// leaks across accounts or outlives the tab.
//
// Used by page components whose mount-time fetch (useEffect(() => {
// api(...).then(setX) }, [])) would otherwise reset state to null/[] on
// every reload — that reset-to-nothing is what actually reads as "slow":
// the page blanks to zeros/skeletons for however long the network
// round-trip takes, on every single visit, independent of real backend
// speed. Hydrating synchronously from the last successful load shows real
// data immediately; the existing fetch effect still always runs and
// silently overwrites the cache with fresh data once it lands.
//
// Usage:
//   const [data, setData] = useState(() => readCache('overview', currentUser?.id));
//   ...
//   useEffect(() => {
//     api('/api/whatever').then((r) => {
//       setData(r);
//       writeCache('overview', currentUser?.id, r);
//     });
//   }, []);
export function readCache(key, userId) {
  if (!userId) return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(`kallus.swr.${key}`) || 'null');
    return parsed && parsed.userId === userId ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeCache(key, userId, data) {
  if (!userId) return;
  try {
    sessionStorage.setItem(`kallus.swr.${key}`, JSON.stringify({ userId, data }));
  } catch { /* storage full / private-mode — just skip caching */ }
}

// Every page that independently caches the current customer's own numbers
// list (GET /api/numbers) — each keeps its own copy/shape (a bare array, a
// {numbers, totals} wrapper, bundled with recordings, etc.), so there's no
// single shared cache entry to just overwrite. Call invalidateNumbersCaches
// right after any mutation that changes a number's data (PATCH/POST/DELETE
// on /api/numbers[/:id]) so every OTHER page refetches fresh next time it's
// opened instead of showing what it had cached before the edit. This file's
// own page should still update its own state/cache directly as usual — this
// only clears everyone else's.
const NUMBERS_CACHE_KEYS = [
  'agentDetail.numbers', 'agentsList.numbers', 'billing.numbers', 'calls.numbers',
  'kbAgent.numbers', 'knowledgeBase.numbers', 'numbers.list', 'overview.numbers',
  'playground.numbers', 'pricing.numbers', 'recordings.numbers',
];
// Tools.jsx and Reports.jsx predate this shared utility and use their own
// sessionStorage keys directly rather than the kallus.swr.* prefix.
const LEGACY_NUMBERS_CACHE_KEYS = ['kallus.tools.numbers.cache.v1', 'kallus.reports.cache.v1'];

export function invalidateNumbersCaches() {
  try {
    NUMBERS_CACHE_KEYS.forEach((key) => sessionStorage.removeItem(`kallus.swr.${key}`));
    LEGACY_NUMBERS_CACHE_KEYS.forEach((key) => sessionStorage.removeItem(key));
  } catch { /* private-mode — nothing to clear anyway */ }
}
