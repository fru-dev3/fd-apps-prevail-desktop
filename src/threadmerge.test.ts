import { describe, expect, it } from "vitest";
import { mergeExternalTurns } from "./threadmerge";

const t = (role: "user" | "assistant", content: string) => ({ role, content });

describe("mergeExternalTurns", () => {
  it("keeps nothing extra when the file has not grown", () => {
    const mem = [t("user", "foo"), t("assistant", "bar")];
    expect(mergeExternalTurns(mem, mem, 2)).toBeNull();
  });

  it("folds in a scheduled turn appended while the thread was open", () => {
    const mem = [t("user", "foo"), t("assistant", "bar")];
    const disk = [...mem, t("user", "daily check"), t("assistant", "all good")];
    expect(mergeExternalTurns(mem, disk, 2)).toEqual(disk);
  });

  it("puts outside turns before the open copy's unsaved tail", () => {
    const mem = [t("user", "foo"), t("assistant", "bar"), t("user", "new question")];
    const disk = [t("user", "foo"), t("assistant", "bar"), t("user", "daily check"), t("assistant", "all good")];
    expect(mergeExternalTurns(mem, disk, 2)).toEqual([
      t("user", "foo"), t("assistant", "bar"), t("user", "daily check"), t("assistant", "all good"), t("user", "new question"),
    ]);
  });

  it("lets a deliberate edit shorten the thread", () => {
    const disk = [t("user", "foo"), t("assistant", "bar"), t("user", "baz"), t("assistant", "qux")];
    const mem = [t("user", "foo")];
    // The file is exactly as last synced, so the shorter copy wins.
    expect(mergeExternalTurns(mem, disk, 4)).toBeNull();
  });

  it("does not add the same turns twice", () => {
    const disk = [t("user", "foo"), t("assistant", "bar"), t("user", "daily check")];
    expect(mergeExternalTurns(disk, disk, 2)).toBeNull();
  });
});
