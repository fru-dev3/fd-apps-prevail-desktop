import { describe, expect, it, vi } from "vitest";
import { migrateProductsOnOpen } from "./productsmigrate";

const notify = () => ({ success: vi.fn(), error: vi.fn() });

describe("migrateProductsOnOpen", () => {
  it("stays quiet when there was nothing to move", async () => {
    const n = notify();
    const invoke = vi.fn().mockResolvedValue({ ok: true, ran: false, skipped: "nothing-to-do", errors: [] });
    await migrateProductsOnOpen("/v", invoke as never, n);
    expect(invoke).toHaveBeenCalledWith("engine_products_migrate", { vault: "/v" });
    expect(n.success).not.toHaveBeenCalled();
    expect(n.error).not.toHaveBeenCalled();
  });
  it("says what moved and refreshes the entities when it ran", async () => {
    const n = notify();
    const changed = vi.fn();
    window.addEventListener("prevail:entities-changed", changed);
    const invoke = vi.fn().mockResolvedValue({ ok: true, ran: true, errors: [], counts: { liveMoved: 3, pagesMoved: 2, archivedMoved: 1, archivedMerged: 0 } });
    await migrateProductsOnOpen("/v", invoke as never, n);
    expect(n.success).toHaveBeenCalledWith("Moved 6 apps and company pages into Products, one list.");
    expect(changed).toHaveBeenCalled();
    window.removeEventListener("prevail:entities-changed", changed);
  });
  it("reports a failure", async () => {
    const n = notify();
    await migrateProductsOnOpen("/v", vi.fn().mockRejectedValue("boom") as never, n);
    expect(n.error).toHaveBeenCalled();
    const m = notify();
    await migrateProductsOnOpen("/v", vi.fn().mockResolvedValue({ ok: false, ran: false, errors: ["backup did not verify"] }) as never, m);
    expect(m.error).toHaveBeenCalledWith("Could not move apps into Products: backup did not verify");
  });
});
