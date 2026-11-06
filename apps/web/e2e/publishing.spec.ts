import { expect, test } from "@playwright/test";
import { mockApi, tasks } from "./api-mock";

// Publishing: an approved task is planned on a social account, the task
// follows its delivery (scheduled, back to approved on cancel, failed then
// retried), admins map the accounts, and the calendar lists the month.

const inTwoDays = () => {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  d.setHours(10, 30, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

test("an operator plans a delivery on an approved task, then cancels it", async ({ page }) => {
  await mockApi(page, { publishable: true });
  await page.goto(`/tasks/${tasks[0]!.id}`);
  const section = page.getByRole("region", { name: "Publication" });
  await expect(section.getByText("Aucune publication planifiée.")).toBeVisible();
  await expect(section.getByLabel("Compte social")).toHaveValue("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  const plan = section.getByRole("button", { name: "Planifier" });
  await expect(plan).toBeDisabled();
  await section.getByLabel("Date de publication").fill(inTwoDays());
  const checks = section.getByRole("list", { name: "Conditions de publication" });
  await expect(checks.locator(":scope > li")).toHaveCount(5);
  await expect(checks.locator("[data-ok=false]")).toHaveCount(0);
  await expect(plan).toBeEnabled();
  await plan.click();

  const deliveries = section.getByRole("list", { name: "Publications" });
  await expect(deliveries.locator(":scope > li")).toHaveCount(1);
  await expect(deliveries.getByText("@trigenys-insight (linkedin)")).toBeVisible();
  await expect(deliveries.getByText("programmée")).toBeVisible();
  await expect(page.locator(".chip-state")).toHaveText("Programmée");

  await deliveries.getByRole("button", { name: "Annuler" }).click();
  await expect(deliveries.getByText("annulée")).toBeVisible();
  await expect(page.locator(".chip-state")).toHaveText("Approuvée");
});

test("a slot in the past is refused with the reason, and a failed delivery can be retried", async ({ page }) => {
  await mockApi(page, { publishable: true });
  await page.goto(`/tasks/${tasks[0]!.id}`);
  const section = page.getByRole("region", { name: "Publication" });
  await section.getByLabel("Date de publication").fill("2020-01-01T10:00");
  const checks = section.getByRole("list", { name: "Conditions de publication" });
  await expect(checks.getByText("Créneau")).toContainText("Date hors fenêtre");
  await expect(section.getByRole("button", { name: "Planifier" })).toBeDisabled();

  await section.getByLabel("Date de publication").fill(inTwoDays());
  await section.getByRole("button", { name: "Planifier" }).click();
  const deliveries = section.getByRole("list", { name: "Publications" });
  await expect(deliveries.getByText("programmée")).toBeVisible();

  // The outbox gave up: the delivery is failed and the task follows.
  await page.evaluate(() => fetch("/__test/fail-delivery", { method: "POST" }));
  await page.reload();
  await expect(deliveries.getByText("en échec")).toBeVisible();
  await expect(deliveries.getByText(/Provider refused the post · tentative 2\/5/)).toBeVisible();
  await expect(page.locator(".chip-state")).toHaveText("Échec de publication");
  await deliveries.getByRole("button", { name: "Tentatives (2)" }).click();
  await expect(deliveries.getByRole("list", { name: "Tentatives" }).locator(":scope > li")).toHaveCount(2);
  await deliveries.getByRole("button", { name: "Réessayer" }).click();
  await expect(deliveries.getByText("programmée")).toBeVisible();
  await expect(page.locator(".chip-state")).toHaveText("Programmée");
});

test("a task that is not approved cannot be planned and a reviewer sees no form", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/tasks/${tasks[0]!.id}`);
  const section = page.getByRole("region", { name: "Publication" });
  await expect(section.getByText("La planification s'ouvre une fois la tâche approuvée.")).toBeVisible();
  await expect(section.getByRole("button", { name: "Planifier" })).toHaveCount(0);

  await mockApi(page, { reviewerOnly: true, publishable: true });
  await page.goto(`/tasks/${tasks[0]!.id}`);
  await expect(section.getByText("Aucune publication planifiée.")).toBeVisible();
  await expect(section.getByRole("heading", { name: "Planifier une publication" })).toHaveCount(0);
});

test("an admin links a social account from the provider's channels and deactivates it", async ({ page }) => {
  await mockApi(page, { admin: true });
  await page.goto("/today");
  await page.getByRole("link", { name: "Comptes sociaux" }).click();
  await expect(page).toHaveURL(/\/social-accounts$/);
  const accounts = page.getByRole("list", { name: "Comptes" });
  await expect(accounts.locator(":scope > li")).toHaveCount(1);
  await expect(accounts.getByText("@trigenys-insight")).toBeVisible();

  await page.getByRole("button", { name: "Charger les canaux du fournisseur" }).click();
  await page.getByRole("list", { name: "Canaux du fournisseur" }).getByRole("button", { name: "Trigenys X · x" }).click();
  await expect(page.getByLabel("Identifiant fournisseur")).toHaveValue("ch-insight-x");
  await expect(page.getByLabel("Réseau")).toHaveValue("x");
  await expect(page.getByLabel("Nom affiché")).toHaveValue("Trigenys X");
  await page.getByLabel("Identifiant public").fill("@trigenys");
  await page.getByRole("button", { name: "Relier le compte" }).click();
  await expect(accounts.locator(":scope > li")).toHaveCount(2);
  await expect(accounts.getByText("@trigenys · Trigenys X")).toBeVisible();

  await page.getByRole("button", { name: "Désactiver @trigenys-insight" }).click();
  await expect(page.getByRole("button", { name: "Activer @trigenys-insight" })).toBeVisible();
  await expect(accounts.getByText("inactif")).toHaveCount(1);
});

test("an operator is sent back to the dashboard from the social accounts page", async ({ page }) => {
  await mockApi(page);
  await page.goto("/social-accounts");
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("link", { name: "Comptes sociaux" })).toHaveCount(0);
});

test("the calendar lists the month's deliveries and due dates and filters by product", async ({ page }) => {
  await mockApi(page);
  await page.goto("/today");
  await page.getByRole("link", { name: "Calendrier" }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(page.getByRole("heading", { level: 1, name: "Calendrier" })).toBeVisible();

  // The seeded delivery sits a week from now: move forward when it crossed the month.
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 3600_000);
  if (nextWeek.getMonth() !== now.getMonth()) await page.getByRole("button", { name: "Mois suivant" }).click();
  const entry = page.getByRole("list", { name: /^Publications du / }).locator(":scope > li");
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText("Précis : étude de cas traduction");
  await expect(entry).toContainText("@precis-translator (linkedin)");
  await expect(entry).toContainText("programmée");
  await expect(page.getByRole("list", { name: /^Échéances du / }).locator(":scope > li").first()).toContainText("Échéance");

  await page.getByRole("navigation", { name: "Produit" }).getByRole("button", { name: "Trigenys Insight" }).click();
  await expect(page.getByRole("list", { name: /^Publications du / })).toHaveCount(0);
  await expect(page.getByText("@precis-translator")).toHaveCount(0);
  await expect(page.getByRole("list", { name: /^Échéances du / }).first()).toBeVisible();

  await page.getByRole("button", { name: "Mois précédent" }).click();
  await page.getByRole("button", { name: "Mois précédent" }).click();
  await expect(page.getByRole("status")).toContainText("Rien de planifié ce mois-ci");
});
