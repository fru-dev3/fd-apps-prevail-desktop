// One face per specialist (Fru, 2026-10-02: "make this colorful... little icons
// that are animated"). The one source of truth for how a specialist looks:
// its color, its face, a slow blink while idle, and a livelier state (a ring
// that turns, eyes that scan) while it works a job. The chief of staff wears
// the user's accent color, so it follows whatever palette they picked.
//
// Drawn in a 32-unit box so it stays crisp from 18px in a list to 56px in a
// page header. Motion lives in index.css (.sa-*) and stops under
// prefers-reduced-motion. Decorative by default: the name sits next to it.
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { useInvokeQuery } from "./query";

export type AvatarState = "idle" | "working" | "off";
type Eyes = "dots" | "ovals" | "happy" | "visor" | "cyclops" | "glasses" | "wink" | "sleepy" | "wide" | "monocle";
type Extra = "antenna" | "sprout" | "spark" | "brow" | "browR" | "smile" | "flat" | "o" | "grin";
interface Look { hue: number; eyes: Eyes; extra?: Extra[]; chroma?: number }

// Hues skip yellow and amber (about 70 to 115 in OKLCH): no gold, ever.
export const LOOKS: Record<string, Look> = {
  researcher: { hue: 255, eyes: "glasses", extra: ["smile"] },
  scout: { hue: 175, eyes: "cyclops", extra: ["antenna"] },
  planner: { hue: 292, eyes: "ovals", extra: ["flat"] },
  steward: { hue: 160, eyes: "happy", extra: ["smile"], chroma: 0.1 },
  editor: { hue: 352, eyes: "ovals", extra: ["smile"] },
  writer: { hue: 25, eyes: "wink", extra: ["grin"] },
  analyst: { hue: 228, eyes: "visor" },
  historian: { hue: 48, eyes: "sleepy", extra: ["smile"], chroma: 0.11 },
  sentinel: { hue: 198, eyes: "visor", extra: ["antenna"] },
  auditor: { hue: 268, eyes: "monocle", extra: ["flat"] },
  builder: { hue: 38, eyes: "dots", extra: ["brow", "grin"] },
  clerk: { hue: 215, eyes: "dots", extra: ["flat"], chroma: 0.09 },
  operator: { hue: 8, eyes: "ovals", extra: ["antenna"] },
  coach: { hue: 130, eyes: "happy", extra: ["sprout", "grin"], chroma: 0.18 },
  skeptic: { hue: 312, eyes: "dots", extra: ["browR", "flat"] },
  interviewer: { hue: 328, eyes: "wide", extra: ["o"] },
  mechanic: { hue: 190, eyes: "cyclops", extra: ["flat"], chroma: 0.09 },
  negotiator: { hue: 280, eyes: "dots", extra: ["smile"] },
  liaison: { hue: 165, eyes: "ovals", extra: ["grin"] },
  tutor: { hue: 240, eyes: "glasses", extra: ["grin"] },
  confidant: { hue: 338, eyes: "sleepy", extra: ["smile"] },
};
const EYES: Eyes[] = ["dots", "ovals", "happy", "cyclops", "wide", "wink"];

/** A specialist the user made gets a stable look from its id (never a gold hue). */
export function lookOf(id: string): Look {
  const k = id.toLowerCase();
  if (LOOKS[k]) return LOOKS[k];
  let h = 0;
  for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  let hue = h % 360;
  if (hue > 68 && hue < 118) hue = (hue + 60) % 360;
  return { hue, eyes: EYES[h % EYES.length], extra: [(["smile", "flat", "grin"] as const)[(h >> 4) % 3]] };
}

/** The specialist's color, for a chip or a ring beside its face. */
export function avatarColor(id: string): string {
  if (id === "chief") return "var(--color-accent)";
  const l = lookOf(id);
  return `oklch(0.62 ${l.chroma ?? 0.15} ${l.hue})`;
}

const INK = "oklch(0.22 0.03 var(--sa-h, 260))";

