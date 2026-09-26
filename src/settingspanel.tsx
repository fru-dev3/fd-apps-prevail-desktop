// The Settings page shell, extracted from App.tsx. Owns the section router /
// left-nav and composes every Settings section from its own module.
import { useEffect, useState } from "react";
import { Compass, Sigma } from "lucide-react";
import { useAppearance } from "./hooks";
import { ScrollPage, SettingsHeader } from "./sectionutil";
import { FrameworksSection, RemoteSection, ShortcutsSection } from "./settings1";
import { PhoneSection } from "./remotepair";
import { DaemonsSection, MemoryContextSection, SkillsSection } from "./settings2";
import { AppsMirrorPanel } from "./appsmirror";
import { SystemActivity } from "./activitypanel";
import { MirrorPanel } from "./mirror";
import { EntitiesView } from "./entitiesview";
import { navSection } from "./navdefs";
import { ToolsPanel } from "./toolspanel";
import { AutonomyPanel } from "./autonomypanel";
import { LoopBoard } from "./loopboard";
import { OmegaSection } from "./omega";
import { CollapsibleSection } from "./collapsible";
import { GeneralSection, IdealStateSection, SafetySection } from "./settings4";
import { AboutSection, GatewayLogsCard, GatewaySection } from "./settings5";
import { IntegrationsPanel } from "./integrationspanel";
import { CouncilSettingsSection, PrivacyConnectivitySection } from "./settings6";
import { UsageDashboard } from "./usagedashboard";
import { track } from "./telemetry";
import { ModelsSection } from "./settings7";
import { AppearanceSection, WorkspaceSection } from "./settings8";
import { BenchmarkPanel } from "./benchpanel";
import { HooksSection } from "./hookssection";
import { ProfilesSection } from "./profilessection";
import type { CliInfo } from "./types";

// Sections that are a SideSpine screen: they fill the pane edge to edge and
// scroll their column and detail on their own.
const FLUSH_SECTIONS = new Set<string>(["intent", "entities", "connectors", "models", "benchmark"]);

