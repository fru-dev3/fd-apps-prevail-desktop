// The Compass, the model: build/compass.md holds the user's purpose, ranked
// values, roles, goals (with paths), non-negotiables, negotiables and
// capacity, every line in the user's own words. The engine has the same
// grammar (prevail-cli src/compass.ts); both read and write it.
//
//   ## Values
//   - Peace of mind ~id:v-peace ~rank:2 ~status:proposed
//     words: "Grow foo while preserving peace of mind."
//     enough: calm 4 of 5 most weeks
//     from: build/ideal-state.md
//
// "- " items carry ~key:value tokens (a bare ~local keeps a line off cloud
// models); indented "key: value" lines belong to the item; goals may have
// "path:" lines with deeper fields. Anything else is kept verbatim, and an
// item nobody changed is written back byte for byte.

export type Kind = "value" | "role" | "goal" | "rule" | "negotiable" | "capacity" | "routine" | "other";
export interface Field { key: string; value: string }
export interface CompassPath { id: string; title: string; tokens: Record<string, string>; fields: Field[] }
export interface CompassItem {
  kind: Kind; id: string; title: string; done: boolean | null;
  tokens: Record<string, string>; flags: string[]; fields: Field[]; paths: CompassPath[];
  raw: string[]; dirty?: boolean;
}
export interface Mission { text: string; tokens: Record<string, string>; fields: Field[]; raw: string[]; dirty?: boolean }
type Block = { item: CompassItem } | { raw: string };
export interface CompassSection { heading: string; kind: Kind | "mission"; blocks: Block[]; mission?: Mission }
export interface CompassDoc { head: string[]; sections: CompassSection[] }
export interface LedgerChange { id: string; from: string; to: string; reason: string; evidence?: string[]; by: "user" }

// The life statement is called Purpose (missions-plan.md: "Mission" names the
// time-bound primitive). An older `## Mission` heading reads the same.
const SECTION_KIND: Record<string, Kind | "mission"> = {
  purpose: "mission", mission: "mission", values: "value", roles: "role", goals: "goal",
  "non-negotiables": "rule", rules: "rule", negotiables: "negotiable", capacity: "capacity", routines: "routine",
};
const TOKEN = /\s+~([a-z][a-z0-9_-]*)(?::(\S+))?/g;

function splitTokens(s: string): { title: string; tokens: Record<string, string>; flags: string[] } {
  const tokens: Record<string, string> = {};
  const flags: string[] = [];
  const title = ` ${s}`.replace(TOKEN, (_m, k: string, v?: string) => { if (v === undefined) flags.push(k); else tokens[k] = v; return ""; }).trim();
  return { title, tokens, flags };
}

function parseItem(kind: Kind, lines: string[], n: number): CompassItem {
  const first = lines[0].replace(/^-\s+/, "");
  let done: boolean | null = null;
  let rest = first;
  const box = /^\[( |x|X)\]\s+/.exec(first);
  if (box) { done = box[1] !== " "; rest = first.slice(box[0].length); }
  const { title, tokens, flags } = splitTokens(rest);
  const item: CompassItem = { kind, id: tokens.id ?? `${kind}-${n}`, title, done, tokens, flags, fields: [], paths: [], raw: lines };
  let path: CompassPath | null = null;
  for (const l of lines.slice(1)) {
    const pm = /^ {2,3}path:\s*(.*)$/.exec(l);
    if (pm) {
      const t = splitTokens(pm[1]);
      path = { id: t.tokens.id ?? `${item.id}-p${item.paths.length}`, title: t.title, tokens: t.tokens, fields: [] };
      item.paths.push(path);
      continue;
    }
    const deep = /^ {4,}([a-z][a-z0-9_ -]*):\s*(.*)$/i.exec(l);
    if (deep && path) { path.fields.push({ key: deep[1].trim(), value: deep[2] }); continue; }
    const f = /^\s+([a-z][a-z0-9_ -]*):\s*(.*)$/i.exec(l);
    if (f) { path = null; item.fields.push({ key: f[1].trim(), value: f[2] }); }
  }
  return item;
}

function parseMission(lines: string[]): Mission {
  const m: Mission = { text: "", tokens: {}, fields: [], raw: lines };
  const text: string[] = [];
  for (const l of lines) {
    if (/^\s*~\S/.test(l)) { Object.assign(m.tokens, splitTokens(` ${l.trim()}`).tokens); continue; }
    const f = /^\s{2,}([a-z][a-z0-9_ -]*):\s*(.*)$/i.exec(l);
    if (f) { m.fields.push({ key: f[1].trim(), value: f[2] }); continue; }
    text.push(l);
  }
  m.text = text.join("\n").trim();
  return m;
}

export function parseCompass(body: string): CompassDoc {
  const lines = (body ?? "").replace(/\r\n/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const doc: CompassDoc = { head: [], sections: [] };
  let sec: CompassSection | null = null;
  let buf: string[] = [];
  let n = 0;
  const flushMission = () => { if (sec?.kind === "mission") sec.mission = parseMission(buf); buf = []; };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const h = /^##\s+(.+?)\s*$/.exec(l);
    if (h) {
      flushMission();
      sec = { heading: l, kind: SECTION_KIND[h[1].toLowerCase()] ?? "other", blocks: [] };
      doc.sections.push(sec);
      continue;
    }
    if (!sec) { doc.head.push(l); continue; }
    if (sec.kind === "mission") { buf.push(l); continue; }
    if (sec.kind !== "other" && /^- \S/.test(l)) {
      const item = [l];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) item.push(lines[++i]);
      sec.blocks.push({ item: parseItem(sec.kind as Kind, item, n++) });
      continue;
    }
    sec.blocks.push({ raw: l });
  }
  flushMission();
  return doc;
}

