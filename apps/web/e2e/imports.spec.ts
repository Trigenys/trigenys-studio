import { expect, test } from "@playwright/test";
import { mockApi } from "./api-mock";

test("imports are previewed, synchronised, turned into a task or ignored", async ({ page }) => {
  await mockApi(page);
  await page.goto("/imports");
  await expect(page.getByRole("heading", { name: "Entrées" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Aucune entrée");

  await page.getByRole("button", { name: "Synchroniser" }).click();
  // The sync report and the (still fading) empty state are both live regions: filter.
  await expect(page.getByRole("status").filter({ hasText: "Radar Editorial OS" })).toContainText("Radar Editorial OS : 1 reçu(s), 1 nouveau(x)");
  const list = page.getByRole("list", { name: "Entrées" });
  const cards = list.locator("> li"); // each card nests its own list of sources
  await expect(cards).toHaveCount(2);

  // Provenance is shown as received: origin, date, sources.
  const topic = cards.filter({ hasText: "Les LLM en PME" });
  await expect(topic).toContainText("Radar Editorial OS · observé le");
  await expect(topic.getByRole("link", { name: "https://source.example/llm" })).toBeVisible();

  // Filter by origin.
  await page.getByRole("button", { name: "CMS Insight", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(list.getByRole("link", { name: "Neon vs Supabase" })).toHaveAttribute("href", "https://insight.example/fr/posts/neon-vs-supabase");
  await page.getByRole("button", { name: "Toutes les origines" }).click();

  // Create a task from the radar topic: it leaves the "à traiter" list.
  await topic.getByRole("button", { name: "Créer une tâche" }).click();
  await expect(cards).toHaveCount(1);
  await page.getByRole("button", { name: "Liées" }).click();
  await expect(cards.filter({ hasText: "Les LLM en PME" }).getByRole("link", { name: "Ouvrir la tâche" })).toBeVisible();

  // Ignore the article.
  await page.getByRole("button", { name: "À traiter" }).click();
  await list.getByRole("button", { name: "Ignorer" }).click();
  await expect(page.getByRole("status").last()).toContainText("Aucune entrée");
});

test("a reviewer reads the imports without acting on them", async ({ page }) => {
  await mockApi(page, { reviewerOnly: true });
  await page.goto("/imports");
  await page.getByRole("button", { name: "Liées" }).click();
  await expect(page.getByRole("button", { name: "Synchroniser" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Créer une tâche" })).toHaveCount(0);
});