function eyes(kind: Eyes): ReactNode {
  const ink = { fill: INK };
  const line = { stroke: INK, strokeWidth: 2.1, strokeLinecap: "round" as const, fill: "none" };
  switch (kind) {
    case "dots": return <><circle cx="12" cy="15" r="2.2" {...ink} /><circle cx="20" cy="15" r="2.2" {...ink} /></>;
    case "ovals": return <><ellipse cx="12" cy="14.6" rx="1.9" ry="2.9" {...ink} /><ellipse cx="20" cy="14.6" rx="1.9" ry="2.9" {...ink} /></>;
    case "wide": return <><circle cx="11.6" cy="14.8" r="3" {...ink} /><circle cx="20.4" cy="14.8" r="3" {...ink} /><circle cx="12.6" cy="13.8" r="1" fill="#fff" /><circle cx="21.4" cy="13.8" r="1" fill="#fff" /></>;
    case "happy": return <><path d="M9.6 15.6 Q12 12.6 14.4 15.6" {...line} /><path d="M17.6 15.6 Q20 12.6 22.4 15.6" {...line} /></>;
    case "sleepy": return <><path d="M9.6 14.4 Q12 16.8 14.4 14.4" {...line} /><path d="M17.6 14.4 Q20 16.8 22.4 14.4" {...line} /></>;
    case "wink": return <><circle cx="12" cy="15" r="2.2" {...ink} /><path d="M17.8 15.4 Q20 13 22.2 15.4" {...line} /></>;
    case "cyclops": return <><circle cx="16" cy="14.6" r="4.1" fill="#fff" fillOpacity="0.92" /><circle cx="16" cy="14.9" r="2.4" {...ink} /><circle cx="16.9" cy="13.9" r="0.8" fill="#fff" /></>;
    case "visor": return <><rect x="8.2" y="12.6" width="15.6" height="4.6" rx="2.3" {...ink} /><rect x="10.2" y="14" width="3.4" height="1.7" rx="0.85" fill="oklch(0.9 0.12 var(--sa-h, 260))" className="sa-glint" /></>;
    case "glasses": return <><circle cx="11.8" cy="15" r="3.3" fill="#fff" fillOpacity="0.35" stroke={INK} strokeWidth="1.5" /><circle cx="20.2" cy="15" r="3.3" fill="#fff" fillOpacity="0.35" stroke={INK} strokeWidth="1.5" /><path d="M15.1 14.6 H16.9" stroke={INK} strokeWidth="1.4" /><circle cx="11.8" cy="15.2" r="1.3" {...ink} /><circle cx="20.2" cy="15.2" r="1.3" {...ink} /></>;
    case "monocle": return <><circle cx="11.8" cy="15" r="2" {...ink} /><circle cx="20.2" cy="15" r="3.4" fill="#fff" fillOpacity="0.4" stroke={INK} strokeWidth="1.5" /><circle cx="20.2" cy="15.2" r="1.4" {...ink} /><path d="M22.6 17.6 L24 21" stroke={INK} strokeWidth="1" strokeLinecap="round" /></>;
  }
}

function extra(kind: Extra): ReactNode {
  const line = { stroke: INK, strokeWidth: 1.8, strokeLinecap: "round" as const, fill: "none" };
  switch (kind) {
    case "smile": return <path key={kind} d="M13.6 20.4 Q16 22.4 18.4 20.4" {...line} />;
    case "grin": return <path key={kind} d="M12.6 19.8 Q16 23.6 19.4 19.8 Z" fill={INK} />;
    case "flat": return <path key={kind} d="M14 21 H18" {...line} />;
    case "o": return <ellipse key={kind} cx="16" cy="21.2" rx="1.4" ry="1.7" fill={INK} />;
    case "brow": return <g key={kind}><path d="M9.6 10.9 H14" {...line} /><path d="M18 10.9 H22.4" {...line} /></g>;
    case "browR": return <path key={kind} d="M17.8 10.6 L22.4 9.2" {...line} />;
    // Above the head: drawn outside the orb, inside the box.
    case "antenna": return <g key={kind} className="sa-antenna"><path d="M16 3.4 V0.9" stroke={`oklch(0.5 0.14 var(--sa-h, 260))`} strokeWidth="1.3" strokeLinecap="round" /><circle cx="16" cy="1.2" r="1.15" fill={`oklch(0.72 0.17 var(--sa-h, 260))`} /></g>;
    case "sprout": return <g key={kind} className="sa-antenna"><path d="M16 3.6 Q16 1.6 17.6 0.7 Q18.2 2.6 16 3.6Z" fill="oklch(0.62 0.17 145)" /><path d="M16 3.6 Q16 2.2 14.6 1.6 Q14.3 3 16 3.6Z" fill="oklch(0.7 0.16 145)" /></g>;
    // A small sparkle on the orb, top right: the chief's mark on any background.
    case "spark": return <path key={kind} className="sa-spark" d="M22.6 6.4 L23.5 8.7 L25.8 9.6 L23.5 10.5 L22.6 12.8 L21.7 10.5 L19.4 9.6 L21.7 8.7 Z" fill="#fff" />;
  }
}

