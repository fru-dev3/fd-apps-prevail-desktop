// Entity chat: the same chat as everywhere else, scoped to one person, place,
// company or thing, in the entity's detail pane (never a pop-up). Threads are
// ordinary General threads tagged `entity: <id>`; every turn goes through the
// engine with --entity so the model knows what the conversation is about.
// The header carries the way back to the overview, a new conversation, and a
// picker of this entity's past conversations (engine `entities threads`).
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { ChatPanel } from "./chatpanel";
import { useDetectedClis, useFrameworkLens } from "./hooks";
import { useIsPhone } from "./useisphone";
import { loadEntityThreads, resolveThreadPath, type EntityThread } from "./entitythreads";

const NO_DOMAINS: never[] = [];
const NO_SET = new Set<string>();

export function EntityChat({ vaultPath, entity, initial, onBack }: {
  vaultPath: string;
  entity: { id: string; name: string };
  // Open this conversation (a slug from `entities threads`); undefined picks
  // the most recent one, null starts a new one.
  initial?: string | null;
  onBack: () => void;
}) {
  const phone = useIsPhone();
  const clis = useDetectedClis();
  const fwLens = useFrameworkLens();
  const [threads, setThreads] = useState<EntityThread[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(async () => {
    const list = await loadEntityThreads(vaultPath, entity.id);
    setThreads(list);
    return list;
  }, [vaultPath, entity.id]);

  const open = useCallback(async (t: EntityThread | null) => {
    setSlug(t?.slug ?? null);
    setPath(t ? await resolveThreadPath(vaultPath, t) : null);
    setNonce((n) => n + 1);
  }, [vaultPath]);

  // Continue the most recent conversation by default, or the one asked for.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const list = await refresh();
      if (!alive) return;
      const pick = initial === null ? null : initial ? list.find((t) => t.slug === initial) ?? null : list[0] ?? null;
      await open(pick);
      if (alive) setReady(true);
    })();
    return () => { alive = false; };
  }, [refresh, open, initial]);

  const onThreadsChanged = useCallback(() => {
    void refresh();
    window.dispatchEvent(new Event("prevail:threads-changed"));
  }, [refresh]);

  const current = slug ?? (path ? path.split("/").pop()?.replace(/\.md$/, "") ?? null : null);

  return (
    <div data-testid="entity-chat" className={`flex min-h-0 flex-col ${phone ? "h-[calc(100dvh-10rem)]" : "h-[calc(100vh-12rem)]"}`}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle pb-3">
        <button onClick={onBack} className="inline-flex h-9 items-center gap-1.5 rounded-md px-1.5 text-[14px] font-medium text-accent hover:bg-surface-warm">
          <ArrowLeft className="h-4 w-4" />Back to overview
        </button>
        <h2 className="font-display text-[26px] font-semibold leading-tight tracking-tight text-text-primary min-w-0 flex-1 truncate">{entity.name}</h2>
        {threads.length > 0 && (
          <select aria-label="Past conversations" data-testid="entity-thread-picker" value={current ?? ""}
            onChange={(e) => { const t = threads.find((x) => x.slug === e.target.value) ?? null; void open(t); }}
            className="h-9 max-w-[14rem] truncate rounded-lg border border-border bg-background px-2 text-[13px] text-text-secondary focus:border-accent-border focus:outline-none">
            {!current && <option value="">New conversation</option>}
            {current && !threads.some((t) => t.slug === current) && <option value={current}>This conversation</option>}
            {threads.map((t) => <option key={t.slug} value={t.slug}>{t.title || "Untitled"}</option>)}
          </select>
        )}
        <button onClick={() => void open(null)} title="New conversation" aria-label="New conversation" data-testid="entity-chat-new"
          className="flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent">
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {ready && (
          <ChatPanel
            domain={null}
            domainPath={null}
            threadDomain={null}
            vaultPath={vaultPath}
            clis={clis}
            fwLens={fwLens}
            onSwitchToCouncil={() => {}}
            activeThreadPath={path}
            chatViewNonce={nonce}
            onActiveThreadChange={(p) => { setPath(p); if (!p) setSlug(null); }}
            onThreadsChanged={onThreadsChanged}
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
            entity={entity}
          />
        )}
      </div>
    </div>
  );
}
