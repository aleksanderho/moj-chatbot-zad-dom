import { test, expect } from "@playwright/test";

test("narzędzie zapisuje profil, potwierdza go i używa w nowej rozmowie", async ({ page }) => {
  await page.goto("/");
  const ready = page.getByRole("button", { name: "Nowa rozmowa", exact: true });
  await expect(ready).toBeEnabled();
  await page.getByLabel("Wiadomość klienta", { exact: true }).fill("Mam na imię Ola.");
  await page.getByRole("button", { name: "Wyślij", exact: true }).click();
  await expect(page.locator(".message.assistant").last()).toContainText("Zapamiętałem: imię — Ola.");
  await expect(page.locator(".tool-badge")).toContainText("zapiszProfil");
  await expect(ready).toBeEnabled();
  await ready.click();
  await page.reload();
  await expect(ready).toBeEnabled();
  await expect(page.locator(".message")).toHaveCount(0);
  await page.getByLabel("Wiadomość klienta", { exact: true }).fill("Jak mam na imię?");
  await page.getByRole("button", { name: "Wyślij", exact: true }).click();
  await expect(page.locator(".message.assistant").last()).toContainText("Masz na imię Ola.");
});
