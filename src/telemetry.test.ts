import { describe, expect, it } from "vitest";
import { scrubPosthogEvent, scrubSentryEvent, type SentryEventLike } from "./telemetry";

// Invented content standing in for what an error or event could carry.
const SECRET = ["Tamsin Okafor", "Quillbrook Lane", "remind me to call the vet about Biscuit", "/Users/someone/PrevailVault/data/entities/people/tamsin-okafor.md"];
const leaks = (v: unknown) => SECRET.filter((s) => JSON.stringify(v).includes(s));

describe("scrubSentryEvent", () => {
  const raw: SentryEventLike = {
    event_id: "abc123",
    timestamp: 1_790_000_000,
    platform: "javascript",
    level: "error",
    release: "0.3.130",
    message: `entities_show failed for ${SECRET[0]}`,
    logentry: { message: SECRET[2] },
    extra: { prompt: SECRET[2] },
    tags: { entity: SECRET[0] },
    contexts: { device: { name: "someones-mac" }, state: { note: SECRET[1] } },
    breadcrumbs: [{ message: SECRET[2] }],
    request: { url: "tauri://localhost/?q=" + SECRET[0] },
    server_name: "someones-mac",
    fingerprint: [SECRET[0]],
    transaction: SECRET[3],
    user: { id: "u", email: "someone@example.com" },
    exception: {
      values: [{
        type: "Error",
        value: `ENOENT: no such file ${SECRET[3]} (${SECRET[0]})`,
        mechanism: { type: "onunhandledrejection", handled: false },
        stacktrace: {
          frames: [
            { function: "EntitiesView", filename: "tauri://localhost/assets/index-Ab12.js", lineno: 10, colno: 4, in_app: true, vars: { name: SECRET[0] }, context_line: SECRET[2] },
            { function: SECRET[2], abs_path: SECRET[3], lineno: 3 },
          ],
        },
      }],
    },
  };

  it("keeps only the error shape and the anonymous id", () => {
    const out = scrubSentryEvent(raw, "anon-1");
    expect(leaks(out)).toEqual([]);
    expect(JSON.stringify(out)).not.toContain("someones-mac");
    expect(JSON.stringify(out)).not.toContain("example.com");
    expect(out.user).toEqual({ id: "anon-1" });
    const v = out.exception!.values![0];
    expect(v.type).toBe("Error");
    expect(v.value).toBe("[redacted]");
    expect(v.mechanism).toEqual({ type: "onunhandledrejection", handled: false });
    expect(v.stacktrace!.frames![0]).toEqual({ function: "EntitiesView", filename: "app:///index-Ab12.js", lineno: 10, colno: 4, in_app: true });
    expect(v.stacktrace!.frames![1]).toEqual({ filename: "<file>", lineno: 3 });
    for (const k of ["message", "logentry", "extra", "tags", "contexts", "breadcrumbs", "request", "server_name", "fingerprint", "transaction"]) expect(out[k]).toBeUndefined();
    expect(out.release).toBe("0.3.130");
  });

  it("a message-only event keeps no text", () => {
    const out = scrubSentryEvent({ message: SECRET[2], level: "info" }, "anon-1");
    expect(out.message).toBe("[redacted]");
    expect(leaks(out)).toEqual([]);
  });

  it("an odd error type is not trusted", () => {
    const out = scrubSentryEvent({ exception: { values: [{ type: `Error for ${SECRET[0]}`, value: "x" }] } }, "a");
    expect(out.exception!.values![0].type).toBe("Error");
  });
});

describe("scrubPosthogEvent", () => {
  it("drops events that are not on the allowlist, including exceptions", () => {
    expect(scrubPosthogEvent({ event: "$exception", properties: { $exception_message: SECRET[2] } })).toBeNull();
    expect(scrubPosthogEvent({ event: "$pageview", properties: { $current_url: SECRET[3] } })).toBeNull();
    expect(scrubPosthogEvent({ event: "$autocapture", properties: { $el_text: SECRET[0] } })).toBeNull();
    expect(scrubPosthogEvent({ event: "entity_opened", properties: {} })).toBeNull();
    expect(scrubPosthogEvent(null)).toBeNull();
  });

  it("keeps allowlisted properties and SDK bookkeeping, nothing else", () => {
    const out = scrubPosthogEvent({
      event: "feature_used",
      $set: { name: SECRET[0] },
      properties: {
        feature: "chat", token: "phc_x", distinct_id: "anon-1", $lib: "web", $os: "Mac OS X",
        $current_url: SECRET[3], $referrer: SECRET[3], $el_text: SECRET[0], prompt: SECRET[2], entity: SECRET[0],
        $set: { city: SECRET[1] }, domains: SECRET[1],
      },
    })!;
    expect(leaks(out)).toEqual([]);
    expect(out.properties).toEqual({ feature: "chat", token: "phc_x", distinct_id: "anon-1", $lib: "web", $os: "Mac OS X" });
    expect(out.$set).toBeUndefined();
  });

  it("an unknown feature value is dropped", () => {
    const out = scrubPosthogEvent({ event: "feature_used", properties: { feature: SECRET[0] } })!;
    expect(out.properties).toEqual({});
  });
});
