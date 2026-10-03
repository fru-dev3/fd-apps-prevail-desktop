// Which space a chat turn runs in, and what the desktop itself adds to it.
// The engine's scope resolver (engine scope.ts) builds the context for a
// domain or a project (stored as a mission): the constitution, profile,
// Compass, goals, memory and skills, the same for the desktop, the CLI, MCP
// and Telegram. So for those scopes the desktop sends only what this
// composer adds: plan mode, attached files, context the user put in, the
// skills the user attached, the prior turns and the message. With none of
// those the engine gets the typed text alone, which is exactly the input its
// parity snapshots record (scope-parity.test.ts "domain turn"): the context
// the model sees is byte-identical to the CLI's.
// General, an app's own chat and an entity chat keep the full desktop
// prompt for now (General also routes across domains on the desktop).

export type ChatScope =
  | { kind: "general" }
  | { kind: "domain"; slug: string }
  | { kind: "mission"; slug: string; name: string }
  | { kind: "app"; id: string }
  | { kind: "entity"; id: string };

export function scopeOf(o: { domain: string | null; mission?: { slug: string; name: string } | null; scopeApp?: { id: string } | null; entity?: { id: string } | null }): ChatScope {
  if (o.mission) return { kind: "mission", slug: o.mission.slug, name: o.mission.name };
  if (o.scopeApp) return { kind: "app", id: o.scopeApp.id };
  if (o.entity) return { kind: "entity", id: o.entity.id };
  if (o.domain) return { kind: "domain", slug: o.domain };
  return { kind: "general" };
}

/** The engine builds this scope's context itself: the desktop sends composer parts only. */
export const engineBuildsContext = (s: ChatScope) => s.kind === "domain" || s.kind === "mission";

/** The engine's space key for a scope (a mission's chats live under `_mission-<slug>`). */
export function engineKey(s: ChatScope): string {
  return s.kind === "mission" ? `_mission-${s.slug}` : s.kind === "domain" ? s.slug : "general";
}

export interface ComposerParts { plan: string; attach: string; primed: string; skills: string; history: string; visible: string }

/** What the composer adds to a turn, and nothing else. */
export function composerMessage(p: ComposerParts): string {
  const head = `${p.plan}${p.attach}${p.primed}${p.skills}`;
  return p.history
    ? `${head}You are mid-conversation. Below is the prior turn history; use it as context but do NOT repeat it back to the user.\n\n--- PRIOR TURNS ---\n${p.history}\n--- END PRIOR TURNS ---\n\nUser's next message: ${p.visible}`
    : `${head}${p.visible}`;
}
