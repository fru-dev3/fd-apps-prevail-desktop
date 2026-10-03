// The Compass, the model: build/compass.md holds the user's purpose, ranked
// values, mission statement, vision, objectives, goals (with initiatives),
// roles, non-negotiables, negotiables and capacity, every line in the user's
// own words. Each level of the chain links to the one above (goals-plan.md
// "The Compass chain"); the engine builds the tree (`compass tree`). The engine has the same
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
// "initiative:" lines ("path:" before ~schema:2, still read) with deeper fields. Anything else is kept verbatim, and an
// item nobody changed is written back byte for byte.

export type Kind = "value" | "statement" | "vision" | "objective" | "role" | "goal" | "rule" | "negotiable" | "capacity" | "routine" | "other";
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
// time-bound primitive; the Compass level is shown as "Mission statement").
// In a file without ~schema:2 an older `## Mission` heading reads as Purpose;
// in a schema 2 file it is the mission statement (the engine migrates once).
const SECTION_KIND: Record<string, Kind | "mission"> = {
  purpose: "mission", "core belief": "mission", values: "value", "mission statement": "statement", vision: "vision",
  objectives: "objective", "strategic objectives": "objective", roles: "role", goals: "goal",
  "non-negotiables": "rule", rules: "rule", negotiables: "negotiable", capacity: "capacity", routines: "routine",
};
export const schemaOf = (head: string[]): number => { for (const l of head) { const m = /~schema:(\d+)/.exec(l); if (m) return Number(m[1]); } return 1; };
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
    const pm = /^ {2,3}(?:initiative|path):\s*(.*)$/.exec(l);
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
      const name = h[1].toLowerCase();
      sec = { heading: l, kind: name === "mission" ? (schemaOf(doc.head) >= 2 ? "statement" : "mission") : SECTION_KIND[name] ?? "other", blocks: [] };
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
    out.push(`  initiative: ${clean(p.title)}${tokenStr({ id: p.id, ...p.tokens })}`);
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

// ── Editing lines (Compass round 1, 2026-10-02) ─────────────────────────────
// Every line can be added, edited, archived (roles) or deleted from the page.
// Each change is one ledger line with what it was and what it became, so a
// line's history and the page's History list read the same ledger.

export type LineKind = Exclude<Kind, "other" | "capacity">;
const PREFIX: Record<LineKind, string> = { value: "v", statement: "st", vision: "vi", objective: "o", role: "r", goal: "g", rule: "nn", negotiable: "ng", routine: "rt" };
const HEADING: Record<LineKind | "mission", string> = {
  mission: "Purpose", value: "Values", statement: "Mission statement", vision: "Vision", objective: "Objectives",
  goal: "Goals", role: "Roles", rule: "Non-negotiables", negotiable: "Negotiables", routine: "Routines",
};
const ORDER: (LineKind | "mission")[] = ["mission", "value", "statement", "vision", "objective", "goal", "role", "rule", "negotiable", "routine"];
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "line";
export const isArchived = (x: { tokens: Record<string, string> }) => x.tokens.status === "archived";

function sectionFor(doc: CompassDoc, kind: LineKind | "mission"): CompassSection {
  let s = doc.sections.find((x) => x.kind === kind);
  if (s) return s;
  s = { heading: `## ${HEADING[kind]}`, kind, blocks: kind === "mission" ? [] : [{ raw: "" }] };
  if (kind === "mission") s.mission = { text: "", tokens: {}, fields: [], raw: [""], dirty: true };
  const at = doc.sections.findIndex((x) => x.kind !== "other" && ORDER.indexOf(x.kind as LineKind) > ORDER.indexOf(kind));
  if (at < 0) doc.sections.push(s); else doc.sections.splice(at, 0, s);
  return s;
}

/** Add one line in the user's words, theirs at once (never proposed), dated. Pure. */
export function addLine(doc: CompassDoc, kind: LineKind, title: string, now = Date.now()): { doc: CompassDoc; changes: LedgerChange[]; id: string } {
  const t = title.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!t) return { doc, changes: [], id: "" };
  const next = parseCompass(serializeCompass(doc));
  const have = new Set(items(next).map((i) => i.id));
  let id = `${PREFIX[kind]}-${slug(t)}`;
  for (let n = 2; have.has(id); n++) id = `${PREFIX[kind]}-${slug(t)}-${n}`;
  const tokens: Record<string, string> = { added: ymd(now) };
  if (kind === "value") tokens.rank = String(items(next, "value").filter((v) => !isArchived(v)).length + 1);
  if (kind === "goal") tokens.status = "confirmed";
  const it: CompassItem = { kind, id, title: t, done: kind === "goal" ? false : null, tokens, flags: [], fields: [], paths: [], raw: [], dirty: true };
  const s = sectionFor(next, kind);
  let last = -1;
  s.blocks.forEach((b, i) => { if ("item" in b) last = i; });
  if (last >= 0) s.blocks.splice(last + 1, 0, { item: it });
  else {
    if (!s.blocks.length || !("raw" in s.blocks[0]) || s.blocks[0].raw !== "") s.blocks.unshift({ raw: "" });
    s.blocks.splice(1, 0, { item: it });
    if (!s.blocks[2] || !("raw" in s.blocks[2]) || s.blocks[2].raw !== "") s.blocks.splice(2, 0, { raw: "" });
  }
  return { doc: next, changes: [{ id, from: "", to: t, reason: "added", by: "user" }], id };
}

