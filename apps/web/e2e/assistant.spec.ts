import { expect, test } from "@playwright/test";
import { mockApi, tasks } from "./api-mock";

const preparing = tasks[0]!; // has a seeded version 1 on linkedin
const scheduled = tasks[2]!; // frozen

test("a source is attached to the dossier and removed again", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/tasks/${preparing.id}`);
  await expect(page.getByText("Aucune source.")).toBeVisible();
  await page.getByLabel("Nom de la source").fill("Note produit");
  await page.getByLabel("Lien (facultatif)").fill("https://example.com/insight");
  await page.getByRole("button", { name: "Ajouter la source" }).click();
  const list = page.getByRole("list", { name: "Sources" });
  await expect(list.getByRole("link", { name: "Note produit" })).toHaveAttribute("href", "https://example.com/insight");
  await page.getByRole("button", { name: "Retirer Note produit" }).click();
  await expect(page.getByText("Aucune source.")).toBeVisible();
});

test("a proposal shows its diff and only becomes a version once accepted", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/tasks/${preparing.id}`);
  await expect(page.getByText(/Version 1 · linkedin/)).toBeVisible();
  await page.getByLabel("Intervention").selectOption("fix");
  await page.getByLabel("Précision (facultatif)").fill("Ajouter un appel à l'action.");
  await page.getByRole("button", { name: "Lancer" }).click();

  const proposal = page.getByRole("list", { name: "Propositions" }).getByRole("listitem").first();
  await expect(proposal).toContainText("Corriger la version · linkedin · à décider");
  const diff = proposal.getByLabel("Différences avec la version actuelle");
  await expect(diff).toContainText("+ En savoir plus sur trigenys.com.");
  // Nothing changed on the content yet.
  await expect(page.getByText(/Version 1 · linkedin/)).toBeVisible();

  await proposal.getByRole("button", { name: "Accepter comme nouvelle version" }).click();
  await expect(page.getByText(/Version 2 · linkedin · assistée/)).toBeVisible();
  await expect(proposal).toContainText("acceptée");
  await expect(proposal.getByRole("button", { name: "Accepter comme nouvelle version" })).toHaveCount(0);
});

test("a dismissed proposal leaves the content untouched", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/tasks/${preparing.id}`);
  await page.getByLabel("Intervention").selectOption("propose");
  await page.getByRole("button", { name: "Lancer" }).click();
  const proposal = page.getByRole("list", { name: "Propositions" }).getByRole("listitem").first();
  await proposal.getByRole("button", { name: "Écarter" }).click();
  await expect(proposal).toContainText("écartée");
  await expect(page.getByText(/Version 1 · linkedin/)).toBeVisible();
});

test("the assistant is read-only once the content is frozen", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/tasks/${scheduled.id}`);
  await expect(page.getByText("Contenu gelé dans cet état : l'assistant est en lecture seule.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lancer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ajouter la source" })).toHaveCount(0);
});
