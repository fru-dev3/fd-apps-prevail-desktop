// Where a conversation is filed, shown once at the top of the conversation.
//
// "Filed in <Home>" and "Also in <A>, <B>". Tiny actions: remove a secondary
// domain, change the home (a domain picker), add a domain. An unfiled
// conversation shows "Unfiled" with its candidate chips; one click files it.
// The picker drops down under the chip it came from: no side panels.

import { useEffect, useRef, useState } from "react";
import { ChevronDown, FolderInput, Inbox, Plus, X } from "lucide-react";
import { titleCase } from "./format";
import { domainIcon } from "./icons";
import type { Filing } from "./routing";

const chip = "inline-flex items-center gap-1 rounded-full border py-0.5 text-[11px]";

export function DomainMenu({ domains, exclude = [], label, onPick, onClose }: {
  domains: string[];
  exclude?: string[];
  label: string;
  onPick: (d: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [onClose]);
  const list = domains.filter((d) => !exclude.includes(d));
  return (
    <div ref={ref} role="menu" aria-label={label} className="absolute left-0 top-full z-20 mt-1 max-h-64 w-48 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg">
      {list.length === 0 && <div className="px-2 py-1.5 text-[12px] text-text-muted">No other domains</div>}
      {list.map((d) => {
        const Icon = domainIcon(d);
        return (
          <button key={d} type="button" role="menuitem" onClick={() => { onPick(d); onClose(); }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-text-secondary hover:bg-surface-warm">
            {Icon ? <Icon className="h-3.5 w-3.5 text-text-muted" /> : <span className="h-3.5 w-3.5" />}
            <span className="flex-1 truncate">{titleCase(d)}</span>
          </button>
        );
      })}
    </div>
  );
}

function DomainChip({ d, strong }: { d: string; strong?: boolean }) {
  const Icon = domainIcon(d);
  return (
    <>
      {Icon && <Icon className="h-3 w-3" />}
      <span className={strong ? "font-medium" : ""}>{titleCase(d)}</span>
    </>
  );
}

export function FilingChips({ filing, domains, onChange }: {
  filing: Filing | null;
  /** Every domain a conversation can be filed in. */
  domains: string[];
  /** A user correction: the full new filing. */
  onChange: (next: Filing) => void;
}) {
  const [menu, setMenu] = useState<"home" | "add" | null>(null);
  if (!filing) return null;
  const close = () => setMenu(null);
  if (!filing.home) {
    return (
      <div data-testid="filing-chips" className="relative flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-text-secondary"><Inbox className="h-3 w-3" />Unfiled</span>
        {(filing.candidates ?? []).map((c) => (
          <button key={c.slug} type="button" data-testid="filing-candidate" onClick={() => onChange({ home: c.slug, also: [] })}
            title={`File it in ${titleCase(c.slug)}`}
            className={`${chip} border-dashed border-border px-2 text-text-muted hover:border-accent-border hover:text-accent`}>
            <DomainChip d={c.slug} />
          </button>
        ))}
        <span className="relative">
          <button type="button" aria-label="File in a domain" title="File in a domain" onClick={() => setMenu("home")}
            className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-text-primary"><Plus className="h-3 w-3" /></button>
          {menu === "home" && <DomainMenu label="File in" domains={domains} onPick={(d) => onChange({ home: d, also: [] })} onClose={close} />}
        </span>
      </div>
    );
  }
  const home = filing.home;
  return (
    <div data-testid="filing-chips" className="relative flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[11px] text-text-muted"><FolderInput className="h-3 w-3" />Filed in</span>
      <span className="relative">
        <button type="button" data-testid="filing-home" onClick={() => setMenu(menu === "home" ? null : "home")} title="Change the home domain"
          className={`${chip} border-accent-border bg-accent-soft pl-2 pr-1 text-accent hover:bg-accent/15`}>
          <DomainChip d={home} strong /><ChevronDown className="h-3 w-3" />
        </button>
        {menu === "home" && (
          <DomainMenu label="Change home" domains={domains} exclude={[home]} onClose={close}
            onPick={(d) => onChange({ home: d, also: filing.also.filter((x) => x !== d) })} />
        )}
      </span>
      {filing.also.length > 0 && <span className="text-[11px] text-text-muted">Also in</span>}
      {filing.also.map((d) => (
        <span key={d} className={`${chip} border-border pl-2 pr-1 text-text-secondary`}>
          <DomainChip d={d} />
          <button type="button" aria-label={`Remove ${titleCase(d)}`} title={`Not about ${titleCase(d)}`}
            onClick={() => onChange({ home, also: filing.also.filter((x) => x !== d) })}
            className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-text-muted hover:bg-surface-warm hover:text-text-primary">
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      <span className="relative">
        <button type="button" aria-label="Add a domain" title="Also file it in another domain" onClick={() => setMenu(menu === "add" ? null : "add")}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-text-primary"><Plus className="h-3 w-3" /></button>
        {menu === "add" && (
          <DomainMenu label="Also file in" domains={domains} exclude={[home, ...filing.also]} onClose={close}
            onPick={(d) => onChange({ home, also: [...filing.also, d] })} />
        )}
      </span>
    </div>
  );
}
