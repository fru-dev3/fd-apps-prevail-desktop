// One type scale for everything below the page header. The page title lives
// in the header bar (SettingsHeader / PAGE_HEADER_ROW); inside a pane:
//   DetailTitle   the picked item's name at the top of a detail pane
//                 (display face, 22px). The only display text in a pane.
//   SectionTitle  a heading inside the pane (sans, 15px semibold).
//   RowTitle      the title of a list row (15px medium, snug; clamp it).
//   CardHeadline  the headline of a finding, insight or recommendation card
//                 (sans, 15px semibold). Cards never use the display face.
//   Body          reading text (14px, normal leading).
//   Meta          dates, counts, the one muted line under a row (12px).
// A number that is the point of a card may use the display face, at most 24px
// (SCORE). The scale was tightened on 2026-10-02 (it was 26/19/17/15/13 and
// 28 for scores) because pages read too big; typescale.test.ts holds it there.
import type { ReactNode } from "react";

export const DETAIL_TITLE = "font-display text-[22px] font-semibold leading-tight tracking-tight text-text-primary";
export const SECTION_TITLE = "text-[15px] font-semibold text-text-primary";
export const ROW_TITLE = "text-[15px] font-medium leading-snug text-text-primary";
export const CARD_HEADLINE = "text-[15px] font-semibold leading-snug text-text-primary";
export const BODY = "text-[14px] leading-normal";
export const META = "text-[12px] text-text-muted";
export const SCORE = "font-display text-[24px] font-bold leading-none tabular-nums";

export function DetailTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`${DETAIL_TITLE} ${className}`}>{children}</h2>;
}
export function SectionTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h3 className={`${SECTION_TITLE} ${className}`}>{children}</h3>;
}
export function CardHeadline({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h4 className={`${CARD_HEADLINE} ${className}`}>{children}</h4>;
}
