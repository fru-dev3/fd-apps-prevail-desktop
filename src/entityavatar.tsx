// The picture an entity shows wherever it appears (list rows, the detail
// header, chips, the duplicates review):
//   1. its own picture (picture.<ext> in its vault folder), when it has one;
//   2. else, for an org with a website, that site's logo, fetched ONCE through
//      the app's favicon command and then saved into the entity's folder
//      (set-picture), so it is local from then on. Never while Bunker Mode is
//      on, and never for people or places;
//   3. else nothing, and the caller draws its initials or kind icon.
import { useEffect, useState } from "react";
import { invoke } from "./bridge";
import { useFavicon } from "./entities";
import { entitySnapshot } from "./entitystore";
import { isBunkerOn } from "./storage";

export interface AvatarEntity { id?: string; kind: string; picture?: string | null; website?: string | null }

const pictureCache = new Map<string, Promise<string>>();
const encryptedCache = new Map<string, Promise<boolean>>();

// Pictures and files are plain files, which the vault's encryption does not
// cover yet: an encrypted vault gets none written into it.
export const ENCRYPTED_NOTE = "Pictures and files aren't encrypted yet, so they're off for encrypted vaults.";
export function vaultEncrypted(vault: string): Promise<boolean> {
  let p = encryptedCache.get(vault);
  if (!p) {
    // Unknown counts as encrypted: never write a plain file on a guess.
    p = invoke<{ encrypted?: boolean }>("engine_vault_status", { vault }).then((r) => r?.encrypted !== false).catch(() => true);
    encryptedCache.set(vault, p);
  }
  return p;
}
export function useVaultEncrypted(vault: string | null): boolean | null {
  const [v, setV] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    if (vault) void vaultEncrypted(vault).then((x) => { if (live) setV(x); });
    return () => { live = false; };
  }, [vault]);
  return v;
}
const saving = new Set<string>();

export function useBunker(): boolean {
  const [on, setOn] = useState(isBunkerOn);
  useEffect(() => {
    const sync = () => setOn(isBunkerOn());
    window.addEventListener("prevail:bunker-changed", sync);
    return () => window.removeEventListener("prevail:bunker-changed", sync);
  }, []);
  return on;
}

/** "https://www.foo.com/about" -> "foo.com". */
export function websiteHost(website: string | null | undefined): string | undefined {
  const w = (website ?? "").trim().toLowerCase();
  if (!w) return undefined;
  const m = w.match(/^(?:[a-z]+:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?:[:/?#].*)?$/);
  return m ? m[1] : undefined;
}

export function useEntityPicture(e: AvatarEntity | null | undefined): string {
  const vault = entitySnapshot().vault;
  const bunker = useBunker();
  const picture = e?.picture || "";
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    setSrc("");
    if (!picture || !vault) return;
    const key = `${vault}\n${picture}`;
    let p = pictureCache.get(key);
    if (!p) { p = invoke<string>("engine_entity_picture", { vault, path: picture }).then((x) => x || "").catch(() => ""); pictureCache.set(key, p); }
    void p.then((x) => { if (live) setSrc(x); });
    return () => { live = false; };
  }, [vault, picture]);
  // Only an org, only with a website, only with the network allowed.
  const host = !picture && !bunker && e?.kind === "org" ? websiteHost(e.website) : undefined;
  const logo = useFavicon(host);
  useEffect(() => {
    if (!logo || !e?.id || !vault || saving.has(e.id)) return;
    saving.add(e.id);
    const id = e.id;
    void vaultEncrypted(vault)
      .then(async (enc) => {
        if (enc) return;
        await invoke("engine_entities_set_picture", { vault, id, dataUri: logo });
        window.dispatchEvent(new CustomEvent("prevail:entities-changed"));
      })
      .catch(() => { /* the logo still shows; it is saved next time */ saving.delete(id); });
  }, [logo, e?.id, vault]);
  return src || logo;
}

export function AvatarImg({ src, size, round }: { src: string; size: number; round: boolean }) {
  return (
    <span aria-hidden data-entity-picture className={`flex shrink-0 items-center justify-center overflow-hidden bg-white ring-1 ring-border-subtle ${round ? "rounded-full" : "rounded-lg"}`} style={{ width: size, height: size }}>
      <img src={src} alt="" className={round ? "h-full w-full object-cover" : "h-[80%] w-[80%] object-contain"} />
    </span>
  );
}
