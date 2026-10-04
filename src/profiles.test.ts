import { beforeEach, describe, expect, it } from "vitest";
import {
  getActiveId, getDefaultId, isDemoVaultPath, loadProfiles, nameFromUserMd, offeredProfiles,
  reconcileProductionProfiles, saveProfiles, setActiveId, setDefaultId, setProfilesProduction, type Profile,
} from "./profiles";

const DEMO: Profile = { id: "p_demo", label: "Demo Person", vaultPath: "/Users/sam/.prevail/demo-vault", image: "data:image/jpeg;base64,AAAA" };
const REAL = "/Users/sam/MyVault";

describe("production profile reconcile", () => {
  beforeEach(() => {
    localStorage.clear();
    setProfilesProduction(false);
  });

  it("recognises demo and sample vault paths only", () => {
    expect(isDemoVaultPath("/Users/sam/.prevail/demo-vault")).toBe(true);
    expect(isDemoVaultPath("/Users/sam/.prevail/demo-vault/")).toBe(true);
    expect(isDemoVaultPath("/Users/sam/Documents/vault-2-demo")).toBe(true);
    expect(isDemoVaultPath("/App/Contents/Resources/resources/sample-vault")).toBe(true);
    expect(isDemoVaultPath(REAL)).toBe(false);
    expect(isDemoVaultPath("/Users/sam/demo-vault-notes/x")).toBe(false);
  });

  it("a stale demo active profile is replaced by a new one for the config vault", () => {
    saveProfiles([DEMO]);
    localStorage.setItem("prevail.profiles.activeId", DEMO.id);
    localStorage.setItem("prevail.profiles.defaultId", DEMO.id);
    setProfilesProduction(true);
    const p = reconcileProductionProfiles(REAL, "Sam");
    expect(p.vaultPath).toBe(REAL);
    expect(p.label).toBe("Sam");
    expect(p.image).toBeUndefined();
    expect(getActiveId()).toBe(p.id);
    expect(getDefaultId()).toBe(p.id);
    // The demo profile stays in storage, hidden.
    expect(loadProfiles().map((x) => x.id)).toContain(DEMO.id);
    expect(offeredProfiles().map((x) => x.id)).toEqual([p.id]);
  });

  it("reuses the profile already pointing at the config vault (trailing slash too)", () => {
    const mine: Profile = { id: "p_mine", label: "Work", vaultPath: `${REAL}/` };
    saveProfiles([DEMO, mine]);
    localStorage.setItem("prevail.profiles.activeId", DEMO.id);
    const p = reconcileProductionProfiles(REAL, "Ignored");
    expect(p.id).toBe("p_mine");
    expect(loadProfiles()).toHaveLength(2);
    expect(getActiveId()).toBe("p_mine");
    expect(getDefaultId()).toBe("p_mine");
  });

  it("falls back to Personal without a usable user.md name", () => {
    expect(reconcileProductionProfiles(REAL, null).label).toBe("Personal");
  });

  it("a demo profile can never become active or default in production", () => {
    saveProfiles([DEMO]);
    setProfilesProduction(true);
    reconcileProductionProfiles(REAL, null);
    const real = getActiveId();
    setActiveId(DEMO.id);
    setDefaultId(DEMO.id);
    expect(getActiveId()).toBe(real);
    expect(getDefaultId()).toBe(real);
  });

  it("demo mode is unchanged: demo profiles are offered and can be active", () => {
    saveProfiles([DEMO]);
    setActiveId(DEMO.id);
    expect(getActiveId()).toBe(DEMO.id);
    expect(offeredProfiles()).toHaveLength(1);
  });

  it("reads the name from user.md, never a demo heading", () => {
    expect(nameFromUserMd("# Sam — Who I Am\nbody")).toBe("Sam");
    expect(nameFromUserMd("# Sam, Who I Am")).toBe("Sam");
    expect(nameFromUserMd("# Demo Person, Demo Profile")).toBeNull();
    expect(nameFromUserMd("no heading")).toBeNull();
    expect(nameFromUserMd("")).toBeNull();
  });
});
