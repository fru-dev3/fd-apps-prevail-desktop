// A conversation inside a page (owner feedback round 1, 2026-10-02): a
// decision's chat, a specialist's own chat. The same ChatPanel as everywhere,
// in General, remembering the last conversation for this page (by key) and
// starting a new one on "+". A specialist's chat starts with it as a member,
// so every message goes to it; a decision's chat opens with the decision in
// the composer.
import { useState } from "react";
import { Plus } from "lucide-react";
import { ChatPanel } from "./chatpanel";
import { useDetectedClis, useFrameworkLens } from "./hooks";
import { useIsPhone } from "./useisphone";

const NO_DOMAINS: never[] = [];
const NO_SET = new Set<string>();
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* storage off */ } };

export function EmbeddedChat({ vaultPath, storageKey, defaultMembers, initialInput, label, testId = "embedded-chat" }: {
  vaultPath: string; storageKey: string; defaultMembers?: string[]; initialInput?: string; label: string; testId?: string;
}) {
  const phone = useIsPhone();
  const clis = useDetectedClis();
  const fwLens = useFrameworkLens();
  const [path, setPath] = useState<string | null>(() => read(storageKey));
  const [nonce, setNonce] = useState(0);
  const fresh = () => { write(storageKey, null); setPath(null); setNonce((n) => n + 1); };
  return (
    <div data-testid={testId} className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 pb-1">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text-secondary">{label}</span>
        <button type="button" onClick={fresh} title="New conversation" aria-label="New conversation" data-testid={`${testId}-new`}
          className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-accent">
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-subtle">
        <ChatPanel
          key={storageKey}
          domain={null}
          domainPath={null}
          threadDomain={null}
          vaultPath={vaultPath}
          clis={clis}
          fwLens={fwLens}
          onSwitchToCouncil={() => {}}
          activeThreadPath={path}
          chatViewNonce={nonce}
          onActiveThreadChange={(p) => { setPath(p); write(storageKey, p); }}
          onThreadsChanged={() => window.dispatchEvent(new Event("prevail:threads-changed"))}
          onStreamStart={() => {}}
          onStreamEnd={() => {}}
          domains={NO_DOMAINS}
          domainStats={{}}
          runningDomains={NO_SET}
          finishedDomains={NO_SET}
          onPickDomain={() => {}}
          domainTab="chat"
          setDomainTab={() => {}}
          active={false}
          phone={phone}
          defaultMembers={defaultMembers}
          initialInput={initialInput}
        />
      </div>
    </div>
  );
}
