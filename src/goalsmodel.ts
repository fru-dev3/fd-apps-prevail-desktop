// Goals, the model: a domain's source/goals.md is a plain markdown list, one
// goal per item, with inline fields in the style memory/tasks.md uses:
//
//   - [ ] Run a half marathon ~id:g-3f2a ~status:active ~due:2026-12-31 ~progress:40
//     why: Feel strong again.
//
// `[x]` means done. Anything in the file that is not a goal item (a heading,
// a paragraph) is kept exactly as it was when the list is written back.

export type GoalStatus = "active" | "done" | "archived";
export interface Goal {
  id: string;
  domain: string;
  title: string;
  status: GoalStatus;
  due: string | null;
  progress: number | null;
  why: string;
}
type Block = { goal: Goal } | { raw: string };
export type GoalsDoc = { domain: string; blocks: Block[] };

const ITEM = /^- \[( |x|X)\]\s+(.*)$/;
const FIELD = /\s+~(id|status|due|progress):(\S+)/g;

export function newGoalId(): string {
  return `g-${Math.random().toString(36).slice(2, 8)}`;
}

export function parseGoals(domain: string, body: string): GoalsDoc {
  const blocks: Block[] = [];
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  for (let i = 0; i < lines.length; i++) {
    const m = ITEM.exec(lines[i]);
    if (!m) { blocks.push({ raw: lines[i] }); continue; }
    const f: Record<string, string> = {};
    const title = m[2].replace(FIELD, (_all, k: string, v: string) => { f[k] = v; return ""; }).trim();
    const done = m[1].toLowerCase() === "x";
    const status: GoalStatus = f.status === "archived" ? "archived" : done || f.status === "done" ? "done" : "active";
    const progress = f.progress !== undefined && Number.isFinite(Number(f.progress)) ? Math.max(0, Math.min(100, Math.round(Number(f.progress)))) : null;
    const whyLine = lines[i + 1]?.match(/^\s+why:\s*(.*)$/);
    if (whyLine) i++;
    blocks.push({ goal: {
      id: f.id || `g-${domain}-${i}`, domain, title, status,
      due: f.due && /^\d{4}-\d{2}-\d{2}$/.test(f.due) ? f.due : null,
      progress, why: whyLine ? whyLine[1].trim() : "",
    } });
  }
  return { domain, blocks };
}

// Field values never carry spaces; a title never carries a line break.
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export function goalLine(g: Goal): string {
  let line = `- [${g.status === "done" ? "x" : " "}] ${clean(g.title) || "Untitled goal"} ~id:${g.id} ~status:${g.status}`;
  if (g.due) line += ` ~due:${g.due}`;
  if (g.progress !== null) line += ` ~progress:${g.progress}`;
  if (clean(g.why)) line += `\n  why: ${clean(g.why)}`;
  return line;
}

export function serializeGoals(doc: GoalsDoc): string {
  const out = doc.blocks.map((b) => ("goal" in b ? goalLine(b.goal) : b.raw)).join("\n");
  return out.endsWith("\n") ? out : `${out}\n`;
}

export const goalsOf = (doc: GoalsDoc): Goal[] => doc.blocks.flatMap((b) => ("goal" in b ? [b.goal] : []));

/** Put a goal into its domain's doc: replace it by id, or append it. */
export function upsertGoal(doc: GoalsDoc, g: Goal): GoalsDoc {
  let hit = false;
  const blocks = doc.blocks.map((b) => ("goal" in b && b.goal.id === g.id ? (hit = true, { goal: g }) : b));
  if (!hit) blocks.push({ goal: g });
  return { ...doc, blocks };
}
export function removeGoal(doc: GoalsDoc, id: string): GoalsDoc {
  return { ...doc, blocks: doc.blocks.filter((b) => !("goal" in b && b.goal.id === id)) };
}

/** A section of the constitution by its heading ("Mission", "Vision"). */
export function idealSection(md: string, name: string): string {
  const re = new RegExp(`^#{1,3}\\s+[^\\n]*${name}[^\\n]*$`, "im");
  const m = re.exec(md);
  if (!m) return "";
  const rest = md.slice(m.index + m[0].length);
  const next = /^#{1,3}\s+/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}
/** Replace (or add) that section, leaving the rest of the file alone. */
export function setIdealSection(md: string, name: string, text: string): string {
  const re = new RegExp(`^(#{1,3})\\s+[^\\n]*${name}[^\\n]*$`, "im");
  const m = re.exec(md);
  if (!m) return `${md.trimEnd()}${md.trim() ? "\n\n" : ""}## ${name}\n\n${text.trim()}\n`;
  const start = m.index + m[0].length;
  const rest = md.slice(start);
  const next = /^#{1,3}\s+/m.exec(rest);
  const end = next ? start + next.index : md.length;
  return `${md.slice(0, start)}\n\n${text.trim()}\n${next ? "\n" : ""}${md.slice(end)}`;
}
