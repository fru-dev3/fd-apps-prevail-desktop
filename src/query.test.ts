import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { cachedInvoke, useEngineQuery } from "./query";

describe("query cache", () => {
  it("shares one in-flight call between identical concurrent reads", async () => {
    let n = 0;
    const f = () => new Promise<number>((r) => setTimeout(() => r(++n), 5));
    const [a, b] = await Promise.all([cachedInvoke("k1", f), cachedInvoke("k1", f)]);
    expect([a, b, n]).toEqual([1, 1, 1]);
  });

  it("paints the cached value at once on remount, then revalidates", async () => {
    let n = 0;
    const f = () => Promise.resolve(++n);
    const first = renderHook(() => useEngineQuery("k2", f));
    await waitFor(() => expect(first.result.current.data).toBe(1));
    first.unmount();
    const second = renderHook(() => useEngineQuery("k2", f));
    expect(second.result.current.data).toBe(1); // cached, no loading state
    expect(second.result.current.loading).toBe(false);
    await waitFor(() => expect(second.result.current.data).toBe(2)); // background refresh
    await new Promise((r) => setTimeout(r, 30));
    expect(n).toBe(2); // and it settles: no refetch loop
  });

  it("refetches a mounted reader when an invalidating event fires", async () => {
    let n = 0;
    const f = () => Promise.resolve(++n);
    const { result } = renderHook(() => useEngineQuery("k3", f, { staleMs: 60_000, invalidateOn: ["prevail:foo-changed"] }));
    await waitFor(() => expect(result.current.data).toBe(1));
    act(() => { window.dispatchEvent(new Event("prevail:foo-changed")); });
    await waitFor(() => expect(result.current.data).toBe(2));
  });

  it("an event during an in-flight read still triggers a fresh read after it", async () => {
    let n = 0;
    const f = () => new Promise<number>((r) => setTimeout(() => r(++n), 20));
    const { result } = renderHook(() => useEngineQuery("k5", f, { invalidateOn: ["prevail:bar-changed"] }));
    act(() => { window.dispatchEvent(new Event("prevail:bar-changed")); }); // first read still in flight
    await waitFor(() => expect(result.current.data).toBe(2));
  });

  it("keeps a fresh entry within staleMs", async () => {
    let n = 0;
    const f = () => Promise.resolve(++n);
    await cachedInvoke("k4", f, { staleMs: 60_000 });
    expect(await cachedInvoke("k4", f, { staleMs: 60_000 })).toBe(1);
  });
});
