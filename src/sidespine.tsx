import { useState, type ReactNode } from "react";
import { ArrowLeft, PanelLeftClose, PanelLeftOpen } from "lucide-react";

// THE secondary column. Every screen that lists things on the left and shows
// the picked one on the right uses this (Intent's Noticed, History and
// Projects; Entities; Apps; Runtimes; Arena; Notes; chat Threads). One look,
// one behaviour: a w-72 column with a title row whose PanelLeftClose button
// folds it to a thin w-9 strip holding a PanelLeftOpen button, and the detail
// takes the freed width. The choice is remembered per view under `storageKey`.
// On a phone there is no room for two columns: the list shows first, a pick
// opens the detail with a back button above it.
//
// A screen's page header stays in view while the pane scrolls, pinned to the
// pane's top edge.
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

type ColumnProps = {
  storageKey: string;
  // Heading shown at the top of the open column ("Weeks", "Projects").
  title: string;
  // What the column lists ("periods", "projects"): used in the button labels.
  label: string;
  testId?: string;
  // Small icon buttons beside the title (a "New" button, say).
  actions?: ReactNode;
  // Pinned under the title, above the scrolling list (a search box, filters).
  toolbar?: ReactNode;
  // Pinned at the bottom of the column.
  footer?: ReactNode;
  children: ReactNode;
};

const iconBtn = "rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-warm hover:text-accent";

// The column on its own, for screens whose detail area is laid out by the
// caller (the chat Threads column sits beside the whole chat). Most screens
// want SideSpine below, which adds the detail pane.
export function SpineColumn({ collapsed, onToggle, title, label, testId, actions, toolbar, footer, children }: Omit<ColumnProps, "storageKey"> & { collapsed: boolean; onToggle: () => void }) {
  if (collapsed) {
    return (
      <div data-testid="spine-collapsed" className="flex w-9 shrink-0 flex-col items-center border-r border-border bg-surface/40 py-2">
        <button onClick={onToggle} title={`Show ${label}`} aria-label={`Show ${label}`} className={iconBtn}>
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      </div>
    );
  }
  return (
    <div data-testid={testId} data-spine-column className="flex w-72 shrink-0 flex-col border-r border-border bg-surface/40">
      <div className="flex shrink-0 items-center justify-between gap-2 pl-4 pr-2 pt-2">
        <span className="min-w-0 truncate text-[13px] font-semibold text-text-secondary">{title}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          {actions}
          <button onClick={onToggle} title="Collapse" aria-label={`Collapse ${label}`} className={iconBtn}>
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
      </div>
      {toolbar && <div className="shrink-0 px-2 pb-2 pt-2">{toolbar}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer && <div className="shrink-0 border-t border-border-subtle p-2">{footer}</div>}
    </div>
  );
}

export function SideSpine({ storageKey, detail, phone = false, phoneDetail = false, onBack, backLabel, ...col }: ColumnProps & {
  detail: ReactNode;
  // Phone layout: the list (with its toolbar) full width, or, once something
  // is picked (`phoneDetail`), the detail under a back button.
  phone?: boolean;
  phoneDetail?: boolean;
  onBack?: () => void;
  // "All projects": what the back button returns to.
  backLabel?: string;
}) {
  const [collapsed, toggle] = useSpineCollapsed(storageKey);
  if (phone) {
    return (
      <div data-testid="spine-phone" className="flex min-h-0 flex-1 flex-col">
        {phoneDetail ? (
          <div data-testid="spine-detail" data-spine="phone" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            {onBack && (
              <button type="button" onClick={onBack} className="mx-4 mt-3 inline-flex h-10 items-center gap-1.5 rounded-md text-[15px] font-medium text-accent">
                <ArrowLeft className="h-4 w-4" />{backLabel ?? `All ${col.label}`}
              </button>
            )}
            {detail}
          </div>
        ) : (
          <div data-testid={col.testId} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            {col.toolbar && <div className="px-3 pt-3">{col.toolbar}</div>}
            {col.children}
            {col.footer && <div className="border-t border-border-subtle p-3">{col.footer}</div>}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-1">
      <SpineColumn {...col} collapsed={collapsed} onToggle={toggle} />
      <div data-testid="spine-detail" data-spine={collapsed ? "collapsed" : "open"} className="min-w-0 flex-1 overflow-y-auto">{detail}</div>
    </div>
  );
}
