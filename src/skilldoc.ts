// A SKILL.md split for display: the YAML frontmatter as flat key/value
// properties, and the markdown body with HTML comments (vault-context markers
// and the like) removed. Nested YAML values are flattened into one line; this
// is for reading, never for writing back.
export type SkillDoc = { meta: [string, string][]; body: string };

export function parseSkillDoc(src: string): SkillDoc {
  let body = src.replace(/^﻿/, "");
  const meta: [string, string][] = [];
  const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (fm) {
    body = body.slice(fm[0].length);
    for (const line of fm[1].split(/\r?\n/)) {
      const top = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
      if (top) { meta.push([top[1], unquote(top[2])]); continue; }
      // An indented or list line continues the previous key's value.
      const more = line.trim().replace(/^-\s*/, "");
      if (more && meta.length) {
        const last = meta[meta.length - 1];
        last[1] = last[1] && !/^[|>][-+]?$/.test(last[1]) ? `${last[1]}, ${unquote(more)}` : unquote(more);
      }
    }
  }
  body = body.replace(/<!--[\s\S]*?-->/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return { meta: meta.filter(([, v]) => v !== ""), body };
}

function unquote(v: string): string {
  const t = v.trim();
  return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t;
}

export function metaValue(doc: SkillDoc, key: string): string | null {
  return doc.meta.find(([k]) => k.toLowerCase() === key)?.[1] ?? null;
}
