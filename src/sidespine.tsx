import { useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

// A collapsible left spine for list/detail screens (Intent: Noticed, History,
// Projects). Same behaviour as the old Retrospect spine: a PanelLeftClose
// button in the spine's header folds it to a thin strip holding a
// PanelLeftOpen button, and the detail pane takes the freed width. The state
// is remembered per view under `storageKey`.
// A screen's page header stays in view while the settings pane scrolls,
// pinned to the pane's top edge.
export const STICKY_HEAD = "sticky top-0 z-20 bg-background";

export function useSpineCollapsed(storageKey: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(storageKey) === "1"; } catch { return false; }
  });
  const toggle = () => setCollapsed((v) => {
    const n = !v;
    try { localStorage.setItem(storageKey, n ? "1" : "0"); } catch { /* storage unavailable */ }
    return n;
  });
  return [collapsed, toggle];
}

export function SideSpine({ storageKey, title, label, testId, children, detail }: {
  storageKey: string;
  // Heading shown at the top of the open spine ("Weeks", "Projects").
  title: string;
  // What the spine lists ("periods", "projects"): used in the button labels.
  label: string;
  testId?: string;
  children: ReactNode;
  detail: ReactNode;
}) {
  const [collapsed, toggle] = useSpineCollapsed(storageKey);
  return (
    <div className="flex h-full min-h-0 flex-1">
      {collapsed ? (
        <div data-testid="spine-collapsed" className="flex w-9 shrink-0 flex-col items-center border-r border-border bg-surface/40 py-2">
          <button onClick={toggle} title={`Show ${label}`} aria-label={`Show ${label}`}
            className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-warm hover:text-accent">
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div data-testid={testId} className="flex w-72 shrink-0 flex-col border-r border-border bg-surface/40">
          <div className="flex shrink-0 items-center justify-between gap-2 pl-4 pr-2 pt-2">
            <span className="text-[13px] font-semibold text-text-secondary">{title}</span>
            <button onClick={toggle} title="Collapse" aria-label={`Collapse ${label}`}
              className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-warm hover:text-accent">
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      )}
      <div data-testid="spine-detail" data-spine={collapsed ? "collapsed" : "open"} className="min-w-0 flex-1 overflow-y-auto">{detail}</div>
    </div>
  );
}
