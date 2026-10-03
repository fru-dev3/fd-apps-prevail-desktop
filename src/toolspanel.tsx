// Tools: Prevail's governed capability layer (the Hermes "toolsets" idea, wrapped
// in Prevail's trust model). Tools are the VERBS the agent acts through, distinct
// from Apps (your services) and Skills (your recipes). This surface makes the
// construct legible AND actionable: what each capability is, whether it is
// available now, how it is governed, and a jump straight to where you control it.
// Reads a few live settings so the governance state is honest.
import { useMemo, useState, useEffect } from "react";
import { isBunkerOn } from "./storage";

export type ToolState = "on" | "governed" | "soon";
type State = ToolState;
export interface Tool {
  name: string;
  glyph: string;
  desc: string;
  governance: string;
  state: State;
  // Where you actually control this capability. Absent for "soon" tools.
  manage?: { label: string; section: string };
}

export const TOOL_STATE_LABEL: Record<State, string> = { on: "available", governed: "governed", soon: "coming" };

// Jump to the settings surface that actually governs a tool. We render inside the
// Editor's section router, so a settings-section event switches the page in place.
export function goTo(section: string) {
  window.dispatchEvent(new CustomEvent("prevail:settings-section", { detail: section }));
}

// The tool list with its live governance state (Bunker Mode turns some off).
// The Toolkit page lists these under Tools.
export function useToolList(): Tool[] {
  const [bunker, setBunker] = useState(false);
  useEffect(() => {
    const sync = () => setBunker(isBunkerOn());
    sync();
    window.addEventListener("prevail:bunker-changed", sync);
    return () => window.removeEventListener("prevail:bunker-changed", sync);
  }, []);
  const web = !bunker; // Web access is a per-domain toggle; Bunker hard-disables it.

  const tools: Tool[] = useMemo(() => [
    {
      name: "Connectors", glyph: "⚭",
      desc: "Call your connected apps' tools (Gmail, AllTrails, QuickBooks) over MCP. Pass-through connectors you authorized in Claude Code, Codex, or Gemini ride here too.",
      governance: "Per-app connection plus the autonomy brake. Consequential writes queue for your approval.",
      state: "on",
      manage: { label: "Manage in Apps", section: "apps" },
    },
    {
      name: "Browser", glyph: "◍",
      desc: "Drive a real browser: open a site, log in once, learn the steps, and replay them fast later. For apps with no API or MCP.",
      governance: bunker ? "Off in Bunker Mode (no network leaves this device)." : "Per-connector setup; runs in a dedicated profile scoped to the site.",
      state: bunker ? "soon" : "on",
      manage: { label: "Set up in Apps", section: "apps" },
    },
    {
      name: "Memory", glyph: "◇",
      desc: "Remember and recall durable facts in your vault, so context carries across conversations.",
      governance: "Vault-scoped; never leaves your device. Incognito turns it off per-chat.",
      state: "on",
      manage: { label: "Privacy settings", section: "privacy" },
    },
    {
      name: "Playbooks", glyph: "↻",
      desc: "Schedule recurring work (a Sunday briefing, a weekly review) as playbooks that run on their own.",
      governance: "Each scheduled playbook has an autonomy dial: suggest (propose, you approve) up to auto.",
      state: "governed",
      manage: { label: "Autonomy dial", section: "autonomy" },
    },
    {
      name: "Web search", glyph: "◎",
      desc: "Fetch URLs and search the web while answering.",
      governance: web && !bunker ? "On. The per-domain Web access toggle controls it." : "Off. Turn on Web access (and leave Bunker Mode) to enable.",
      state: web && !bunker ? "on" : "governed",
      manage: { label: "Privacy & web access", section: "privacy" },
    },
    {
      name: "Computer use", glyph: "▢",
      desc: "Control the desktop (screenshots, mouse, keyboard) for tasks with no API at all.",
      governance: "Will require explicit per-action approval; gated by the autonomy brake.",
      state: "soon",
    },
    {
      name: "Code execution", glyph: "‹›",
      desc: "Run code to compute, transform, or call tools programmatically (fewer model round-trips).",
      governance: "Sandboxed and approval-gated when wired.",
      state: "soon",
    },
    {
      name: "Delegation", glyph: "⋔",
      desc: "Spawn focused sub-agents with isolated context for a complex subtask, then fold the result back.",
      governance: "Inherits the parent run's autonomy and spend caps.",
      state: "soon",
    },
  ], [bunker, web]);

  return tools;
}
