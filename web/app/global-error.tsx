"use client";

import { useEffect, useState } from "react";
import { isStaleBuild, reloadOnce } from "@/lib/stale-build";

/** The last resort, when even the site's frame failed: the same as app/error.tsx, without the frame's styles. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const [reloading, setReloading] = useState(isStaleBuild(error));
  useEffect(() => { if (isStaleBuild(error) && !reloadOnce()) setReloading(false); }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#0d1117", color: "#e6e1d6", fontFamily: "system-ui, sans-serif" }}>
        {reloading ? <p>Gamine was just updated. Loading the new version…</p> : (
          <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
            <p style={{ fontSize: 18, marginBottom: 8 }}>Something went wrong</p>
            <p style={{ opacity: 0.7, marginBottom: 20 }}>Gamine hit an error. Reloading usually fixes it.</p>
            <button type="button" onClick={() => window.location.reload()} style={{ padding: "10px 18px", borderRadius: 6, border: 0, background: "#e8b84a", color: "#111", fontWeight: 600, cursor: "pointer" }}>Reload</button>
          </div>
        )}
      </body>
    </html>
  );
}
