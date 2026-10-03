// The two group pages (ia-plan.md): Entities (People, Places, Products,
// Things) and Activities (Events, Projects). One header: the group's name,
// breadcrumbs ("Entities > Products > Foo Bank") and a tab per kind, each
// with its icon. Under it, the kind's own list and detail in the SideSpine
// template: one entity kind per tab, Events with their calendar strip, and
// Projects (the missions page without its own header).
import { useEffect, useState } from "react";
import { CalendarRange, ChevronRight, Shapes } from "lucide-react";
import { SettingsHeader } from "./sectionutil";
import { SpineTabs } from "./sidespine";
import { useIsPhone } from "./useisphone";
import { EntitiesView } from "./entitiesview";
import { EventsView } from "./eventsview";
import { MissionsPage } from "./missionspage";
import { ENTITY_KIND_OF, GROUP_LABEL, IA_KIND_EVENT, kindDef, kindsOf, takeIaKind, type Group, type KindId } from "./ia";

export function GroupPage({ vaultPath, group, initial }: { vaultPath: string; group: Group; initial?: KindId }) {
  const kinds = kindsOf(group);
  // On a phone the shell's header names the page and the list has its own
  // back button: no breadcrumbs, and the kind tabs only on the list.
  const phone = useIsPhone();
  const [kind, setKind] = useState<KindId>(() => takeIaKind(group) ?? initial ?? kinds[0]!.id);
  const [selName, setSelName] = useState<string | null>(null);
  // The breadcrumbs' "back to the list": each view clears its pick on a new n.
  const [clearN, setClearN] = useState(0);
  useEffect(() => {
    const on = (e: Event) => {
      const k = (e as CustomEvent<KindId>).detail;
      if (kindDef(k)?.group === group) { takeIaKind(group); setKind(k); setClearN(0); }
    };
    window.addEventListener(IA_KIND_EVENT, on);
    return () => window.removeEventListener(IA_KIND_EVENT, on);
  }, [group]);
  // Each kind's view mounts fresh and reports what it shows (its effect runs
  // before this page's), so the crumb is never reset here.
  // A new kind mounts fresh (clearN 0); the same kind again goes back to its list.
  const go = (k: KindId) => { if (k === kind) setClearN((n) => n + 1); else { setKind(k); setClearN(0); } };
  useEffect(() => { window.dispatchEvent(new CustomEvent("prevail:ia-shown", { detail: kind })); }, [kind]);

  const def = kindDef(kind);
  const crumb = "inline-flex min-w-0 items-center truncate hover:text-accent";
  const crumbs = (
    <nav aria-label="Breadcrumbs" data-testid="ia-breadcrumbs" className="flex min-w-0 items-center gap-1 text-[14px] text-text-muted">
      <button type="button" className={crumb} onClick={() => go(kinds[0]!.id)}>{GROUP_LABEL[group]}</button>
      <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <button type="button" className={`${crumb} ${selName ? "" : "font-medium text-text-secondary"}`} aria-current={selName ? undefined : "page"} onClick={() => setClearN((n) => n + 1)}>
        <def.icon aria-hidden className="mr-1 h-3.5 w-3.5 shrink-0" />{def.label}
      </button>
      {selName && (
        <>
          <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span aria-current="page" data-testid="ia-crumb-object" className="min-w-0 truncate font-medium text-text-secondary" title={selName}>{selName}</span>
        </>
      )}
    </nav>
  );
  const tabs = (
    <SpineTabs label={GROUP_LABEL[group]} value={kind} onChange={go}
      tabs={kinds.map((k) => ({ id: k.id, label: k.label, icon: k.icon }))} />
  );
  const ek = ENTITY_KIND_OF[kind];
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={`ia-page-${group}`}>
      <SettingsHeader title={GROUP_LABEL[group]} icon={group === "entities" ? Shapes : CalendarRange} subtitle={phone ? undefined : crumbs} tabs={phone && selName ? undefined : tabs} />
      <div className="flex min-h-0 flex-1 flex-col" data-testid={`ia-kind-${kind}`} key={kind}>
        {kind === "projects" ? <MissionsPage vaultPath={vaultPath} bare onSelected={setSelName} clearN={clearN} />
          : kind === "events" ? <EventsView vaultPath={vaultPath} onSelected={setSelName} clearN={clearN} />
          : ek ? <EntitiesView vaultPath={vaultPath} kind={ek} embedded onSelected={setSelName} clearN={clearN} />
          : null}
      </div>
    </div>
  );
}
