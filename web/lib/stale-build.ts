/**
 * Whether an error is a code file of an earlier build failing to load: a tab opened before a deploy
 * asking the new server for a file only the old build had (scripts/keep-static.mjs keeps most of
 * them). Reloading loads the new build, so the error pages reload once instead of showing an error.
 */
export function isStaleBuild(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null;
  return !!e && (e.name === "ChunkLoadError" || /Loading chunk|Failed to load chunk|Importing a module script failed|error loading dynamically imported module|Failed to fetch dynamically imported module/i.test(e.message ?? ""));
}

const KEY = "gamine:stale-build-reload";

/** Reloads into the new build, at most once a minute, so a real failure can never become a reload loop. */
export function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* No storage: still reload, once per page load. */ }
  window.location.reload();
  return true;
}
