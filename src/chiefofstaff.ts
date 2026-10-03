// The chief of staff's name, from build/chief-of-staff.md (the engine owns the
// file: `prevail chief set-name`). General is their home, so when the user has
// named one the General row and the General chat carry that name.
import { invoke } from "./bridge";
import { useEngineQuery } from "./query";

/** The `name:` in the file's frontmatter, or null when there is none. */
export function chiefName(text: string): string | null {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text ?? "");
  const n = fm?.[1]?.match(/^name:\s*(.*)$/m)?.[1]?.trim() ?? "";
  return n && n.length <= 40 ? n : null;
}

export function useChiefOfStaff(vaultPath: string | null | undefined): string | null {
  const q = useEngineQuery<string | null>(vaultPath ? `chief-of-staff:${vaultPath}` : null, async () =>
    chiefName(await invoke<string>("chief_of_staff_read", { vault: vaultPath }).catch(() => "")), { staleMs: 60_000 });
  return q.data ?? null;
}
