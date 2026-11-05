import { expect, test } from "@playwright/test";
import { mockApi, tasks } from "./api-mock";

const UUID = /\/tasks\/[0-9a-f-]{36}$/;

test("creates a task and saves a first version in five interactions", async ({ page }) => {
  await mockApi(page);
  await page.goto("/today?product=insight");
  await page.getByRole("link", { name: "Nouvelle tâche" }).click(); // 1
  await expect(page).toHaveURL(/\/tasks\/new\?product=insight$/);
  // The dashboard nav is also labelled "Produit" and may still be mounted: target the select.
  await expect(page.getByRole("combobox", { name: "Produit" })).toHaveValue("insight");
  await page.getByLabel("Titre").fill("Post de lancement"); // 2
  await page.getByRole("button", { name: "Créer la tâche" }).click(); // 3
  await expect(page).toHaveURL(UUID);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Post de lancement");
  await expect(page.getByText("Assignée à vous")).toBeVisible();
  await page.getByLabel("Texte").fill("Insight est disponible dès aujourd'hui."); // 4
  await page.getByRole("button", { name: "Enregistrer la version" }).click(); // 5
  await expect(page.getByRole("status").filter({ hasText: "Version 1 enregistrée" })).toBeVisible();
  await expect(page.getByText(/Version 1 · linkedin/)).toBeVisible();
  await expect(page.getByRole("button", { name: "→ En préparation" })).toBeVisible();
});

test("a second version appears with the previous one in the history", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/tasks/${tasks[0]!.id}`);
  await page.getByLabel("Texte").fill("Deuxième jet.");
  await page.getByLabel("Canal").selectOption("newsletter");
  await page.getByRole("button", { name: "Enregistrer la version" }).click();
  await expect(page.getByText(/Version 2 · newsletter/)).toBeVisible();
  await page.getByText("Versions précédentes").click();
  const history = page.getByRole("list").filter({ hasText: "Version 1 · linkedin" });
  await expect(history.getByRole("listitem")).toHaveCount(2);
});

test("comments are posted and listed", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/tasks/${tasks[0]!.id}`);
  await expect(page.getByText("Aucun commentaire.")).toBeVisible();
  await page.getByLabel("Votre commentaire").fill("Ajouter le lien vers la doc.");
  await page.getByRole("button", { name: "Commenter" }).click();
  const list = page.getByRole("list", { name: "Commentaires" });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list).toContainText("Vous");
  await expect(list).toContainText("Ajouter le lien vers la doc.");
  await expect(page.getByLabel("Votre commentaire")).toHaveValue("");
});

test("editing with a stale version shows the conflict and reloads", async ({ page }) => {
  await mockApi(page, { updateStatus: 409 });
  await page.goto(`/tasks/${tasks[0]!.id}`);
  await page.getByText("Modifier la tâche").click();
  await page.getByLabel("Titre").fill("Nouveau titre");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Version obsolète");
  await alert.getByRole("button", { name: "Recharger" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lancement Insight sur LinkedIn");
});

test("metadata edits are saved and reflected in the header", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/tasks/${tasks[0]!.id}`);
  await page.getByText("Modifier la tâche").click();
  await page.getByLabel("Titre").fill("Lancement Insight — édition LinkedIn");
  await page.getByLabel("Priorité (0 à 3)").fill("2");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Modifications enregistrées" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lancement Insight — édition LinkedIn");
  await expect(page.getByText("Priorité 2")).toBeVisible();
});

test("frozen content offers no new version", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/tasks/${tasks[2]!.id}`); // scheduled, operator has no write on precis
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Précis : étude de cas traduction");
  await expect(page.getByRole("button", { name: "Enregistrer la version" })).toHaveCount(0);
  await expect(page.getByText("Aucune action disponible")).toBeVisible();
});

test("reviewer sends a task back with a reason", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/tasks/${tasks[3]!.id}`); // reviewing, atelier: reviewer only
  await expect(page.getByRole("button", { name: "→ Visuels" })).toHaveCount(0);
  await page.getByRole("button", { name: "→ À corriger" }).click();
  await page.getByLabel(/Motif pour « À corriger »/).fill("Le chiffre du paragraphe 2 est faux.");
  await page.getByRole("button", { name: "Confirmer" }).click();
  await expect(page.locator(".chip-state")).toHaveText("À corriger");
  await expect(page.getByRole("button", { name: "→ À corriger" })).toHaveCount(0);
  await page.getByText("Historique des transitions").click();
  await expect(page.getByText("Le chiffre du paragraphe 2 est faux.")).toBeVisible();
});
