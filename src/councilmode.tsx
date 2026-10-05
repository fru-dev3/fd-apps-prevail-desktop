// Council is a way of answering, not a place: a toggle in the composer (Chat
// and Council show the same one in the same spot), off by default and
// remembered on this device. On, the conversation is answered by the council.
import { Scale } from "lucide-react";
import { lsGet, lsSet } from "./storage";

const COUNCIL_KEY = "prevail.chat.council";

export const councilToggleOn = () => lsGet(COUNCIL_KEY) === "1";
export const setCouncilToggle = (on: boolean) => lsSet(COUNCIL_KEY, on ? "1" : "0");

/**
 * The one seam that decides whether the conversation is answered by the
 * council. Today the user's composer toggle decides. The engine's
 * auto-council (Settings > Council, "Auto-convene") can choose here later,
 * from the question, the domain or the stakes.
 */
export function answerWithCouncil(o: { toggle: boolean }): boolean {
  return o.toggle;
}

export function CouncilToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      data-testid="council-toggle"
      onClick={() => onChange(!on)}
      title={on ? "Council on: the council answers. Click for a single model." : "Council: have several models answer and a chair weigh them"}
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${on ? "border-accent bg-accent font-semibold text-background shadow-sm" : "border-border bg-background text-text-muted hover:text-accent"}`}
    >
      <Scale className="h-3.5 w-3.5" /> {on ? "Council on" : "Council"}
    </button>
  );
}
