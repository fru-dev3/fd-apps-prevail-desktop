// One type scale for everything below the page header. The page title lives
// in the header bar (SettingsHeader / PAGE_HEADER_ROW); inside a pane:
//   DetailTitle   the picked item's name at the top of a detail pane
//                 (display face, 26px). The only display text in a pane.
//   SectionTitle  a heading inside the pane (sans, 19px).
//   CardHeadline  the headline of a finding, insight or recommendation card
//                 (sans, 17px). Cards never use the display face.
//   Body          reading text (15px, relaxed).
//   Meta          dates, counts, paths (13px, muted).
// A number that is the point of a card may use the display face, at most 28px
// (SCORE). typescale.test.ts keeps larger sizes from creeping back.
import type { ReactNode } from "react";

export const DETAIL_TITLE = "font-display text-[26px] font-semibold leading-tight tracking-tight text-text-primary";
export const SECTION_TITLE = "text-[19px] font-semibold text-text-primary";
export const CARD_HEADLINE = "text-[17px] font-semibold leading-snug text-text-primary";
export const BODY = "text-[15px] leading-relaxed";
export const META = "text-[13px] text-text-muted";
export const SCORE = "font-display text-[28px] font-bold leading-none tabular-nums";

export function DetailTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`${DETAIL_TITLE} ${className}`}>{children}</h2>;
}
export function SectionTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h3 className={`${SECTION_TITLE} ${className}`}>{children}</h3>;
}
export function CardHeadline({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h4 className={`${CARD_HEADLINE} ${className}`}>{children}</h4>;
}
