// Long lists render only the rows near the viewport. Drop-in for a list's
// `items.map(render)`: up to VIRTUAL_MIN rows it renders them all exactly as
// before (the same DOM, no wrapper); past that, one @tanstack/react-virtual window over the
// page's own scroll container, with measured row heights.
//
// It virtualizes in place inside the existing scroller, so a group section
// keeps its sticky header (the header stays in normal flow above this block,
// and the block keeps the group's full height).
import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

export const VIRTUAL_MIN = 100;

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === "auto" || o === "scroll") return p;
  }
  return null;
}

export function VirtualRows<T>({ items, render, estimate = 40, getKey, focusIndex, gap = 0, className }: {
  items: T[];
  render: (item: T, index: number) => ReactNode;
  /** A typical row height in px (rows are measured once drawn). */
  estimate?: number;
  getKey?: (item: T, index: number) => string | number;
  /** Scroll this row into the window when it changes (a deep link). */
  focusIndex?: number | null;
  /** Space under each row in the windowed block, standing in for the
   *  parent's space-y-* (which cannot reach positioned rows). */
  gap?: number;
  /** Classes for the windowed block only (small lists render bare rows). */
  className?: string;
}) {
  if (items.length <= VIRTUAL_MIN) {
    return <>{items.map((it, i) => <Fragment key={getKey ? getKey(it, i) : i}>{render(it, i)}</Fragment>)}</>;
  }
  return <Windowed items={items} render={render} estimate={estimate} getKey={getKey} focusIndex={focusIndex} gap={gap} className={className} />;
}

function Windowed<T>({ items, render, estimate, getKey, focusIndex, gap, className }: {
  items: T[]; render: (item: T, index: number) => ReactNode; estimate: number;
  getKey?: (item: T, index: number) => string | number; focusIndex?: number | null; gap: number; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [margin, setMargin] = useState(0);
  // Where this block starts inside the scroller's content, so the window
  // lines up with what is actually on screen.
  useLayoutEffect(() => {
    const s = scrollParent(ref.current);
    setScroller(s);
    if (s && ref.current) setMargin(ref.current.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop);
  });
  const v = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller,
    estimateSize: () => estimate + gap,
    overscan: 8,
    scrollMargin: margin,
    getItemKey: getKey ? (i) => getKey(items[i], i) : undefined,
  });
  useLayoutEffect(() => {
    if (focusIndex != null && focusIndex >= 0) v.scrollToIndex(focusIndex, { align: "center" });
  }, [focusIndex]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = v.getVirtualItems();
  return (
    <div ref={ref} className={className} style={{ height: v.getTotalSize(), position: "relative" }} data-virtual-rows={items.length}>
      {rows.map((r) => (
        <div key={r.key} data-index={r.index} ref={v.measureElement}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${r.start - margin}px)`, paddingBottom: gap || undefined }}>
          {render(items[r.index], r.index)}
        </div>
      ))}
    </div>
  );
}
