// The shared graph.css is designed for a full-window web page: it redefines the
// same CSS token names the desktop uses, ships generic classes (.btn/.search-bar/
// .empty-state) and uses `position: fixed`. Imported globally that leaked into
// every desktop page (broke Marketplace) and overlapped the sidebar. We instead
// import a build-time SCOPED copy (all selectors under `.graphview-scope`,
// fixed→absolute) and render the view inside that scope container.
import "../styles/graph-view-scoped.css";

import { useEffect, useState } from "react";
import { MyGraphView, type GraphApi } from "@kentzu213/graph-view";
import * as bridge from "../lib/aibase-api";
import { LiveProfilePanel } from "../components/LiveProfilePanel";
import { MyGraphWorkspaceV2 } from "../components/v2/MyGraphWorkspaceV2";
import { createOpenWebGuard, openMyGraphWebSafely } from "../lib/open-my-graph-web";

/**
 * Desktop "Knowledge Universe" page — a thin host around the shared
 * `@kentzu213/graph-view` component. The ~2300-line component that used to live
 * here is now published from izzi-web and consumed as a single source of truth;
 * this wrapper only injects the platform seams:
 *
 *  - `api`      → the Electron bridge adapter (renderer/lib/aibase-api), which
 *                 routes every call through `window.electronAPI.graph` so the JWT
 *                 stays in the main process. It structurally satisfies GraphApi.
 *  - `navigate` → the web used next/router to cross-link other AIBase pages; on
 *                 desktop those live on izziapi.com, so internal links open the
 *                 canonical web page in the user's default browser.
 *  - `detached` → the web's URL-param focus mode has no analogue on desktop, so
 *                 the view always renders in its normal in-app mode.
 */

// The bridge module's exported functions match the GraphApi surface 1:1.
const api = bridge as unknown as GraphApi;

const IZZI_WEB = "https://izziapi.com";

function navigate(path: string): void {
  const url = path.startsWith("http")
    ? path
    : `${IZZI_WEB}${path.startsWith("/") ? "" : "/"}${path}`;
  void (
    window as unknown as {
      electronAPI?: { shell?: { openExternal?: (u: string) => void } };
    }
  ).electronAPI?.shell?.openExternal?.(url);
}

const OPEN_WEB_ERROR =
  "Không mở được trình duyệt. Hãy thử lại hoặc mở izziapi.com/aibase/my-graph.";

export default function MyGraphPage({ v2 = false }: { v2?: boolean } = {}) {
  const [openWebError, setOpenWebError] = useState<string | undefined>();
  const [openWebGuard] = useState(createOpenWebGuard);

  useEffect(() => {
    openWebGuard.setMounted(true);
    return () => openWebGuard.setMounted(false);
  }, [openWebGuard]);

  // Reuses the existing `graph:openMyGraphWeb` IPC; the web URL stays in main.
  // The helper logs a failure and resolves false, so there is no floating rejection (ledger #23).
  // Only the latest click on a mounted page may update the error.
  async function openMyGraphWeb(): Promise<void> {
    const isCurrent = openWebGuard.begin();
    const ok = await openMyGraphWebSafely(window.electronAPI?.graph?.openMyGraphWeb);
    if (isCurrent()) setOpenWebError(ok ? undefined : OPEN_WEB_ERROR);
  }

  if (v2) {
    return (
      <MyGraphWorkspaceV2
        graph={<MyGraphView api={api} navigate={navigate} detached={false} />}
        aside={<LiveProfilePanel />}
        onOpenWeb={() => void openMyGraphWeb()}
        openWebError={openWebError}
      />
    );
  }

  // `.graphview-scope` both (a) confines the scoped graph.css to this subtree and
  // (b) is the positioning context: formerly-`fixed` toolbars/panels are now
  // `absolute`, so they anchor to this box (inside <main>) instead of the viewport
  // and no longer overlap the sidebar.
  // The Live.md panel sits OUTSIDE `.graphview-scope` on purpose: that scoped
  // stylesheet redefines the desktop's token names, and the panel should not
  // change appearance because of where it is mounted.
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      <div
        className="graphview-scope"
        style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}
      >
        <MyGraphView api={api} navigate={navigate} detached={false} />
      </div>
      <LiveProfilePanel />
    </div>
  );
}
