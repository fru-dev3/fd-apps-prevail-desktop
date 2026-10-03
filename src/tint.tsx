// One palette for the sidebar's icons (owner, 2026-10-02): every section and
// row gets its own tasteful hue (no yellow or gold), drawn as a lucide icon on
// a small tinted square (.tint-sq in index.css) like the specialists' faces.
import type { LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";

/** Hues in oklch degrees; yellow and gold (about 70 to 110) are never used. */
export const TINT_HUE: Record<string, number> = {
  // sections
  work: 255, entities: 352, activities: 195, specialists: 300, domains: 165,
  // Home rows
  inbox: 215, insights: 175, recommendations: 330,
  // Work rows
  "task-list": 250, compass: 155, decisions: 285, playbooks: 205,
  // kinds
  people: 355, places: 140, products: 232, things: 30, events: 190, projects: 268,
};
export const tintColor = (key: string, fallback = 250) => `oklch(0.62 0.15 ${TINT_HUE[key] ?? fallback})`;

export function TintIcon({ icon: Icon, tint, color, square = true, size }: { icon: LucideIcon; tint?: string; color?: string; square?: boolean; size?: number }) {
  const style = { "--tint": color ?? tintColor(tint ?? "") } as CSSProperties;
  if (!square) return <Icon className="tint-ic" style={style} width={size ?? 14} height={size ?? 14} strokeWidth={2.1} aria-hidden />;
  return <span className="tint-sq" style={style} aria-hidden><Icon strokeWidth={2.1} /></span>;
}
