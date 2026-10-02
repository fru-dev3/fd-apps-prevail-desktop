import { useState, type ReactNode } from "react";
import { ArrowLeft, ChevronsLeft, ChevronsRight } from "lucide-react";

// THE secondary column. Every screen that lists things on the left and shows
// the picked one on the right uses this (Intent's Noticed, History and
// Projects; Entities; Apps; Inbox; Recommendations; Runtimes; Arena; chat Threads). One look,
// one behaviour: a w-72 column with a title row whose ChevronsLeft button
// folds it to a thin w-9 strip holding a ChevronsRight button, and the detail
// takes the freed width. The choice is remembered per view under `storageKey`.
// On a phone there is no room for two columns: the list shows first, a pick
// opens the detail with a back button above it.

// Group headers in a scrolling list pin to its top, each pushed up by the
// next (wrap every group, header and rows, in its own element). A pinned
// header shows a hairline under it: call markStuck on the list's scroll.
export const STICKY_GROUP_HEAD = "sticky top-0 z-10 border-b border-transparent data-[stuck]:border-border-subtle";
export function markStuck(scroller: HTMLElement) {
  const top = scroller.getBoundingClientRect().top;
  scroller.querySelectorAll<HTMLElement>("[data-sticky-head]").forEach((h) => {
    const r = h.getBoundingClientRect();
    const group = h.parentElement?.getBoundingClientRect();
    h.toggleAttribute("data-stuck", r.top <= top + 0.5 && !!group && group.top < top - 0.5);
  });
}

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
  // A muted line under the title: the column's count ("335 · 0 saved").
  // Pages put their counts here, never in a band under the page header.
  meta?: ReactNode;
  // Small icon buttons beside the title (a "New" button, say, or Refresh).
  actions?: ReactNode;
  // Pinned under the title, above the scrolling list (a search box, filters).
  toolbar?: ReactNode;
  // Pinned at the bottom of the column.
  footer?: ReactNode;
  children: ReactNode;
};

// The one panel toggle: a small muted double arrow in a 28px hit area (owner, 2026-10-02).
const iconBtn = "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted/70 transition-colors hover:bg-surface-warm hover:text-text-primary";

// The column on its own, for screens whose detail area is laid out by the
// caller (the chat Threads column sits beside the whole chat). Most screens
// want SideSpine below, which adds the detail pane.
export function SpineColumn({ collapsed, onToggle, title, label, testId, meta, actions, toolbar, footer, children }: Omit<ColumnProps, "storageKey"> & { collapsed: boolean; onToggle: () => void }) {
  if (collapsed) {
    return (
      <div data-testid="spine-collapsed" className="flex w-9 shrink-0 flex-col items-center border-r border-border bg-surface/40 py-2">
        <button onClick={onToggle} title={`Show ${label}`} aria-label={`Show ${label}`} className={iconBtn}>
          <ChevronsRight className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }
  return (
    <div data-testid={testId} data-spine-column data-shell="column" className="flex w-72 shrink-0 flex-col border-r border-border bg-surface/40">
      <div className="flex shrink-0 items-center justify-between gap-2 pl-4 pr-2 pt-2">
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-text-secondary">{title}</span>
          {meta && <span data-testid="spine-meta" className="block truncate text-[12px] tabular-nums text-text-muted">{meta}</span>}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          {actions}
          <button onClick={onToggle} title="Collapse" aria-label={`Collapse ${label}`} className={iconBtn}>
            <ChevronsLeft className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {toolbar && <div className="shrink-0 px-2 pb-2 pt-2">{toolbar}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto" onScroll={(e) => markStuck(e.currentTarget)}>{children}</div>
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
            {(col.meta || col.actions) && (
              <div className="flex items-center justify-between gap-2 px-4 pt-3">
                <span data-testid="spine-meta" className="min-w-0 truncate text-[13px] tabular-nums text-text-muted">{col.meta}</span>
                <span className="flex shrink-0 items-center gap-0.5">{col.actions}</span>
              </div>
            )}
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
      <div data-testid="spine-detail" data-shell="detail" data-spine={collapsed ? "collapsed" : "open"} className="min-w-0 flex-1 overflow-y-auto">{detail}</div>
    </div>
  );
}

// The segmented tabs above a SideSpine page (Intent's Noticed / History /
// Projects look): they pick what the column lists.
export function SpineTabs<T extends string>({ tabs, value, onChange, label }: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex w-fit items-center rounded-lg bg-surface-warm p-1 max-sm:w-full">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} data-testid={`tab-${t.id}`}
          className={`inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-[14px] max-sm:flex-1 max-sm:justify-center max-sm:px-2 ${value === t.id ? "bg-background font-semibold text-text-primary shadow-sm" : "text-text-muted hover:text-text-secondary"}`}>
          {t.label}
          {t.count !== undefined && <span className="text-[12px] font-normal tabular-nums text-text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
