import { expect, test } from "@playwright/test";
import { mockApi } from "./api-mock";

// Alerts inbox: derived by the server, only acknowledged here. Every alert
// links to the task that fixes it; filters live in the URL; each user tunes
// their own e-mails; an admin can trigger a reconciliation.

test("inbox lists active alerts with priority and links each one to its task", async ({ page }) => {
  await mockApi(page);
  await page.goto("/alerts");
  await expect(page.getByRole("heading", { name: "Alertes" })).toBeVisible();
  const list = page.getByRole("list", { name: "Alertes" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(list.getByText("Contenu à corriger : Lancement Insight sur LinkedIn")).toHaveCount(0);
  const late = list.getByRole("listitem").filter({ hasText: "Tâche en retard" });
  await expect(late.getByText("P1", { exact: true })).toBeVisible();
  await expect(late.getByText("Tâche bloquée")).toBeVisible();
  const failed = list.getByRole("listitem").filter({ hasText: "Publication refusée" });
  await expect(failed.getByText("E-mail non remis")).toBeVisible();
  await expect(failed.getByRole("link")).toHaveAttribute("href", "/tasks/33333333-3333-4333-8333-333333333333#publication");
  await late.getByRole("link", { name: /Atelier Maître/ }).click();
  await expect(page).toHaveURL(/\/tasks\/44444444-4444-4444-8444-444444444444$/);
});

test("filters by state, priority and product follow the URL", async ({ page }) => {
  await mockApi(page);
  await page.goto("/alerts?state=resolved");
  const list = page.getByRole("list", { name: "Alertes" });
  await expect(page.getByRole("group", { name: "État" }).getByRole("button", { name: "Résolues" })).toHaveAttribute("aria-pressed", "true");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByText("Résolue", { exact: true })).toBeVisible();

  await page.getByRole("group", { name: "État" }).getByRole("button", { name: "En cours" }).click();
  await page.getByRole("group", { name: "Priorité" }).getByRole("button", { name: "P2" }).click();
  await expect(page).toHaveURL(/priority=p2/);
  await expect(page).not.toHaveURL(/state=/);
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByText("Approbation requise : Édito de novembre")).toBeVisible();

  await page.getByRole("group", { name: "Priorité" }).getByRole("button", { name: "Toutes" }).click();
  await page.getByRole("group", { name: "Produit" }).getByRole("button", { name: "Précis Translator" }).click();
  await expect(page).toHaveURL(/product=precis/);
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByRole("link", { name: /Publication refusée/ })).toBeVisible();
});

test("acknowledging an alert marks it seen and removes its button", async ({ page }) => {
  await mockApi(page);
  await page.goto("/alerts");
  const late = page.getByRole("list", { name: "Alertes" }).getByRole("listitem").filter({ hasText: "Tâche en retard" });
  await expect(late.getByText("À traiter")).toBeVisible();
  await late.getByRole("button", { name: "Acquitter" }).click();
  await expect(late.getByText("Vue", { exact: true })).toBeVisible();
  await expect(late.getByRole("button", { name: "Acquitter" })).toHaveCount(0);
  await expect(late.getByText(/vue le/)).toBeVisible();
});

test("empty inbox says there is nothing to report", async ({ page }) => {
  await mockApi(page);
  await page.goto("/alerts?state=open&priority=p3");
  await expect(page.getByText("Rien à signaler.")).toBeVisible();
});

test("dashboard counts the open alerts in its Alertes link", async ({ page }) => {
  await mockApi(page);
  await page.goto("/today");
  const link = page.getByRole("link", { name: "Alertes, 2 à traiter" });
  await expect(link).toContainText("2");
  await link.click();
  await expect(page).toHaveURL(/\/alerts$/);
});

test("each user sets their e-mail preference per kind, from the defaults", async ({ page }) => {
  await mockApi(page);
  await page.goto("/alerts");
  await page.getByText("Mes notifications par e-mail").click();
  const prefs = page.getByRole("list", { name: "Préférences" });
  await expect(prefs.getByRole("listitem")).toHaveCount(4);
  const approval = page.getByLabel("Approbation requise");
  await expect(approval).toHaveValue("immediate");
  const blocked = page.getByLabel("Tâche bloquée");
  await expect(blocked).toHaveValue("off");
  const row = prefs.getByRole("listitem").filter({ hasText: "Tâche bloquée" });
  await expect(row.getByText("par défaut")).toBeVisible();
  await blocked.selectOption("immediate");
  await expect(blocked).toHaveValue("immediate");
  await expect(row.getByText("réglé par vous")).toBeVisible();
  await expect(approval).toHaveValue("immediate");
});

test("only an admin can trigger a reconciliation and reads its report", async ({ page }) => {
  await mockApi(page);
  await page.goto("/alerts");
  await expect(page.getByRole("button", { name: "Vérifier maintenant" })).toHaveCount(0);

  await mockApi(page, { admin: true });
  await page.goto("/alerts");
  await page.getByRole("button", { name: "Vérifier maintenant" }).click();
  await expect(page.getByRole("status")).toContainText("Vérification faite : 0 ouverte(s)");
});
