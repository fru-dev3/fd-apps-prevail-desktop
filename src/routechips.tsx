// The small row under a General message that says where it was filed.
//
// Tagged domains show as chips with a tiny remove icon; the row ends with two
// icon actions, undo (back to General) and change (pick domains). A
// below-threshold answer shows one quiet suggestion chip instead. No big
// buttons and no side panels: this is a footnote to the message.

import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Undo2, X } from "lucide-react";
import { titleCase } from "./format";
import { domainIcon } from "./icons";
import type { MessageRoute } from "./types";

export function RouteChips({
  route,
  domains,
  onChange,
}: {
  route: MessageRoute | undefined;
  /** Every routable domain slug, for the change menu. */
  domains: string[];
  /** A user correction: the full new set of tagged domains. */
  onChange: (next: string[]) => void;
}) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);
  if (!route || route.pending) return null;
  const tagged = route.tagged;
  const suggestion = tagged.length === 0 ? route.suggested[0] : undefined;
  if (tagged.length === 0 && !suggestion && !menu) {
    // Nothing to show, but keep a way to file it by hand.
    return (
      <div ref={ref} className="relative mt-1 flex items-center justify-end pr-1 opacity-0 transition-opacity group-hover:opacity-100">
        <IconAction title="File this conversation in a domain" onClick={() => setMenu(true)}><Pencil className="h-3 w-3" /></IconAction>
      </div>
    );
  }
  return (
    <div ref={ref} data-testid="route-chips" className="relative mt-1.5 flex max-w-[78%] flex-wrap items-center justify-end gap-1 pr-1">
      {tagged.map((d) => {
        const Icon = domainIcon(d);
        return (
          <span key={d} className="inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-soft py-0.5 pl-2 pr-1 text-[11px] font-medium text-accent" title={`Filed in ${titleCase(d)}: this conversation also shows there`}>
            {Icon && <Icon className="h-3 w-3" />}
            {titleCase(d)}
            <button type="button" aria-label={`Remove ${titleCase(d)}`} title={`Not about ${titleCase(d)}`} onClick={() => onChange(tagged.filter((x) => x !== d))} className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-accent/70 hover:bg-accent/15 hover:text-accent">
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        );
      })}
      {suggestion && (
        <button
          type="button"
          onClick={() => onChange([suggestion.slug])}
          title={`Looks like ${titleCase(suggestion.slug)} (${Math.round(suggestion.confidence * 100)}%). Click to file it there.`}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-text-muted hover:border-accent-border hover:text-accent"
        >
          {titleCase(suggestion.slug)}?
        </button>
      )}
      {tagged.length > 0 && (
        <IconAction title="Undo: keep this in General" onClick={() => onChange([])}><Undo2 className="h-3 w-3" /></IconAction>
      )}
      <IconAction title="Change domains" onClick={() => setMenu((v) => !v)}><Pencil className="h-3 w-3" /></IconAction>
      {menu && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 max-h-64 w-48 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg">
          {domains.length === 0 && <div className="px-2 py-1.5 text-[12px] text-text-muted">No domains yet</div>}
          {domains.map((d) => {
            const on = tagged.includes(d);
            const Icon = domainIcon(d);
            return (
              <button
                key={d}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => onChange(on ? tagged.filter((x) => x !== d) : [...tagged, d])}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-text-secondary hover:bg-surface-warm"
              >
                {Icon ? <Icon className="h-3.5 w-3.5 text-text-muted" /> : <span className="h-3.5 w-3.5" />}
                <span className="flex-1 truncate">{titleCase(d)}</span>
                {on && <Check className="h-3.5 w-3.5 text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function IconAction({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-text-primary">
      {children}
    </button>
  );
}
