import { describe, expect, it } from "vitest";
import { addRef, appStepLabel, appUseLabel, appUses, parseUrls, refsToChatArgs, slugifyId } from "./appscope";
import { atMatchAt } from "./chatrefs";
import type { MirrorApp } from "./appsmirror-model";

const mail: MirrorApp = {
  id: "foo-mail", name: "Foo Mail", runtime: "claude", server: "foo-mail", status: "connected", signin_hint: "", syncable: true, domains: [],
  tools: [
    { name: "search_threads", full_name: "mcp__foo__search_threads", kind: "read", sync_allowed: true, chat_default: true },
    { name: "create_draft", full_name: "mcp__foo__create_draft", kind: "write", sync_allowed: false, chat_default: false },
  ],
};

describe("app scope helpers", () => {
  it("maps chips to the engine's flags, once each", () => {
    let refs = addRef([], { kind: "app", id: "foo-mail", label: "Foo Mail" });
    refs = addRef(refs, { kind: "app", id: "foo-mail", label: "Foo Mail" });
    refs = addRef(refs, { kind: "entity", id: "person/foo", label: "Foo" });
    refs = addRef(refs, { kind: "domain", id: "health", label: "Health" });
    refs = addRef(refs, { kind: "app", id: "Bad Id", label: "x" });
    expect(refsToChatArgs(refs)).toEqual({ apps: ["foo-mail"], entities: ["person/foo"], refDomains: ["health"] });
  });

  it("counts a reply's app calls as reads and writes from the app's tools", () => {
    const steps = [
      { id: "1", label: "Claude ai Foo Mail search threads", status: "done" as const, startedAt: 0, app: "foo-mail", thread: "t1" },
      { id: "2", label: "Claude ai Foo Mail search threads", status: "done" as const, startedAt: 0, app: "foo-mail" },
      { id: "3", label: "Claude ai Foo Mail create draft", status: "done" as const, startedAt: 0, app: "foo-mail" },
      { id: "4", label: "Reading a file", status: "done" as const, startedAt: 0 },
    ];
    const u = appUses(steps, [mail]);
    expect(u).toEqual([{ app: "foo-mail", name: "Foo Mail", reads: 2, writes: 1, other: 0, thread: "t1" }]);
    expect(appUseLabel(u[0])).toBe("Used Foo Mail · 2 reads, 1 write");
    expect(appUseLabel({ app: "x", name: "Bar", reads: 3, writes: 0, other: 0 })).toBe("Used Bar · 3 reads");
  });

  it("counts from the engine's access field when a step carries it", () => {
    const steps = [
      { id: "1", label: "anything", status: "done" as const, startedAt: 0, app: "foo-mail", tool: "search_threads", access: "read" as const },
      { id: "2", label: "anything", status: "done" as const, startedAt: 0, app: "foo-mail", tool: "list_labels", access: "read" as const },
      { id: "3", label: "Claude ai Foo Mail search threads", status: "done" as const, startedAt: 0, app: "foo-mail", access: "write" as const },
      { id: "4", label: "anything", status: "failed" as const, startedAt: 0, app: "foo-mail", tool: "send_message", access: "blocked" as const },
    ];
    const u = appUses(steps, [mail]);
    expect(u).toEqual([{ app: "foo-mail", name: "Foo Mail", reads: 2, writes: 1, blocked: 1, other: 0, thread: undefined }]);
    expect(appUseLabel(u[0])).toBe("Used Foo Mail · 2 reads, 1 write, 1 blocked");
  });

  it("labels an app tool step with the app and the tool in words", () => {
    expect(appStepLabel("Gmail", "search_threads", "Claude ai Gmail search threads")).toBe("Gmail · Search threads");
    expect(appStepLabel("Foo Mail", "createDraft", "x")).toBe("Foo Mail · Create draft");
    expect(appStepLabel("Foo Mail", "list-labels", "x")).toBe("Foo Mail · List labels");
    expect(appStepLabel(undefined, "search_threads", "Claude ai Gmail search threads")).toBe("Claude ai Gmail search threads");
    expect(appStepLabel("Gmail", undefined, "Claude ai Gmail search threads")).toBe("Claude ai Gmail search threads");
  });

  it("finds an @ mention at the caret", () => {
    expect(atMatchAt("ask @fo", 7)).toEqual({ token: "fo", start: 4, end: 7 });
    expect(atMatchAt("@", 1)).toEqual({ token: "", start: 0, end: 1 });
    expect(atMatchAt("mail me@foo", 11)).toBeNull();
    expect(atMatchAt("ask @foo then", 13)).toBeNull();
  });

  it("slugs a source name the way the engine does and reads addresses", () => {
    expect(slugifyId("Context (fru.dev)")).toBe("context-fru-dev");
    expect(parseUrls("foo.example/a\nhttps://bar.example/b, foo.example/a")).toEqual(["https://foo.example/a", "https://bar.example/b"]);
  });
});
