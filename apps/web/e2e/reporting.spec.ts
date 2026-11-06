import { expect, test } from "@playwright/test";
import { mockApi } from "./api-mock";

// Reporting: the monthly report separates what Studio counted from what a
// verified provider measured. Without a provider the page says so and shows
// no figure; an admin manages the contract objectives and the SEO Monitor
// link; a reviewer only reads.

test("report shows operational counts and says when no verified source is connected", async ({ page }) => {
  await mockApi(page);
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Rapport éditorial" })).toBeVisible();
  await expect(page.getByText("calculé depuis Studio")).toBeVisible();
  const counts = page.getByRole("table", { name: "Tâches par produit et type" });
  await expect(counts.getByRole("row").filter({ hasText: "Trigenys Insight" }).filter({ hasText: "Posts" })).toBeVisible();
  await expect(page.getByText("non connecté")).toHaveCount(3);
  await expect(page.getByText(/Aucune source vérifiée n'est connectée/).first()).toBeVisible();
  await expect(page.getByText("Impressions")).toHaveCount(0);
  // Not an admin: no objective form, no refresh, no address editing.
  await expect(page.getByRole("button", { name: "Rafraîchir les mesures" })).toHaveCount(0);
  await expect(page.getByRole("form", { name: "Nouvel objectif" })).toHaveCount(0);
});

test("month and product filters change the report query", async ({ page }) => {
  await mockApi(page);
  await page.goto("/reports");
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/reports/editorial")) requests.push(r.url());
  });
  await page.getByRole("button", { name: "Trigenys Insight" }).click();
  await expect.poll(() => requests.some((u) => u.includes("productId=insight"))).toBe(true);
  await expect(page.getByRole("table", { name: "Tâches par produit et type" }).getByRole("row").filter({ hasText: "Atelier" })).toHaveCount(0);
  await page.getByRole("button", { name: "Mois précédent" }).click();
  const previous = new Date();
  previous.setUTCDate(1);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  const key = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
  await expect.poll(() => requests.some((u) => u.includes(`month=${key}`))).toBe(true);
});

test("admin adds a contract objective, sees its progress, then deactivates it", async ({ page }) => {
  await mockApi(page, { admin: true });
  await page.goto("/reports");
  await expect(page.getByText("Choisissez un produit pour ajouter un objectif.")).toBeVisible();
  await page.getByRole("button", { name: "Trigenys Insight" }).click();
  const form = page.getByRole("form", { name: "Nouvel objectif" });
  await form.getByLabel("Mesure").selectOption("tasks_completed");
  await form.getByLabel("Type (optionnel)").selectOption("post");
  await form.getByLabel("Cible mensuelle").fill("4");
  await form.getByRole("button", { name: "Ajouter l'objectif" }).click();
  const list = page.getByRole("list", { name: "Objectifs" });
  await expect(list.getByText("Tâches terminées")).toBeVisible();
  await expect(list.getByTestId("objective-progress")).toHaveText("0 / 4");
  // Same scope twice: the API refuses, the page shows the problem.
  await form.getByRole("button", { name: "Ajouter l'objectif" }).click();
  await expect(form.getByText(/Objective already defined/)).toBeVisible();
  await list.getByRole("button", { name: "Désactiver" }).click();
  await expect(page.getByText("Aucun objectif actif pour ce périmètre.")).toBeVisible();
});

test("admin sets the SEO Monitor address and refuses to refresh without a verified source", async ({ page }) => {
  await mockApi(page, { admin: true });
  await page.goto("/reports");
  const insight = page.getByTestId("verified-insight");
  await expect(insight.getByText("Pas d'adresse SEO Monitor pour ce produit.")).toBeVisible();
  await insight.getByRole("button", { name: "Définir l'adresse" }).click();
  await insight.getByLabel("Adresse SEO Monitor (https)").fill("https://seo.trigenys.com/products/insight");
  await insight.getByRole("button", { name: "Enregistrer" }).click();
  await expect(insight.getByRole("link", { name: "Ouvrir SEO Monitor" })).toHaveAttribute("href", "https://seo.trigenys.com/products/insight");
  await page.getByRole("button", { name: "Rafraîchir les mesures" }).click();
  await expect(page.getByText(/Metrics provider not connected/)).toBeVisible();
});

test("connected provider: snapshots carry their source and date, refresh reports what it wrote", async ({ page }) => {
  await mockApi(page, { admin: true, metricsConnected: true });
  await page.goto("/reports");
  const insight = page.getByTestId("verified-insight");
  await expect(insight.getByText("source http-json-metrics").first()).toBeVisible();
  await expect(insight.getByText("Impressions : 1240").first()).toBeVisible();
  await expect(insight.getByText(/mesuré le/)).toBeVisible();
  await expect(page.getByTestId("verified-precis").getByText(/Aucune mesure pour ce mois/)).toBeVisible();
  await expect(page.getByText("non connecté")).toHaveCount(0);
  await page.getByRole("button", { name: "Rafraîchir les mesures" }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 cible(s) examinée(s), 2 relevé(s) écrit(s), 0 inchangé(s)." })).toBeVisible();
});

test("dashboard links to the report", async ({ page }) => {
  await mockApi(page);
  await page.goto("/today");
  await page.getByRole("link", { name: "Rapports" }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await expect(page.getByRole("heading", { name: "Rapport éditorial" })).toBeVisible();
});
