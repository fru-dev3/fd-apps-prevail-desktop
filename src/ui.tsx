// Pure, self-contained UI primitives extracted from App.tsx. None close over
// App state - they're prop-driven leaf components, safe to live on their own.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Brain, Check, ChevronRight, MoreHorizontal } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// One secondary-actions menu for list rows. A row gets ONE visible primary
// action; everything else lives here, so a list of nine rows never shows 36
// equal-weight buttons. Opens a fixed-position popover (so a scrolling list
// never clips it) through a portal on document.body, so an animated or
// scrolling ancestor can neither offset nor clip it. Closes on outside click
// or Escape.
export type RowMenuItem =
  | { kind?: "item"; icon?: LucideIcon; label: string; hint?: string; onClick: () => void; checked?: boolean; danger?: boolean; disabled?: boolean }
  | { kind: "separator" }
  | { kind: "heading"; label: string };

export function RowMenu({ items, label = "More actions", reveal = false, className = "" }: {
  items: RowMenuItem[];
  label?: string;
  // When true the trigger is hidden until the row (a `group`) is hovered.
  reveal?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const close = useCallback(() => { setOpen(false); setPos(null); }, []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { const t = e.target as Element | null; if (!t?.closest?.("[data-rowmenu]")) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open, close]);
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) { close(); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: Math.round(r.bottom + 4), left: Math.round(Math.max(8, r.right - 232)) });
    setOpen(true);
  };
  return (
    <div data-rowmenu className={`shrink-0 ${className}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-surface-strong hover:text-text-primary ${
          open ? "bg-surface-strong text-text-primary" : reveal ? "text-text-muted opacity-0 focus-visible:opacity-100 group-hover:opacity-100" : "text-text-muted"
        }`}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && pos && createPortal(
        <div data-rowmenu role="menu" onClick={(e) => e.stopPropagation()} style={{ top: pos.top, left: pos.left }}
          className="fixed z-50 w-56 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-xl">
          {items.map((it, i) => {
            if (it.kind === "separator") return <div key={i} className="my-1 border-t border-border-subtle" />;
            if (it.kind === "heading") return <div key={i} className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-text-muted">{it.label}</div>;
            const Icon = it.icon;
            return (
              <button
                key={i}
                role="menuitem"
                disabled={it.disabled}
                onClick={() => { it.onClick(); close(); }}
                className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors disabled:opacity-40 ${
                  it.danger ? "text-err hover:bg-err/10" : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"
                }`}
              >
                {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : <span className="w-3.5 shrink-0" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{it.label}</span>
                  {it.hint && <span className="block truncate text-[11px] text-text-muted">{it.hint}</span>}
                </span>
                {it.checked && <Check className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={3} />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

// Canonical on/off switch. Track 36x20, thumb 16x16. Every switch routes through
// this so the thumb never drifts back into bespoke implementations.
export function Toggle({
  on,
  onChange,
  label,
  disabled = false,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`inline-flex h-5 w-9 shrink-0 items-center overflow-hidden rounded-full border px-0.5 transition-colors disabled:opacity-50 ${
        on
          ? "border-accent bg-accent"
          : "border-border bg-text-muted/25"
      }`}
    >
      <span
        className={`h-4 w-4 rounded-full bg-white shadow-sm ring-1 transition-transform duration-200 ${
          on ? "translate-x-4 ring-black/20" : "translate-x-0 ring-black/25"
        }`}
      />
    </button>
  );
}

// Tiny inline trend line for score history etc. Returns null for <2 points.
export function Sparkline({ values, width = 72, height = 20 }: { values: number[]; width?: number; height?: number }) {
  // A history with a missing or non-numeric entry used to reach the DOM as
  // cy="undefined", which the SVG parser rejects and logs. Drop what cannot be
  // plotted, then decide whether there is still a line to draw.
  const pts2 = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (pts2.length < 2) return null;
  const pts = pts2
    .map((v, i) => `${((i / (pts2.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 2 - (Math.max(0, Math.min(10, v)) / 10) * (height - 4)).toFixed(1)}`)
    .join(" ");
  const up = pts2[pts2.length - 1] >= pts2[0];
  const [lx, ly] = pts.split(" ").pop()!.split(",");
  return (
    <svg width={width} height={height} className="shrink-0" aria-hidden>
      <polyline points={pts} fill="none" strokeWidth="1.5" className={up ? "stroke-ok" : "stroke-warn"} />
      <circle cx={lx} cy={ly} r="2" className={up ? "fill-ok" : "fill-warn"} />
    </svg>
  );
}

// Collapsible "Thinking" block shown above a streamed reply's answer.
export function ThinkingDisclosure({ text, open }: { text: string; open?: boolean }) {
  if (!text) return null;
  return (
    <details open={open} className="group mb-3 rounded-lg border border-border-subtle bg-surface-warm/40">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" />
        <Brain className="h-3.5 w-3.5" />
        Thinking
      </summary>
      <div className="whitespace-pre-wrap border-t border-border-subtle px-3 py-2 text-[13px] leading-relaxed text-text-secondary">
        {text}
      </div>
    </details>
  );
}
