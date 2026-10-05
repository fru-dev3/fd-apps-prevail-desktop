// Toolkit clarity: groups start collapsed, skills group by source with a
// single-skill source folded into one row, and the detail says what the item
// is (a type badge) above labeled actions such as "Chat with it".
import { test, expect, type Page } from "@playwright/test";
import { openChatTab } from "./open-chat";
import { mockTauri } from "./tauri-mock";

const SKILL_MD = [
  "---",
  "name: foo-stays",
  "description: Book and review foo stays.",
  "category: travel",
  "sync: manual",
  "---",
  "<!-- vault-context -->",
  "# Foo stays",
  "Find a foo place to stay.",
].join("\n");

const FX = {
  scan_skills: [
    { domain: "career", name: "foo-review", path: "/tmp/smoke-vault/data/domains/career/memory/skills/foo-review", description: "Review the foo", enabled: true },
    { domain: "career", name: "foo-plan", path: "/tmp/smoke-vault/data/domains/career/memory/skills/foo-plan", description: "Plan the foo", enabled: true },
    { domain: "foostay", name: "foostay", path: "/tmp/smoke-vault/data/domains/foostay/memory/skills/foostay", description: "Book and review foo stays.", enabled: true },
  ],
  read_skill: SKILL_MD,
  write_text_file: null,
};

async function openToolkit(page: Page) {
  await page.goto("/");
  await openChatTab(page); await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Toolkit", exact: true }).click();
  const col = page.getByTestId("toolkit-list");
  await expect(col).toBeVisible({ timeout: 10_000 });
  return col;
}

test.beforeEach(async ({ page }) => {
  await mockTauri(page, FX);
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
});

test("Toolkit groups start collapsed, remember the choice, and a single-skill source is one row", async ({ page }) => {
  const col = await openToolkit(page);
  for (const g of ["skills", "tools", "frameworks"]) {
    await expect(col.getByTestId(`toolkit-group-${g}`)).toHaveAttribute("aria-expanded", "false");
  }
  await expect(col.getByTestId("toolkit-skill-foo-review")).toHaveCount(0);
  await col.getByTestId("toolkit-group-skills").click();
  // A source with several skills is a collapsed group row with a count.
  const career = col.getByTestId("toolkit-src-career");
  await expect(career).toHaveAttribute("aria-expanded", "false");
  await expect(career).toContainText("2");
  await expect(col.getByTestId("toolkit-skill-foo-review")).toHaveCount(0);
  // A source holding one skill of its own name is a single row, no header.
  await expect(col.getByTestId("toolkit-src-foostay")).toHaveCount(0);
  const single = col.getByTestId("toolkit-skill-foostay");
  await expect(single).toHaveAttribute("data-single", "1");
  await expect(single).toContainText("Foostay");
  await career.click();
  await expect(col.getByTestId("toolkit-skill-foo-review")).toContainText("Foo Review");
  // The open Skills group survives a reload; the others stay collapsed.
  await page.reload();
  const again = page.getByTestId("toolkit-list");
  await openChatTab(page); await page.getByText("What should we work on?").waitFor({ timeout: 15_000 }).catch(() => {});
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Toolkit", exact: true }).click();
  await expect(again.getByTestId("toolkit-group-skills")).toHaveAttribute("aria-expanded", "true", { timeout: 10_000 });
  await expect(again.getByTestId("toolkit-group-tools")).toHaveAttribute("aria-expanded", "false");
  // Search reaches into collapsed groups and opens the ones with matches.
  await page.getByLabel("Search the toolkit").fill("plan");
  await expect(again.getByTestId("toolkit-skill-foo-plan")).toBeVisible();
  await expect(again.getByTestId("toolkit-skill-foo-review")).toHaveCount(0);
});

test("Toolkit detail: type badge, source, properties, clean body, Edit saves, Chat with it opens chat", async ({ page }) => {
  const col = await openToolkit(page);
  await col.getByTestId("toolkit-group-skills").click();
  await col.getByTestId("toolkit-skill-foostay").click();
  const detail = page.getByTestId("toolkit-detail-skill");
  await expect(detail.getByTestId("toolkit-type")).toHaveText("Skill");
  await expect(detail.getByRole("heading", { level: 2 })).toHaveText("Foo Stays");
  await expect(detail).toContainText("From Foostay");
  await expect(detail).toContainText("Book and review foo stays.");
  const props = detail.getByTestId("toolkit-details");
  await expect(props).toContainText("Category");
  await expect(props).toContainText("travel");
  await expect(props).toContainText("Sync");
  // No raw frontmatter and no HTML comment in the rendered body.
  const body = detail.getByTestId("toolkit-skill-body");
  await expect(body).toContainText("Find a foo place to stay.");
  await expect(body).not.toContainText("vault-context");
  await expect(body).not.toContainText("category:");
  // Edit in place writes SKILL.md back through the file write command.
  await detail.getByTestId("toolkit-edit").click();
  const editor = detail.getByLabel("SKILL.md");
  await editor.fill(`${SKILL_MD}\nOne more foo line.`);
  await detail.getByTestId("toolkit-save").click();
  await expect.poll(() => page.evaluate(() =>
    ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? [])
      .find((e) => e.cmd === "write_text_file")?.args ?? null)).toMatchObject({ path: "/tmp/smoke-vault/data/domains/foostay/memory/skills/foostay/SKILL.md" });
  await expect(body).toContainText("One more foo line.");
  // Chat with it lands on the chat with the composer seeded for this skill.
  await detail.getByTestId("toolkit-chat-with").click();
  await expect(page.getByTestId("toolkit-list")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator("textarea").first()).toHaveValue(/Using the "foostay" skill/, { timeout: 10_000 });
});
