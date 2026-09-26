// Search on the General home: find an earlier conversation or jump to a
// domain without leaving the place most work starts.

import { useEffect, useMemo, useState } from "react";
import { MessageSquare, Search } from "lucide-react";
import { invoke } from "./bridge";
import { titleCase } from "./format";
import { domainIcon } from "./icons";
import type { ThreadMeta } from "./types";

export function GeneralSearch({
  vaultPath,
  domains,
  onPickThread,
  onPickDomain,
  compact = false,
}: {
  vaultPath: string;
  domains: string[];
  onPickThread: (path: string) => void;
  onPickDomain: (name: string) => void;
  compact?: boolean;
}) {
  const [q, setQ] = useState("");
  const [threads, setThreads] = useState<ThreadMeta[] | null>(null);
  // Load lazily on first keystroke: the home stays instant.
  useEffect(() => {
    if (!q.trim() || threads !== null || !vaultPath) return;
    invoke<ThreadMeta[]>("list_threads", { vault: vaultPath, domain: null })
      .then((r) => setThreads(Array.isArray(r) ? r : []))
      .catch(() => setThreads([]));
  }, [q, threads, vaultPath]);
  const needle = q.trim().toLowerCase();
  const hitDomains = useMemo(() => (needle ? domains.filter((d) => d.toLowerCase().includes(needle) || titleCase(d).toLowerCase().includes(needle)).slice(0, 3) : []), [domains, needle]);
  const hitThreads = useMemo(
    () => (needle ? (threads ?? []).filter((t) => t.title.toLowerCase().includes(needle) || t.preview.toLowerCase().includes(needle)).slice(0, 6) : []),
    [threads, needle],
  );
  const open = needle.length > 0;
  return (
    <div className={`relative w-full ${compact ? "mt-4" : "mt-6"} max-w-xl`}>
      <label className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 focus-within:border-accent-border">
        <Search className="h-4 w-4 shrink-0 text-text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }}
          placeholder="Search conversations and domains"
          aria-label="Search conversations and domains"
          className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
        />
      </label>
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          {hitDomains.map((d) => {
            const Icon = domainIcon(d);
            return (
              <button key={`d:${d}`} type="button" onClick={() => onPickDomain(d)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-warm">
                {Icon ? <Icon className="h-4 w-4 text-text-muted" /> : <span className="h-4 w-4" />}
                <span className="truncate">{titleCase(d)}</span>
              </button>
            );
          })}
          {hitThreads.map((t) => (
            <button key={t.path} type="button" onClick={() => onPickThread(t.path)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-warm">
              <MessageSquare className="h-4 w-4 shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-text-primary">{t.title}</span>
                {t.routed && t.routed.length > 0 && <span className="block truncate text-[11px] text-text-muted">{t.routed.map(titleCase).join(", ")}</span>}
              </span>
            </button>
          ))}
          {hitDomains.length === 0 && hitThreads.length === 0 && (
            <div className="px-3 py-2 text-sm text-text-muted">{threads === null ? "Searching" : "No matches"}</div>
          )}
        </div>
      )}
    </div>
  );
}