const tokenStr = (t: Record<string, string>, flags: string[] = []) =>
  Object.entries(t).map(([k, v]) => ` ~${k}:${v.replace(/\s+/g, "-")}`).join("") + flags.map((f) => ` ~${f}`).join("");
const clean = (s: string) => s.replace(/\s*—\s*/g, ", ").replace(/\s+–\s+/g, ", ").replace(/\s+/g, " ").trim();

export function renderItem(it: CompassItem): string[] {
  const box = it.kind === "goal" ? `[${it.done ? "x" : " "}] ` : "";
  const out = [`- ${box}${clean(it.title)}${tokenStr({ id: it.id, ...it.tokens }, it.flags)}`];
  for (const f of it.fields) out.push(`  ${f.key}: ${clean(f.value)}`);
  for (const p of it.paths) {
    out.push(`  path: ${clean(p.title)}${tokenStr({ id: p.id, ...p.tokens })}`);
    for (const f of p.fields) out.push(`    ${f.key}: ${clean(f.value)}`);
  }
  return out;
}

export function serializeCompass(doc: CompassDoc): string {
  const out: string[] = [...doc.head];
  for (const s of doc.sections) {
    out.push(s.heading);
    if (s.kind === "mission" && s.mission) {
      if (s.mission.dirty) {
        const m = s.mission;
        out.push("", ...(m.text ? m.text.split("\n") : []));
        if (Object.keys(m.tokens).length) out.push(tokenStr(m.tokens).trim());
        for (const f of m.fields) out.push(`  ${f.key}: ${clean(f.value)}`);
        out.push("");
      } else out.push(...s.mission.raw);
      continue;
    }
    for (const b of s.blocks) {
      if ("raw" in b) out.push(b.raw);
      else out.push(...(b.item.dirty ? renderItem(b.item) : b.item.raw));
    }
  }
  const text = out.join("\n");
  return text.endsWith("\n") ? text : `${text}\n`;
}

export const items = (doc: CompassDoc, kind?: Kind): CompassItem[] =>
  doc.sections.flatMap((s) => s.blocks.flatMap((b) => ("item" in b && (!kind || b.item.kind === kind) ? [b.item] : [])));
export const missionOf = (doc: CompassDoc): Mission | null => doc.sections.find((s) => s.kind === "mission")?.mission ?? null;
export const isProposed = (x: { tokens: Record<string, string> }) => x.tokens.status === "proposed";
export const fieldOf = (x: { fields: Field[] }, k: string): string => (x.fields.find((f) => f.key === k)?.value ?? "").replace(/^"(.*)"$/, "$1");
export const rankOf = (v: CompassItem) => Number(v.tokens.rank ?? 99);
export const proposedCount = (doc: CompassDoc) => items(doc).filter(isProposed).length + (missionOf(doc) && isProposed(missionOf(doc)!) ? 1 : 0);

// WOOP (the engine's rule): a goal goes active only with an outcome, an
// obstacle and an if-then plan, in the user's words; until then it is
// "confirmed". An expectation of 1 or 2 out of 5 makes it a small trial.
const IF_THEN = /\bif\b[\s\S]{2,}?(\bthen\b|,)/i;
export function woopComplete(it: { fields: Field[] }): boolean {
  return !!fieldOf(it, "outcome").trim() && !!fieldOf(it, "obstacle").trim() && IF_THEN.test(fieldOf(it, "plan"));
}
const goalStatusOnConfirm = (it: CompassItem) => (!woopComplete(it) ? "confirmed" : Number(fieldOf(it, "expect") || 5) <= 2 ? "prototyping" : "active");

/** Confirm proposed lines (all, or by id): a goal becomes active once its WOOP is done (else confirmed), others lose the token. Pure. */
export function confirmLines(doc: CompassDoc, ids: string[] | "all", reason = "confirmed"): { doc: CompassDoc; changes: LedgerChange[] } {
  const next = parseCompass(serializeCompass(doc));
  const changes: LedgerChange[] = [];
  const want = (id: string) => ids === "all" || ids.includes(id);
  const m = missionOf(next);
  if (m && isProposed(m) && want("mission")) { delete m.tokens.status; m.dirty = true; changes.push({ id: "mission", from: "proposed", to: "confirmed", reason, by: "user" }); }
  for (const it of items(next)) {
    if (!isProposed(it) || !want(it.id)) continue;
    const to = it.kind === "goal" ? goalStatusOnConfirm(it) : "confirmed";
    if (it.kind === "goal") it.tokens.status = to; else delete it.tokens.status;
    it.dirty = true;
    changes.push({ id: it.id, from: "proposed", to, reason, by: "user" });
  }
  return { doc: next, changes };
}

/** Drop proposed lines by id (a confirmed line is never dropped here). Pure. */
export function dropLines(doc: CompassDoc, ids: string[], reason = "dropped"): { doc: CompassDoc; changes: LedgerChange[] } {
  const next = parseCompass(serializeCompass(doc));
  const changes: LedgerChange[] = [];
  for (const s of next.sections) {
    s.blocks = s.blocks.filter((b) => {
      if (!("item" in b) || !ids.includes(b.item.id) || !isProposed(b.item)) return true;
      const words = fieldOf(b.item, "words");
      changes.push({ id: b.item.id, from: "proposed", to: "dropped", reason, evidence: [b.item.title, ...(words ? [words] : [])], by: "user" });
      return false;
    });
    if (s.kind === "mission" && s.mission && ids.includes("mission") && isProposed(s.mission)) {
      changes.push({ id: "mission", from: "proposed", to: "dropped", reason, evidence: [s.mission.text], by: "user" });
      s.mission = { text: "", tokens: {}, fields: [], raw: [""], dirty: true };
    }
  }
  return { doc: next, changes };
}
