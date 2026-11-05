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
