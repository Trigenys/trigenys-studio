import { expect, test } from "@playwright/test";
import { mockApi, tasks } from "./api-mock";

// Visuals on a task: rendered from the product's approved brand kit, listed
// as images, discarded logically. The server's refusals surface as-is.

test("renders a visual from the approved kit and lists it", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/tasks/${tasks[0]!.id}`);
  const section = page.getByRole("region", { name: "Visuels" });
  await expect(section.getByText("Aucun visuel rendu.")).toBeVisible();
  await section.getByLabel("Format").selectOption("linkedin");
  await section.getByLabel("Accroche (facultatif)").fill("Disponible aujourd'hui");
  await section.getByRole("button", { name: "Rendre le visuel" }).click();
  const list = section.getByRole("list", { name: "Visuels" });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByRole("img")).toHaveAttribute("alt", /Disponible aujourd'hui/);
  await expect(list.getByText("linkedin · variante 1 · 1200×627")).toBeVisible();
});

test("a second render of the same format is a new variant; discarding removes it", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/tasks/${tasks[0]!.id}`);
  const section = page.getByRole("region", { name: "Visuels" });
  await section.getByRole("button", { name: "Rendre le visuel" }).click();
  await expect(section.getByRole("listitem")).toHaveCount(1);
  await section.getByRole("button", { name: "Rendre le visuel" }).click();
  await expect(section.getByRole("listitem")).toHaveCount(2);
  await expect(section.getByText(/variante 2/)).toBeVisible();
  await section.getByRole("button", { name: "Écarter article · variante 1" }).click();
  await expect(section.getByRole("listitem")).toHaveCount(1);
  await expect(section.getByText(/variante 1/)).toHaveCount(0);
});

test("without an approved kit the render is refused with the server's reason", async ({ page }) => {
  await mockApi(page, { approvedKit: false });
  await page.goto(`/tasks/${tasks[0]!.id}`);
  const section = page.getByRole("region", { name: "Visuels" });
  await section.getByRole("button", { name: "Rendre le visuel" }).click();
  await expect(section.getByRole("alert")).toContainText("No approved brand kit");
  await expect(section.getByText("Aucun visuel rendu.")).toBeVisible();
});

test("a reviewer sees the visuals but cannot render or discard", async ({ page }) => {
  await mockApi(page, { reviewerOnly: true });
  await page.goto(`/tasks/${tasks[0]!.id}`);
  const section = page.getByRole("region", { name: "Visuels" });
  await expect(section.getByText("Aucun visuel rendu.")).toBeVisible();
  await expect(section.getByRole("button", { name: "Rendre le visuel" })).toHaveCount(0);
});
