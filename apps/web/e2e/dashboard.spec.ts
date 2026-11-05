import { expect, test } from "@playwright/test";
import { mockApi, tasks } from "./api-mock";

test("redirects to the login page without a session", async ({ page }) => {
  await mockApi(page, { signedIn: false });
  await page.goto("/today");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
  await expect(page.getByLabel("Adresse e-mail")).toBeVisible();
});

test("shows the four views with counts and the product filter", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("heading", { level: 1, name: "Ma journée" })).toBeVisible();

  const views = page.getByRole("navigation", { name: "Vues" });
  await expect(views.getByRole("link", { name: /Aujourd'hui/ })).toHaveAttribute("aria-current", "page");
  // today: due today + overdue + mine without due date = 3
  await expect(views.getByRole("link", { name: /Aujourd'hui/ })).toContainText("3");
  await expect(views.getByRole("link", { name: /À valider/ })).toContainText("1");
  await expect(views.getByRole("link", { name: /Programmées/ })).toContainText("1");
  await expect(views.getByRole("link", { name: /En retard/ })).toContainText("1");

  // Overdue first.
  const items = page.getByRole("list").getByRole("listitem");
  await expect(items).toHaveCount(3);
  await expect(items.first()).toContainText("Atelier Maître — rétrospective");
  await expect(items.first()).toContainText("En retard");

  // Product filter narrows the list and the counts.
  await page.getByRole("button", { name: "Trigenys Insight" }).click();
  await expect(page).toHaveURL(/product=insight/);
  await expect(items).toHaveCount(2);
  await expect(views.getByRole("link", { name: /En retard/ })).toContainText("0");

  // The filter follows the view switch.
  await views.getByRole("link", { name: /À valider/ }).click();
  await expect(page).toHaveURL(/\/review\?product=insight/);
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("Édito de novembre");
});

test("finds a task and its context in three interactions", async ({ page }) => {
  await mockApi(page);
  await page.goto("/today");
  // 1. type in the search, 2. open the task — the context is on screen.
  await page.getByRole("searchbox", { name: "Rechercher une tâche" }).fill("retrospective");
  const items = page.getByRole("list").getByRole("listitem");
  await expect(items).toHaveCount(1);
  await items.first().getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${tasks[3]!.id}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Atelier Maître — rétrospective");
  await expect(page.getByRole("heading", { name: "Contenu" })).toBeVisible();
  await expect(page.getByText("Insight est disponible.")).toBeVisible();
});

test("search handles accents and shows the empty state", async ({ page }) => {
  await mockApi(page);
  await page.goto("/review");
  await page.getByRole("searchbox").fill("edito");
  await expect(page.getByRole("list").getByRole("listitem")).toHaveCount(1);
  await page.getByRole("searchbox").fill("introuvable");
  await expect(page.getByRole("status")).toContainText("Aucune tâche ne correspond");
  await page.getByRole("searchbox").fill("");
  await page.getByRole("button", { name: "Atelier Maître" }).click();
  await expect(page.getByRole("status")).toContainText("Aucun contenu n'attend une validation");
});

test("shows an actionable error state and recovers on retry", async ({ page }) => {
  await mockApi(page, { tasksStatus: 503 });
  await page.goto("/today");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Service indisponible");
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockApi(page);
  await alert.getByRole("button", { name: "Réessayer" }).click();
  await expect(page.getByRole("list").getByRole("listitem")).toHaveCount(3);
});

test("keyboard: skip link, views and product filter are reachable and operable", async ({ page }) => {
  await mockApi(page);
  await page.goto("/today");
  await expect(page.getByRole("list").getByRole("listitem")).toHaveCount(3);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Aller au contenu" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();

  await page.keyboard.press("Tab"); // Nouvelle tâche
  await page.keyboard.press("Tab"); // Tous les produits
  await page.keyboard.press("Tab"); // Trigenys Insight
  await expect(page.getByRole("button", { name: "Trigenys Insight" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/product=insight/);

  await page.getByRole("link", { name: /Programmées/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/scheduled/);

  await page.getByRole("searchbox").focus();
  await page.keyboard.type("precis");
  await expect(page.getByRole("status")).toContainText("Aucune tâche ne correspond");
});

test("reviewer approves from the task page", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/tasks/${tasks[1]!.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Édito de novembre");
  await page.getByLabel("Commentaire (facultatif)").fill("Parfait");
  await page.getByRole("button", { name: "Approuver" }).click();
  await expect(page.locator(".chip-state")).toHaveText("Approuvée");
  await expect(page.getByRole("button", { name: "Approuver" })).toHaveCount(0);
});
