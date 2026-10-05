// Settings > Work: how many tasks the Work tab's queue runs at once. The rest
// wait in the queue and start in order as others finish. Stored by the engine
// (`prevail work settings --max-running n`).
import { useEffect, useState } from "react";
import { invoke } from "./bridge";
import { SettingsRowLite } from "./panels";
import { SettingsHeader } from "./sectionutil";
import { asSettings } from "./workqueuemodel";

const CHOICES = Array.from({ length: 10 }, (_, i) => i + 1);

export function WorkSettingsSection({ vaultPath }: { vaultPath: string }) {
  const [n, setN] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!vaultPath) return;
    invoke("engine_work_settings", { vault: vaultPath }).then((s) => setN(asSettings(s).maxRunning ?? 3)).catch(() => setN(3));
  }, [vaultPath]);
  const change = async (k: number) => {
    const was = n;
    setN(k); setNote(null);
    try { await invoke("engine_work_settings", { vault: vaultPath, maxRunning: k }); }
    catch { setN(was); setNote("Could not save. Update the engine to use Work mode, then try again."); }
  };
  // An engine may hold more than 10 (it allows up to 20): keep that choice visible.
  const opts = n !== null && !CHOICES.includes(n) ? [...CHOICES, n] : CHOICES;
  return (
    <>
      <SettingsHeader title="Work" subtitle="How the Work tab runs your queue." />
      <SettingsRowLite title="Tasks that run at once" desc="More wait in the queue and start in order as others finish."
        control={
          <select data-testid="settings-work-max-running" aria-label="Tasks that run at once" value={n ?? 3} disabled={n === null}
            onChange={(e) => void change(Number(e.target.value))}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none disabled:opacity-50">
            {opts.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        } />
      {note && <p className="mt-2 text-[12px] text-err">{note}</p>}
    </>
  );
}
