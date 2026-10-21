"use client";

import { useEffect, useState } from "react";
import { isStaleBuild, reloadOnce } from "@/lib/stale-build";

/**
 * A page that failed in the browser. Most often the site was updated while this tab was open and the
 * page needs code only the new version has: that reloads straight into it. Anything else says so,
 * with a way to try again.
 */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [reloading, setReloading] = useState(isStaleBuild(error));
  useEffect(() => { if (isStaleBuild(error) && !reloadOnce()) setReloading(false); }, [error]);
  if (reloading) return <p className="p-6 text-[13px] text-muted">Gamine was just updated. Loading the new version…</p>;
  return (
    <section className="m-4 max-w-md rounded-panel border border-line bg-panel p-5 text-[13px]">
      <h2 className="text-accent uppercase tracking-wider">Something went wrong</h2>
      <p className="mt-2 text-muted">This page hit an error. Trying again usually fixes it.</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={() => reset()} className="rounded-panel bg-accent px-4 py-2 font-medium text-ink">Try again</button>
        <button type="button" onClick={() => window.location.reload()} className="rounded-panel border border-line bg-panel-2 px-4 py-2 text-text hover:border-accent">Reload the page</button>
      </div>
    </section>
  );
}