export function SettingsPanel({
  appearance,
  vaultPath,
  clis,
  onRefreshClis,
  onStartChatWith,
  bunkerEnabled,
  onBunkerChange,
  onSetupDomains,
  onVaultMoved,
  jumpTo,
}: {
  appearance: ReturnType<typeof useAppearance>;
  vaultPath: string;
  clis: CliInfo[];
  onRefreshClis: () => Promise<CliInfo[]>;
  onStartChatWith?: (cliId: string, modelId?: string) => void;
  bunkerEnabled: boolean;
  onBunkerChange: (on: boolean) => void;
  onSetupDomains?: () => void;
  onVaultMoved?: (path: string) => void;
  jumpTo?: { section: string; n: number } | null;
}) {
  type Section = "general" | "models" | "benchmark" | "privacy" | "connectors" | "ideal-state" | "omega" | "memory" | "intent" | "entities" | "daemons" | "safety" | "autonomy" | "council" | "gateway" | "mcp" | "remote" | "phone" | "workspace" | "vault" | "demo" | "appearance" | "frameworks" | "skills" | "shortcuts" | "about" | "activity" | "loopboard" | "hooks" | "profiles" | "tools" | "usage";
  // Editor lands on General. The operational surfaces (Work board / Insights /
  // Spark) moved to Work mode, so Editor opens on a config page. A specific
  // jumpTo (e.g. "connectors") still wins.
  const [section, setSection] = useState<Section>(jumpTo?.section ? (navSection(jumpTo.section) as Section) : "general");
  // Anonymous usage signal: WHICH surface opened (a name from the telemetry
  // enum), never what's in it. One event per section change.
  useEffect(() => { track("feature_used", { feature: section }); }, [section]);
  // Allow callers (e.g. the Demo ribbon's "Switch to Production" link) to jump
  // straight to a section. The nonce makes repeat jumps to the same section fire.
  useEffect(() => {
    if (jumpTo?.section) setSection(navSection(jumpTo.section) as Section);
  }, [jumpTo?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // Value is consumed by sections via the deep-link event; only the setter is
  // read here, so the state value itself is intentionally left unbound.
  const [, setSettingsDeepLink] = useState<string | null>(null);
  // In-settings deep links (e.g. a model row's "runs" button jumping to the
  // Benchmark cockpit) dispatch this event rather than threading props.
  // Format: "section" or "section:detail" - detail is passed to the section.
  useEffect(() => {
    const onJump = (e: Event) => {
      const raw = (e as CustomEvent<string>).detail;
      if (!raw) return;
      const colonIdx = raw.indexOf(":");
      if (colonIdx === -1) {
        setSection(navSection(raw) as Section);
        setSettingsDeepLink(null);
      } else {
        setSection(navSection(raw.slice(0, colonIdx)) as Section);
        setSettingsDeepLink(raw.slice(colonIdx + 1));
      }
    };
    window.addEventListener("prevail:settings-section", onJump as EventListener);
    return () => window.removeEventListener("prevail:settings-section", onJump as EventListener);
  }, []);

  return (
    // Content-only: the Editor nav lives in the shared app sidebar (EDITOR_NAV),
    // so this panel renders just the active section. min-h-0 + flex-1 so it fills
    // the space above the footer ribbon.
    <ScrollPage key={section} testId="settings-page" flush={FLUSH_SECTIONS.has(section)}>
        {/* Full width: settings use the whole pane. */}
        
          {section === "general" && <GeneralSection appearance={appearance} />}
          {section === "privacy" && <PrivacyConnectivitySection enabled={bunkerEnabled} onChange={onBunkerChange} />}
          {section === "models" && <ModelsSection clis={clis} onStartChatWith={onStartChatWith} onActivated={onRefreshClis} vaultPath={vaultPath} />}
          {section === "benchmark" && <BenchmarkPanel vaultPath={vaultPath} />}
          {/* B2-24 / image #28: Ideals = page header + two big collapsible sections
              (Constitution, Omega). Big-header collapsibles so each reads above the
              sub-headers inside; Constitution open by default. */}
          {section === "ideal-state" && (
            <>
              <SettingsHeader
                title="Ideals"
                icon={Compass}
                subtitle="The vision everything here optimizes for."
              />
              <CollapsibleSection
                large
                icon={Compass}
                title="Constitution"
                subtitle="Your operating vision and principles. Highest precedence everywhere."
                defaultOpen
                storageKey="prevail.settings.ideals.constitution"
              >
                <IdealStateSection vaultPath={vaultPath} headerless />
              </CollapsibleSection>
              <CollapsibleSection
                large
                icon={Sigma}
                title="Omega"
                subtitle="Cross-system shared context that travels with you."
                storageKey="prevail.settings.ideals.omega"
              >
                <OmegaSection vaultPath={vaultPath} headerless />
              </CollapsibleSection>
            </>
          )}
          {/* "omega" kept as a deep-link target (no nav item) — folded into Ideals. */}
          {section === "omega" && <OmegaSection vaultPath={vaultPath} />}
          {section === "memory" && <MemoryContextSection vaultPath={vaultPath} />}
          {/* tasks / recommendations / spark are Work surfaces — the sidebar routes
              them to WorkPanel (App.tsx WORK_SECTIONS), so no Editor branch here. */}
          {/* B2-20 / image #29: Memory engine page deleted; Memory & Context now
              lives inside Routines as a peer collapsible group (in DaemonsSection),
              not a divider-separated section. */}
          {section === "daemons" && <DaemonsSection vaultPath={vaultPath} />}
          {section === "usage" && <UsageDashboard vaultPath={vaultPath} />}
          {section === "activity" && <SystemActivity vaultPath={vaultPath} />}
                              {section === "intent" && <MirrorPanel vaultPath={vaultPath} />}
          {section === "entities" && <EntitiesView vaultPath={vaultPath} />}
          {section === "tools" && <ToolsPanel />}
          {section === "loopboard" && <LoopBoard vaultPath={vaultPath} />}
          {section === "council" && <CouncilSettingsSection clis={clis} />}
          {section === "connectors" && <AppsMirrorPanel vaultPath={vaultPath} />}
                    {section === "safety" && <SafetySection vaultPath={vaultPath} />}
          {section === "autonomy" && <AutonomyPanel vaultPath={vaultPath} />}
          {section === "gateway" && <><GatewaySection /><GatewayLogsCard vaultPath={vaultPath} /></>}
          {section === "mcp" && <IntegrationsPanel vaultPath={vaultPath} clis={clis} />}
          {section === "hooks" && <HooksSection vaultPath={vaultPath} />}
          {section === "profiles" && <ProfilesSection />}
          {section === "remote" && <RemoteSection />}
          {section === "phone" && <PhoneSection />}
          {/* IA-1: "workspace" is the umbrella; "vault"/"demo" remain as
              deep-link aliases (e.g. the demo ribbon's jump) → same section. */}
          {(section === "workspace" || section === "vault" || section === "demo") && (
            <WorkspaceSection vaultPath={vaultPath} onSetupDomains={onSetupDomains} onVaultMoved={onVaultMoved} />
          )}
          {section === "appearance" && <AppearanceSection appearance={appearance} />}
          {section === "frameworks" && <FrameworksSection />}
          {section === "skills" && <SkillsSection vaultPath={vaultPath} />}
          {section === "shortcuts" && <ShortcutsSection />}
          {section === "about" && <AboutSection vaultPath={vaultPath} />}
    </ScrollPage>
  );
}
