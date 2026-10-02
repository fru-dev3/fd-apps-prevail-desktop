// For You: one quiet line on the year so far, opening Your year (metrics
// plan M5). Nothing when there is nothing to say yet.
import { ArrowRight, PartyPopper } from "lucide-react";
import { useInvokeQuery } from "./query";
import { METRICS_FOCUS_EVENT, METRICS_FOCUS_KEY } from "./metricsview";
import type { YearStory } from "./storiesview";

export function openYourYear() {
  try { localStorage.setItem(METRICS_FOCUS_KEY, "year"); localStorage.setItem("prevail.mirror.view", "metrics"); } catch { /* storage off */ }
  window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "insights" }));
  window.dispatchEvent(new CustomEvent("prevail:insights-view", { detail: "metrics" }));
  window.dispatchEvent(new Event(METRICS_FOCUS_EVENT));
}

export function YearLine({ vaultPath }: { vaultPath: string }) {
  const year = String(new Date().getFullYear());
  const q = useInvokeQuery<YearStory>("engine_story", { vault: vaultPath, kind: "year", period: year }, { staleMs: 60 * 60_000 });
  const s = q.data && typeof q.data === "object" && q.data.ai ? q.data : null;
  if (!s || (!s.ai.prompts && !s.building.commits && !s.exploration.trips)) return null;
  const bits = [s.ai.prompts ? `${Math.round(s.ai.prompts).toLocaleString("en-US")} prompts` : "", s.building.shipped ? `${s.building.shipped} shipped` : "", s.exploration.trips ? `${s.exploration.trips} trips` : ""].filter(Boolean);
  return (
    <button onClick={openYourYear} data-testid="for-you-year" className="group mb-5 flex w-full max-w-4xl items-center gap-3 rounded-xl border border-border-subtle px-4 py-3 text-left transition-colors hover:border-accent-border">
      <PartyPopper className="h-4 w-4 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-text-primary">{year} so far<span className="font-normal text-text-muted"> · {bits.join(" · ")}</span></span>
      <span className="flex shrink-0 items-center gap-1 text-[13px] text-text-muted group-hover:text-accent">Your year <ArrowRight className="h-3.5 w-3.5" /></span>
    </button>
  );
}
