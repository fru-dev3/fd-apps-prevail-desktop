// Entity chat: the same chat as everywhere else, scoped to one person, place,
// company or thing, as the Chat tab of the entity's detail (never a pop-up).
// Threads are ordinary General threads tagged `entity: <id>`; every turn goes
// through the engine with --entity so the model knows what it is about.
// The detail owns the tab bar, so it owns the conversation picker and "+":
// it hands down `request` (which conversation to open) and the thread list.
// The panel paints at once on a new conversation; the asked-for thread swaps
// in when its file is found, so the tab never waits on the engine.
import { useEffect, useRef, useState } from "react";
import { ChatPanel } from "./chatpanel";
import { useDetectedClis, useFrameworkLens } from "./hooks";
import { useIsPhone } from "./useisphone";
import { resolveThreadPath, type EntityThread } from "./entitythreads";

const NO_DOMAINS: never[] = [];
const NO_SET = new Set<string>();

// `thread`: a slug from `entities threads`; undefined continues the most
// recent one, null starts a new one. `n` changes on every ask.
export type EntityChatRequest = { thread?: string | null; n: number };

export function EntityChat({ vaultPath, entity, threads, request, onCurrent, onThreadsChanged }: {
  vaultPath: string;
  entity: { id: string; name: string };
  threads: EntityThread[] | null;
  request: EntityChatRequest;
  onCurrent: (slug: string | null) => void;
  onThreadsChanged: () => void;
}) {
  const phone = useIsPhone();
  const clis = useDetectedClis();
  const fwLens = useFrameworkLens();
  const [path, setPath] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  // Set once the owner sends in this panel, so a late lookup never yanks the
  // conversation out from under them.
  const touched = useRef(false);
  const handled = useRef<number | null>(null);

  useEffect(() => {
    // "Most recent" needs the list; wait for it without blocking the paint.
    if (request.thread === undefined && threads === null) return;
    if (handled.current === request.n) return;
    handled.current = request.n;
    touched.current = false;
    const t = request.thread === null ? null
      : request.thread ? threads?.find((x) => x.slug === request.thread) ?? { slug: request.thread, title: "", updated: 0, turns: 0 }
      : threads?.[0] ?? null;
    if (!t) { setPath(null); onCurrent(null); setNonce((k) => k + 1); return; }
    onCurrent(t.slug);
    let alive = true;
    void resolveThreadPath(vaultPath, t).then((p) => {
      if (!alive || touched.current || handled.current !== request.n) return;
      setPath(p);
      setNonce((k) => k + 1);
    });
    return () => { alive = false; };
    // onCurrent is a setter from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, threads, vaultPath]);

  return (
    <div data-testid="entity-chat" className="flex min-h-0 flex-1 flex-col">
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
        onActiveThreadChange={(p) => {
          touched.current = true;
          setPath(p);
          onCurrent(p ? p.split("/").pop()?.replace(/\.md$/, "") ?? null : null);
        }}
        onThreadsChanged={() => { onThreadsChanged(); window.dispatchEvent(new Event("prevail:threads-changed")); }}
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
    </div>
  );
}
