// One Settings page that gathers several sections, laid out like Models: the
// page header first, then the canonical SideSpine listing the sections (in
// groups, each with a short status where one is known) and the picked one in
// the detail pane. A section's own SettingsHeader becomes the pane's heading
// (HeaderSlot "detail"), so the sections themselves did not have to change.
// On a phone the list comes first and a tap opens the section.
import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { HeaderSlot, SettingsHeader } from "./sectionutil";
import { SideSpine } from "./sidespine";
import { useIsPhone } from "./useisphone";

export type HubItem = { id: string; label: string; icon: LucideIcon; status?: string; render: () => ReactNode };
export type HubGroup = { heading?: string; items: HubItem[] };

export function SettingsHub({ id, title, icon, subtitle, right, groups, sel, onSelect }: {
  id: string;
  title: string;
  icon: LucideIcon;
  subtitle: string;
  right?: ReactNode;
  groups: HubGroup[];
  sel: string | null;
  onSelect: (item: string) => void;
}) {
  const phone = useIsPhone();
  const [picked, setPicked] = useState(false);
  const items = groups.flatMap((g) => g.items);
  const current = items.find((i) => i.id === sel) ?? items[0];
  const choose = (item: string) => { onSelect(item); setPicked(true); };

  const list = (
    <nav className="space-y-3 p-2" aria-label={title}>
      {groups.map((g, gi) => (
        <div key={g.heading ?? gi} data-hub-group={g.heading} className="space-y-0.5">
          {g.heading && <div className="px-2.5 pb-1 pt-2 text-[15px] font-semibold text-text-primary">{g.heading}</div>}
          {g.items.map((it) => {
            const on = it.id === current?.id && (!phone || picked);
            const Icon = it.icon;
            return (
              <button key={it.id} data-testid={`hub-row-${it.id}`} aria-current={on ? "true" : undefined} onClick={() => choose(it.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg border-l-2 px-2.5 py-2 text-left transition-colors ${on ? "border-l-accent bg-accent-soft ring-1 ring-accent-border" : "border-l-transparent hover:bg-surface-warm"}`}>
                <Icon className={`h-4 w-4 shrink-0 ${on ? "text-accent" : "text-text-muted"}`} />
                <span className={`min-w-0 flex-1 truncate text-sm ${on ? "font-semibold text-accent" : "text-text-primary"}`}>{it.label}</span>
                {it.status && <span className="shrink-0 text-[12px] text-text-muted">{it.status}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <>
      <SettingsHeader title={title} icon={icon} subtitle={subtitle} right={right} />
      <SideSpine storageKey={`prevail.hub.${id}.spine`} title={title} label="sections" testId={`hub-${id}`}
        phone={phone} phoneDetail={phone && picked} onBack={() => setPicked(false)} backLabel={`All of ${title}`}
        detail={
          <div key={current?.id} data-testid={`hub-detail-${current?.id ?? ""}`} className={phone ? "px-4 py-4" : "w-full px-8 py-6"}>
            <HeaderSlot.Provider value="detail">{current?.render()}</HeaderSlot.Provider>
          </div>
        }>
        {list}
      </SideSpine>
    </>
  );
}
