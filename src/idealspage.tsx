// Ideals, laid out like Models: the page header first, then a side column of
// ideals and the chosen one on the right. Your mission (the global
// ideal-state) leads, then Omega, then every domain, with a quiet marker on the
// domains that have no ideal yet. A domain's ideal edits in place.
import { useEffect, useState } from "react";
import { Check, Circle, CircleDot, Compass, Pencil, Sigma, X, type LucideIcon } from "lucide-react";
import { invoke } from "./bridge";
import { titleCase } from "./format";
import { isUserDomain } from "./helpers";
import { domainIcon } from "./icons";
import { Markdown } from "./Markdown";
import { OmegaSection } from "./omega";
import { SettingsHeader } from "./sectionutil";
import { MissionEditor } from "./missioneditor";
import { AlignmentCard } from "./panels";
import { SideSpine } from "./sidespine";
import { useIsPhone } from "./useisphone";

const iconBtn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent";

function DomainIdeal({ vaultPath, domain, body, onSaved }: { vaultPath: string; domain: string; body: string; onSaved: (b: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setDraft(body); setEditing(false); setErr(null); }, [domain, body]);
  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await invoke("write_domain_ideal", { vault: vaultPath, domain, body: draft });
      onSaved(draft);
      setEditing(false);
    } catch (e) { setErr(`Could not save: ${String(e)}`); }
    finally { setSaving(false); }
  };
  return (
    <section data-testid="ideal-detail-domain">
      <div className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[26px] font-semibold leading-tight tracking-tight text-text-primary">{titleCase(domain)}</h2>
          <p className="mt-1 text-[14px] text-text-muted">What a thriving {titleCase(domain)} looks like.</p>
        </div>
        {editing ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <button onClick={() => void save()} disabled={saving} title="Save" aria-label="Save ideal" className={iconBtn}><Check className="h-4 w-4" /></button>
            <button onClick={() => { setDraft(body); setEditing(false); }} title="Cancel" aria-label="Cancel editing" className={iconBtn}><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} title="Edit" aria-label={`Edit the ${titleCase(domain)} ideal`} className={iconBtn}><Pencil className="h-4 w-4" /></button>
        )}
      </div>
      {editing ? (
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={16} aria-label={`${titleCase(domain)} ideal`}
          className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-[14px] leading-relaxed text-text-primary focus:border-accent-border focus:outline-none" />
      ) : body.trim() ? (
        <div className="prose-sm max-w-3xl text-sm leading-relaxed text-text-primary"><Markdown source={body} /></div>
      ) : (
        <p className="text-[14px] text-text-muted">No ideal yet. Use the edit icon to write one.</p>
      )}
      {err && <p className="mt-2 text-[13px] text-err">{err}</p>}
    </section>
  );
}

export function IdealsSection({ vaultPath, initial }: { vaultPath: string; initial?: string | null }) {
  const phone = useIsPhone();
  const [sel, setSel] = useState(initial || "mission");
  const [picked, setPicked] = useState(false);
  // Each domain's ideal body ("" when it has none).
  const [ideals, setIdeals] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    void (async () => {
      const ds = await invoke<{ name: string }[]>("scan_vault", { path: vaultPath }).catch(() => []);
      const names = (Array.isArray(ds) ? ds : []).map((d) => d.name).filter(isUserDomain).sort();
      const out: Record<string, string> = {};
      await Promise.all(names.map(async (n) => {
        out[n] = await invoke<string>("read_domain_ideal", { vault: vaultPath, domain: n }).then((b) => b || "").catch(() => "");
      }));
      if (alive) setIdeals(out);
    })();
    return () => { alive = false; };
  }, [vaultPath]);
  const domains = Object.keys(ideals).sort();
  const choose = (id: string) => { setSel(id); setPicked(true); };

  const row = (id: string, label: string, Icon: LucideIcon | null, sub?: string, missing = false) => {
    const on = sel === id && (!phone || picked);
    return (
      <button key={id} data-testid={`ideal-row-${id}`} aria-current={on ? "true" : undefined} onClick={() => choose(id)}
        className={`flex w-full items-center gap-2.5 rounded-lg border-l-2 px-2.5 py-2 text-left transition-colors ${on ? "border-l-accent bg-accent-soft ring-1 ring-accent-border" : "border-l-transparent hover:bg-surface-warm"}`}>
        {Icon ? <Icon className={`h-4 w-4 shrink-0 ${on ? "text-accent" : "text-text-muted"}`} /> : <CircleDot className="h-4 w-4 shrink-0 text-text-muted" />}
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm ${on ? "font-semibold text-accent" : "text-text-primary"}`}>{label}</span>
          {sub && <span className="block truncate text-[12px] text-text-muted">{sub}</span>}
        </span>
        {missing && <span title="No ideal yet" className="flex items-center gap-1 text-[12px] text-text-muted"><Circle className="h-3 w-3" /> Not set</span>}
      </button>
    );
  };
  const list = (
    <nav className="space-y-0.5 p-2" aria-label="Ideals">
      {row("mission", "Your mission", Compass, "Highest precedence everywhere")}
      {row("omega", "Omega", Sigma, "Shared context that travels with you")}
      {domains.length > 0 && <div className="px-2.5 pb-1 pt-3 text-[13px] font-semibold text-text-secondary">Domains</div>}
      {domains.map((d) => row(`domain:${d}`, titleCase(d), domainIcon(d) ?? null, undefined, !ideals[d]?.trim()))}
    </nav>
  );
  const domain = sel.startsWith("domain:") ? sel.slice(7) : null;
  const detail = (
    <div className={phone ? "px-4 py-4" : "w-full px-8 py-6"} data-testid="ideals-detail">
      {sel === "mission" && (
        <section data-testid="ideal-detail-mission">
          <MissionEditor vaultPath={vaultPath} />
          <div className="mt-8"><AlignmentCard vaultPath={vaultPath} /></div>
        </section>
      )}
      {sel === "omega" && (
        <section data-testid="ideal-detail-omega">
          <h2 className="font-display text-[26px] font-semibold leading-tight tracking-tight text-text-primary mb-4">Omega</h2>
          <OmegaSection vaultPath={vaultPath} headerless />
        </section>
      )}
      {domain && <DomainIdeal vaultPath={vaultPath} domain={domain} body={ideals[domain] ?? ""} onSaved={(b) => setIdeals((m) => ({ ...m, [domain]: b }))} />}
    </div>
  );
  return (
    <>
      <SettingsHeader title="Ideals" icon={Compass} subtitle="The vision everything here optimizes for." />
      <SideSpine storageKey="prevail.ideals.spine" title="Ideals" label="ideals" testId="ideals-list"
        phone={phone} phoneDetail={phone && picked} onBack={() => setPicked(false)} backLabel="All ideals"
        detail={detail}>
        {list}
      </SideSpine>
    </>
  );
}
