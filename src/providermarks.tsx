// Provider brand-mark data extracted from App.tsx: the OpenAI SVG path, the
// safe brandIcon accessor, the direct-provider roadmap roster, and the
// OpenRouter vendor-id → mark map + OrVendorMark renderer.
import { siAnthropic, siDeepseek, siGooglegemini, siMeta, siMinimax, siMistralai, siQwen, siX as siXRaw } from "simple-icons";
import type { DirectProvider } from "./types";

// Safe accessor: if a simple-icon resolves undefined (e.g. stale dep cache),
// fall back to the monogram instead of throwing and taking down the page.

export const brandIcon = (icon: { path?: string; hex?: string } | undefined, mono: string): Partial<DirectProvider> =>
  icon && icon.path ? { path: icon.path, hex: `#${icon.hex ?? "111111"}` } : { mono };

// Shared dimensions for every settings list row (providers, connectors,
// gateways, …) so lists look identical across pages: single column, h-8 icon
// tile, gap-3, px-4 py-3, subtle border. Containers wrap these in `space-y-2`.

// Map an OpenRouter model id ("anthropic/claude-...", "x-ai/grok-4", "qwen/...")
// to a brand mark, so the catalog reads visually instead of as a wall of ids.

export const OR_VENDOR_ICON: Record<string, { path?: string; hex?: string; mono: string }> = {
  anthropic: { ...brandIcon(siAnthropic, "A") } as { path?: string; hex?: string; mono: string },
  openai: { mono: "AI" },
  google: { ...brandIcon(siGooglegemini, "G") } as { path?: string; hex?: string; mono: string },
  "x-ai": { ...brandIcon(siXRaw, "x") } as { path?: string; hex?: string; mono: string },
  deepseek: { ...brandIcon(siDeepseek, "DS") } as { path?: string; hex?: string; mono: string },
  qwen: { ...brandIcon(siQwen, "Q") } as { path?: string; hex?: string; mono: string },
  "meta-llama": { ...brandIcon(siMeta, "M") } as { path?: string; hex?: string; mono: string },
  mistralai: { ...brandIcon(siMistralai, "Mi") } as { path?: string; hex?: string; mono: string },
  minimax: { ...brandIcon(siMinimax, "MM") } as { path?: string; hex?: string; mono: string },
  moonshotai: { mono: "Ki" },
  "z-ai": { mono: "Z" },
};

export function orVendorOf(id: string): string {
  const v = id.includes("/") ? id.split("/")[0].toLowerCase() : "";
  return v;
}

export function OrVendorMark({ id, size = 18 }: { id: string; size?: number }) {
  const v = OR_VENDOR_ICON[orVendorOf(id)];
  return (
    <span className="flex shrink-0 items-center justify-center rounded-md border border-border-subtle bg-white" style={{ width: size + 8, height: size + 8 }}>
      {v?.path ? (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={v.hex ?? "#111"} aria-hidden><path d={v.path} /></svg>
      ) : (
        <span className="font-mono text-[10px] font-semibold text-text-muted">{v?.mono ?? "·"}</span>
      )}
    </span>
  );
}