/** Change a line's words (the purpose too, as id "mission"). Pure. */
export function editLine(doc: CompassDoc, id: string, title: string): { doc: CompassDoc; changes: LedgerChange[] } {
  const t = title.replace(/\r\n/g, "\n").trim().slice(0, id === "mission" ? 2000 : 200);
  const next = parseCompass(serializeCompass(doc));
  if (id === "mission") {
    const m = missionOf(next) ?? sectionFor(next, "mission").mission!;
    const before = m.text;
    if (!t || t === before) return { doc, changes: [] };
    m.text = t; m.dirty = true;
    return { doc: next, changes: [{ id, from: before, to: t, reason: before ? "edited" : "added", by: "user" }] };
  }
  const it = items(next).find((i) => i.id === id);
  const one = t.replace(/\s+/g, " ");
  if (!it || !one || one === it.title) return { doc, changes: [] };
  const before = it.title;
  it.title = one; it.dirty = true;
  // A drafted line the user rewrites is theirs: it stops being proposed.
  const changes: LedgerChange[] = [{ id, from: before, to: one, reason: "edited", by: "user" }];
  if (isProposed(it)) { if (it.kind === "goal") it.tokens.status = "confirmed"; else delete it.tokens.status; changes.push({ id, from: "proposed", to: "confirmed", reason: "edited", by: "user" }); }
  return { doc: next, changes };
}

/** Archive (or bring back) a line: it stays in the file, out of the chain and every chat. Pure. */
export function archiveLine(doc: CompassDoc, id: string, on = true): { doc: CompassDoc; changes: LedgerChange[] } {
  const next = parseCompass(serializeCompass(doc));
  const it = items(next).find((i) => i.id === id);
  if (!it || isArchived(it) === on) return { doc, changes: [] };
  const from = it.tokens.status ?? "confirmed";
  if (on) it.tokens.status = "archived"; else if (it.kind === "goal") it.tokens.status = "confirmed"; else delete it.tokens.status;
  it.dirty = true;
  return { doc: next, changes: [{ id, from: on ? from : "archived", to: on ? "archived" : it.tokens.status ?? "confirmed", reason: on ? "archived" : "restored", by: "user" }] };
}

/** Delete a line (any state). The file before is kept as a version and the ledger keeps its words. Pure. */
export function deleteLine(doc: CompassDoc, id: string): { doc: CompassDoc; changes: LedgerChange[] } {
  const next = parseCompass(serializeCompass(doc));
  const changes: LedgerChange[] = [];
  for (const s of next.sections) {
    s.blocks = s.blocks.filter((b) => {
      if (!("item" in b) || b.item.id !== id) return true;
      changes.push({ id, from: b.item.title, to: "", reason: "deleted", evidence: b.item.raw, by: "user" });
      return false;
    });
  }
  return changes.length ? { doc: next, changes } : { doc, changes: [] };
}

/** One ledger line in words: what happened, before and after. */
export interface LedgerRow { ts: number; id: string; from: string; to: string; reason: string; by?: string }
export function changeText(l: LedgerRow): { what: string; before: string; after: string } {
  const r = l.reason;
  if (r === "added") return { what: "Added", before: "", after: l.to };
  if (r === "edited" && l.from !== "proposed") return { what: "Edited", before: l.from, after: l.to };
  if (r === "deleted") return { what: "Deleted", before: l.from, after: "" };
  if (r === "archived" || l.to === "archived") return { what: "Archived", before: "", after: "" };
  if (r === "restored") return { what: "Brought back", before: "", after: "" };
  if (l.to === "dropped") return { what: "Dropped", before: "", after: "" };
  if (l.from === "proposed") return { what: "Confirmed", before: "", after: "" };
  return { what: titleWord(r || "Changed"), before: l.from, after: l.to };
}
const titleWord = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