/** A stable per-id offset so a list of faces never blinks in unison. */
function delay(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 17 + c.charCodeAt(0)) % 997;
  return `${-((h % 60) / 10).toFixed(1)}s`;
}

export function SpecialistAvatar({ id, size = 22, state = "idle", label, className = "" }: {
  id: string; size?: number; state?: AvatarState; label?: string; className?: string;
}) {
  const chief = id === "chief";
  const look: Look = chief ? { hue: 145, eyes: "happy", extra: ["spark", "smile"] } : lookOf(id);
  const c = look.chroma ?? 0.15;
  const off = state === "off";
  const gid = `sa-${id.replace(/[^a-z0-9-]/gi, "")}-${off ? "o" : "n"}`;
  // The chief is painted from the accent token (any palette); the rest from their hue.
  const top = chief ? "color-mix(in oklch, var(--color-accent) 35%, white)" : off ? `oklch(0.9 0.02 ${look.hue})` : `oklch(0.84 ${(c * 0.7).toFixed(3)} ${look.hue})`;
  const mid = chief ? "color-mix(in oklch, var(--color-accent) 72%, white)" : off ? `oklch(0.78 0.03 ${look.hue})` : `oklch(0.72 ${c} ${look.hue})`;
  const deep = chief ? "color-mix(in oklch, var(--color-accent) 92%, black)" : off ? `oklch(0.62 0.03 ${look.hue})` : `oklch(0.55 ${c} ${look.hue})`;
  const style = { width: size, height: size, "--sa-h": chief ? 145 : look.hue, "--sa-d": delay(id), "--sa-ring": chief ? "var(--color-accent)" : `oklch(0.62 ${c} ${look.hue})` } as CSSProperties;
  return (
    <span className={`sa inline-flex shrink-0 ${className}`} data-state={state} data-specialist={id} style={style}
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg viewBox="-1 -1 34 34" width={size} height={size} overflow="visible">
        <defs>
          <radialGradient id={gid} cx="0.34" cy="0.28" r="0.85">
            <stop offset="0" stopColor={top} />
            <stop offset="0.5" stopColor={mid} />
            <stop offset="1" stopColor={deep} />
          </radialGradient>
        </defs>
        {state === "working" && <circle cx="16" cy="17" r="15.6" fill="none" stroke="var(--sa-ring)" strokeOpacity="0.22" strokeWidth="2" />}
        {state === "working" && <circle className="sa-ring" cx="16" cy="17" r="15.6" fill="none" stroke="var(--sa-ring)" strokeWidth="2" strokeLinecap="round" strokeDasharray="26 72" />}
        <g className="sa-body">
          {(look.extra ?? []).filter((x) => x === "antenna" || x === "sprout").map(extra)}
          <circle cx="16" cy="17" r="13.4" fill={`url(#${gid})`} />
          <ellipse cx="11.8" cy="10.2" rx="3.8" ry="2" fill="#fff" opacity="0.2" transform="rotate(-28 11.8 10.2)" />
          {(look.extra ?? []).includes("spark") && extra("spark")}
          <g className="sa-face" transform="translate(0 2)">
            <g className="sa-eyes">{eyes(look.eyes)}</g>
            {(look.extra ?? []).filter((x) => x !== "antenna" && x !== "sprout" && x !== "spark").map(extra)}
          </g>
        </g>
      </svg>
    </span>
  );
}

/** The chief of staff's face: the same family, in the user's accent. */
export function ChiefAvatar({ size = 22, state = "idle", label, className }: { size?: number; state?: AvatarState; label?: string; className?: string }) {
  return <SpecialistAvatar id="chief" size={size} state={state} label={label} className={className} />;
}

/** The specialists on a running job right now, so their faces can show it. */
export function useWorkingSpecialists(vaultPath: string | null | undefined): Set<string> {
  const q = useInvokeQuery<{ status: string; team: { specialists: string[] }[]; progress?: { specialist: string }[] }[]>("engine_jobs", vaultPath ? { vault: vaultPath } : null, { staleMs: 10_000 });
  // The step at work when the job says so; otherwise its whole team.
  return useMemo(() => new Set((Array.isArray(q.data) ? q.data : []).filter((j) => j.status === "running")
    .flatMap((j) => (j.progress?.length ? j.progress.map((p) => p.specialist) : (j.team ?? []).flatMap((t) => t.specialists ?? [])))), [q.data]);
}
