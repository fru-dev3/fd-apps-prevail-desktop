// An entity's Files tab: what the owner keeps in its vault folder's files/
// (`entities files`), added with a picker or by dropping files on the list.
// A picked file previews inline when it is a picture or plain text.
import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FileText, FolderOpen, Loader2, Plus, Upload } from "lucide-react";
import { invoke } from "./bridge";
import { ENCRYPTED_NOTE } from "./entityavatar";
import { Markdown } from "./Markdown";
import { REVEAL } from "./ui";

export interface EntityFile { name: string; size: number; mtime: number }

const IMAGE = /\.(png|jpe?g|webp|gif|svg)$/i;
const TEXT = /\.(md|markdown|txt|csv|json|ya?ml|log)$/i;

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
// mtime may come in seconds or milliseconds.
const fmtDay = (ts: number) => new Date(ts < 1e12 ? ts * 1000 : ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function Preview({ vaultPath, path, name }: { vaultPath: string; path: string; name: string }) {
  const [v, setV] = useState<{ img?: string; text?: string; none?: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    setV(null);
    const p = IMAGE.test(name)
      ? invoke<string>("engine_entity_picture", { vault: vaultPath, path }).then((img) => ({ img }))
      : TEXT.test(name)
        ? invoke<string>("read_text_file", { path }).then((text) => ({ text: String(text ?? "").slice(0, 20_000) }))
        : Promise.resolve({ none: true });
    void p.catch(() => ({ none: true })).then((x) => { if (live) setV(x); });
    return () => { live = false; };
  }, [vaultPath, path, name]);
  if (!v) return <div className="flex items-center gap-2 py-4 text-[13px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" />Opening</div>;
  if (v.img) return <img data-testid="entity-file-preview" src={v.img} alt={name} className="max-h-96 max-w-full rounded-lg border border-border object-contain" />;
  if (v.text !== undefined) {
    return (
      <div data-testid="entity-file-preview" className="max-h-96 overflow-auto border-l-2 border-border-subtle pl-4 text-[14px] leading-normal text-text-primary">
        {/\.(md|markdown)$/i.test(name) ? <Markdown source={v.text} /> : <pre className="whitespace-pre-wrap break-words font-sans">{v.text}</pre>}
      </div>
    );
  }
  return <p className="text-[12px] text-text-muted">No preview for this kind of file. Reveal it to open it.</p>;
}

export function EntityFiles({ vaultPath, id, folder, readFile, writable }: {
  // False for an encrypted vault (or while that is unknown): nothing is added.
  writable: boolean;
  vaultPath: string;
  id: string;
  // The entity's folder, absolute; null until it has a page.
  folder: string | null;
  readFile: (f: File, asUri: boolean) => Promise<string>;
}) {
  const [files, setFiles] = useState<EntityFile[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const load = useCallback(async () => {
    const r = await invoke<EntityFile[]>("engine_entities_files", { vault: vaultPath, id }).catch(() => []);
    setFiles(Array.isArray(r) ? r.filter((f) => f && typeof f.name === "string") : []);
  }, [vaultPath, id]);
  useEffect(() => { void load(); }, [load]);

  const add = async (args: Array<{ file?: string; name?: string; data?: string }>) => {
    if (!args.length || !writable) return;
    setBusy(true); setErr(null);
    try {
      for (const a of args) await invoke("engine_entities_add_file", { vault: vaultPath, id, ...a });
      await load();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  const pick = async () => {
    const r = await openDialog({ multiple: true }).catch(() => null);
    const list = Array.isArray(r) ? r : typeof r === "string" ? [r] : [];
    await add(list.map((file) => ({ file })));
  };
  const drop = async (list: FileList) => {
    const big = Array.from(list).find((f) => f.size > 50 * 1024 * 1024);
    if (big) { setErr(`${big.name} is over 50 MB.`); return; }
    await add(await Promise.all(Array.from(list).map(async (f) => ({ name: f.name, data: await readFile(f, false) }))));
  };
  const reveal = (name?: string) => {
    if (!folder) return;
    void invoke("open_in_finder", { path: name ? `${folder}/files/${name}` : `${folder}/files` }).catch(() => {});
  };

  return (
    <div data-testid="entity-files" className="pt-4"
      onDragOver={(e) => { if (writable && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void drop(e.dataTransfer.files); }}>
      <div className="flex items-center gap-2">
        <button onClick={() => void pick()} disabled={busy || !writable} data-testid="entity-files-add"
          className="inline-flex h-8 items-center gap-1.5 text-[13px] font-medium text-accent hover:underline disabled:opacity-60 disabled:no-underline">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Add files
        </button>
        {folder && (
          <button onClick={() => reveal()} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] text-text-muted hover:text-accent">
            <FolderOpen className="h-3.5 w-3.5" />Reveal
          </button>
        )}
      </div>
      {!writable && <p data-testid="entity-files-encrypted" className="mt-2 text-[13px] text-text-muted">{ENCRYPTED_NOTE}</p>}
      {err && <p className="mt-2 text-[13px] text-err">{err}</p>}
      <div className={`mt-2 rounded-lg border border-dashed ${over ? "border-accent bg-accent-soft/30" : "border-transparent"} -mx-2 px-0`}>
        {files === null ? <div className="flex items-center gap-2 px-2 py-3 text-[13px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" />Reading the folder</div>
          : files.length === 0 ? (
            <p className="flex items-center gap-2 px-2 py-3 text-[12px] text-text-muted"><Upload className="h-3.5 w-3.5" />{writable ? "No files yet. Drop files here, or use Add files." : "No files yet."}</p>
          ) : (
            <ul>
              {files.map((f) => (
                <li key={f.name}>
                  <div className={`group flex items-center gap-3 rounded-lg px-2 py-2 ${open === f.name ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
                    <button type="button" onClick={() => setOpen((o) => (o === f.name ? null : f.name))} data-testid="entity-file"
                      className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <FileText className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-text-primary">{f.name}</span>
                      <span className="shrink-0 text-[12px] tabular-nums text-text-muted">{fmtSize(f.size)} · {fmtDay(f.mtime)}</span>
                    </button>
                    {folder && (
                      <button onClick={() => reveal(f.name)} title="Reveal in Finder" aria-label={`Reveal ${f.name}`}
                        className={`rounded-md p-1.5 text-text-muted hover:bg-surface-warm hover:text-accent ${REVEAL}`}><FolderOpen className="h-4 w-4" /></button>
                    )}
                  </div>
                  {open === f.name && folder && <div className="px-2 pb-3 pt-1"><Preview vaultPath={vaultPath} path={`${folder}/files/${f.name}`} name={f.name} /></div>}
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}
