import { expect, test, type Page } from "@playwright/test";
import { mockApi, tasks } from "./api-mock";

// Phones (< 768px) navigate with a bottom tab bar; every screen fits a 375px
// viewport without horizontal scrolling. Desktop keeps its sidebar.

const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 800 };

const SCREENS = [
  "/today",
  "/imports",
  "/calendar",
  "/reports",
  "/alerts",
  "/tasks/new",
  `/tasks/${tasks[0]!.id}`,
  `/tasks/${tasks[1]!.id}`,
  "/brand-kits",
  "/social-accounts",
];

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe("phone", () => {
  test.use({ viewport: PHONE });

  for (const path of SCREENS) {
    test(`${path} fits 375px without horizontal scrolling`, async ({ page }) => {
      await mockApi(page, { admin: true });
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expect(page.locator(".state-loading")).toHaveCount(0);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test("the bottom tab bar replaces the sidebar and marks the active section", async ({ page }) => {
    await mockApi(page);
    await page.goto("/today");
    const nav = page.getByRole("navigation", { name: "Navigation principale" });
    await expect(nav).toHaveCount(1);
    await expect(nav).toHaveClass(/tab-bar/);
    const box = await nav.boundingBox();
    expect(box && Math.round(box.y + box.height)).toBe(PHONE.height);
    await expect(nav.getByRole("link", { name: "Ma journée" })).toHaveAttribute("aria-current", "page");

    await nav.getByRole("link", { name: "Calendrier" }).click();
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(nav.getByRole("link", { name: "Calendrier" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Ma journée" })).not.toHaveAttribute("aria-current");
  });

  test("the account menu holds the settings and the sign-out", async ({ page }) => {
    await mockApi(page, { admin: true });
    await page.goto("/today");
    await page.getByText("Compte", { exact: true }).click();
    const settings = page.getByRole("navigation", { name: "Réglages" });
    await expect(settings.getByRole("link", { name: "Kits de marque" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Se déconnecter" })).toBeVisible();
    await settings.getByRole("link", { name: "Kits de marque" }).click();
    await expect(page).toHaveURL(/\/brand-kits$/);
    await expect(settings).toBeHidden();
  });
});

test.describe("desktop", () => {
  test.use({ viewport: DESKTOP });

  test("keeps the sidebar and hides the phone chrome", async ({ page }) => {
    await mockApi(page);
    await page.goto("/today");
    const nav = page.getByRole("navigation", { name: "Navigation principale" });
    await expect(nav).toHaveCount(1);
    await expect(nav).toHaveClass(/global-nav/);
    await expect(page.locator(".tab-bar")).toBeHidden();
    await expect(page.locator(".account-menu")).toBeHidden();
    await expect(page.getByRole("button", { name: "Se déconnecter" })).toBeVisible();
  });
});
