import { expect, test } from "@playwright/test";
import { mockApi, SVG } from "./api-mock";

// Brand kits are an admin screen: one approved kit per product, a new kit
// is created from a logo file and a palette, and approving it retires the
// previous one.

const logo = { name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from(SVG) };

test("an admin reaches the kits from the dashboard and sees the approved kit", async ({ page }) => {
  await mockApi(page, { admin: true });
  await page.goto("/today");
  await page.getByRole("link", { name: "Kits de marque" }).click();
  await expect(page).toHaveURL(/\/brand-kits$/);
  await expect(page.getByRole("heading", { level: 1, name: "Kits de marque" })).toBeVisible();
  const kits = page.getByRole("list", { name: "Kits" });
  await expect(kits.locator(":scope > li")).toHaveCount(1);
  await expect(kits.getByText("approuvé")).toBeVisible();
  await expect(kits.getByRole("img", { name: /Logo du kit/ })).toBeVisible();
  await expect(kits.getByRole("button", { name: /Approuver/ })).toHaveCount(0);
});

test("creating then approving a kit retires the previous one", async ({ page }) => {
  await mockApi(page, { admin: true });
  await page.goto("/brand-kits");
  await page.getByLabel("Nom").fill("Kit printemps");
  await page.getByLabel(/Logo \(SVG ou PNG/).setInputFiles(logo);
  await page.getByRole("button", { name: "Créer le kit" }).click();
  const kits = page.getByRole("list", { name: "Kits" });
  await expect(kits.locator(":scope > li")).toHaveCount(2);
  await expect(kits.getByText("brouillon")).toBeVisible();
  await page.getByRole("button", { name: "Approuver le kit Kit printemps" }).click();
  await expect(kits.getByText("retiré")).toBeVisible();
  await expect(kits.getByText("approuvé")).toHaveCount(1);
  await expect(kits.getByRole("button", { name: /Approuver/ })).toHaveCount(0);
});

test("a product without a kit says so and the logo type is checked before upload", async ({ page }) => {
  await mockApi(page, { admin: true });
  await page.goto("/brand-kits");
  await page.getByRole("button", { name: "Précis Translator" }).click();
  await expect(page.getByRole("status")).toContainText("Aucun kit pour ce produit");
  await page.getByLabel(/Logo \(SVG ou PNG/).setInputFiles({ name: "logo.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
  await expect(page.getByRole("alert")).toHaveText("Le logo doit être un SVG ou un PNG.");
  await expect(page.getByRole("button", { name: "Créer le kit" })).toBeDisabled();
});

test("an operator has no link and is sent back to the dashboard", async ({ page }) => {
  await mockApi(page);
  await page.goto("/brand-kits");
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("link", { name: "Kits de marque" })).toHaveCount(0);
});
