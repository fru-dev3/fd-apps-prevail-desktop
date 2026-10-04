// Invented credentials only. The engine's src/secret-redact.test.ts covers the
// masker in depth; this checks the desktop copy and the thread-save path.
import { describe, expect, it, vi } from "vitest";
import { maskSecrets } from "./secretmask";

const sent: Array<{ cmd: string; args: Record<string, unknown> }> = [];
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args: Record<string, unknown>) => { sent.push({ cmd, args }); return Promise.resolve(null); } }));

describe("desktop secret mask", () => {
  it("masks credentials and keeps the email", () => {
    expect(maskSecrets("Sign-in sam@example.com, Starter password: Invented-77x")).toBe("Sign-in sam@example.com, Starter password: [redacted]");
    expect(maskSecrets("reset my password tomorrow")).toBe("reset my password tomorrow");
  });

  it("a saved thread is masked before it reaches the vault", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.resetModules();
    const { invoke } = await import("./bridge");
    await invoke("save_thread", { vault: "/v", title: "pin 4471", turns: [{ role: "user", content: "password: Invented-77x" }] });
    const a = sent.find((c) => c.cmd === "save_thread")?.args;
    expect(a?.title).toBe("pin [redacted]");
    expect((a?.turns as Array<{ content: string }>)[0].content).toBe("password: [redacted]");
    expect(a?.vault).toBe("/v");
  });
});
