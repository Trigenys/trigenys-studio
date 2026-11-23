import type { Page } from "@playwright/test";

// Phones keep the settings pages in the header account menu; desktop lists
// them in the sidebar. Opens the menu only where it is shown.
export async function openSettings(page: Page) {
  await page.getByRole("navigation", { name: "Navigation principale" }).waitFor();
  const menu = page.locator(".account-menu > summary");
  if (await menu.isVisible()) await menu.click();
}
