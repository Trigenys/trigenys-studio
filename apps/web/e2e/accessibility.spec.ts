import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockApi, tasks } from "./api-mock";

// WCAG 2.1 A/AA smoke checks on the screens behind the session, which the
// public Visual QA gate cannot reach. Only serious and critical impacts fail.
async function violations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test("login page has no serious accessibility violation", async ({ page }) => {
  await mockApi(page, { signedIn: false });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Ouvrir Ma journée/ })).toHaveAttribute("href", "/today");
  expect(await violations(page)).toEqual([]);
});

test("dashboard has no serious accessibility violation", async ({ page }) => {
  await mockApi(page);
  await page.goto("/today");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test("task page has no serious accessibility violation", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/tasks/${tasks[1]!.id}`);
  await expect(page.getByRole("button", { name: "Approuver" })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test("brand kits page has no serious accessibility violation", async ({ page }) => {
  await mockApi(page, { admin: true });
  await page.goto("/brand-kits");
  await expect(page.getByRole("list", { name: "Kits" })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test("task page with a rendered visual has no serious accessibility violation", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/tasks/${tasks[0]!.id}`);
  const section = page.getByRole("region", { name: "Visuels" });
  await section.getByRole("button", { name: "Rendre le visuel" }).click();
  await expect(section.getByRole("img")).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test("task page with the publication form has no serious accessibility violation", async ({ page }) => {
  await mockApi(page, { publishable: true });
  await page.goto(`/tasks/${tasks[0]!.id}`);
  await expect(page.getByRole("list", { name: "Conditions de publication" })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test("calendar page has no serious accessibility violation", async ({ page }) => {
  await mockApi(page);
  await page.goto("/calendar");
  await expect(page.getByRole("list", { name: "Jours" })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test("alerts page has no serious accessibility violation", async ({ page }) => {
  await mockApi(page, { admin: true });
  await page.goto("/alerts");
  await expect(page.getByRole("list", { name: "Alertes" })).toBeVisible();
  await page.getByText("Mes notifications par e-mail").click();
  await expect(page.getByRole("list", { name: "Préférences" })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test("social accounts page has no serious accessibility violation", async ({ page }) => {
  await mockApi(page, { admin: true });
  await page.goto("/social-accounts");
  await expect(page.getByRole("list", { name: "Comptes" })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test("reporting page has no serious accessibility violation", async ({ page }) => {
  await mockApi(page, { admin: true });
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Rapport éditorial" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Tâches par produit et type" })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});
