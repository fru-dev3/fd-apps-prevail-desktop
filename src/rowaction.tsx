import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Check, Loader2, type LucideIcon } from "lucide-react";

// Row-level actions, app wide: small icon-only buttons (28px) floated to the
// row's top-right so the row's text keeps the full width and flows around
// them. The full label is the tooltip and the accessible name. After a
// successful click the icon turns into a check for 1.5s (or stays a check
// while `done` is set, for one-shot actions like "Added"). Page-level primary
// actions keep their text buttons; this is only for the many rows of a list.
export const ROW_ACTION_CONFIRM_MS = 1500;

export function RowAction({ icon: Icon, label, doneLabel, onClick, done = false, disabled = false, testId }: {
  icon: LucideIcon;
  label: string;
  // Tooltip while confirming ("Copied"). Defaults to "Done".
  doneLabel?: string;
  onClick: () => void | Promise<unknown>;
  // Stays in the done state (the action can only happen once).
  done?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "err">("idle");
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const settle = (s: "done" | "err") => {
    setState(s);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), s === "done" ? ROW_ACTION_CONFIRM_MS : 2400);
  };
  const run = async () => {
    if (state === "busy") return;
    try {
      const r = onClick();
      if (r && typeof (r as Promise<unknown>).then === "function") { setState("busy"); await r; }
      settle("done");
    } catch { settle("err"); }
  };
  const shown = done ? "done" : state;
  const tip = shown === "done" ? (doneLabel ?? "Done") : shown === "err" ? `Could not ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); void run(); }} disabled={disabled || done || state === "busy"}
      title={tip} aria-label={label} data-testid={testId} data-state={shown}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-default ${
        shown === "done" ? "text-ok" : shown === "err" ? "text-err" : "text-text-muted hover:bg-surface-warm hover:text-accent disabled:opacity-50"
      }`}>
      {shown === "busy" ? <Loader2 className="h-4 w-4 animate-spin" />
        : shown === "done" ? <Check className="h-4 w-4" />
        : shown === "err" ? <AlertCircle className="h-4 w-4" />
        : <Icon className="h-4 w-4" />}
    </button>
  );
}

// The holder: floated top-right, first child of a block-level row (give the
// row `flow-root` so the float stays inside it). Text after it wraps around.
export function RowActions({ children }: { children: ReactNode }) {
  return <div data-row-actions className="float-right -mr-1 -mt-0.5 mb-1 ml-3 flex items-center gap-0.5">{children}</div>;
}
