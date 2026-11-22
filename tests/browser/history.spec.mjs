import { test, expect } from "@playwright/test";

test("historia: F5, kolejność, ponowienie i dwie oddzielne rozmowy", async ({ page, context }) => {
  const anonymous = await context.request.get("/api/conversations?list=1");
  expect(anonymous.status()).toBe(401);
  expect((await context.request.delete("/api/conversations?id=00000000-0000-4000-8000-000000000001")).status()).toBe(401);
  const deniedPage = await context.request.get("/history", { maxRedirects: 0 });
  expect(deniedPage.status()).toBe(307);
  expect(deniedPage.headers().location).toBe("/?session=expired");

  async function send(text) {
    await page.getByLabel("Wiadomość klienta", { exact: true }).fill(text);
    await page.getByRole("button", { name: "Wyślij", exact: true }).click();
    await expect(page.getByRole("button", { name: "Nowa rozmowa", exact: true })).toBeEnabled();
    await expect(page.locator(".message.assistant").last()).toContainText(`Odpowiedź: ${text}`);
  }
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Nowa rozmowa", exact: true })).toBeEnabled();
  await send("Rozmowa A — sofa");
  const firstId = new URL(page.url()).searchParams.get("conversation");
  await send("Druga wiadomość A");
  await page.reload();
  await expect(page.locator(".message p")).toHaveText(["Rozmowa A — sofa", "Odpowiedź: Rozmowa A — sofa", "Druga wiadomość A", "Odpowiedź: Druga wiadomość A"]);

  await page.getByRole("link", { name: "Historia", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Historia rozmów" })).toBeVisible();
  await expect(page.locator(".history-item")).toHaveCount(1);
  await expect(page.locator(".history-item")).toContainText("Wiadomości: 4");
  await page.getByRole("link", { name: "Nowa rozmowa", exact: true }).click();
  await expect(page.locator(".message")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Nowa rozmowa", exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Nowa rozmowa", exact: true })).toBeEnabled();
  await expect(page.locator(".message")).toHaveCount(0);
  await send("Rozmowa B — fotel");
  const secondId = new URL(page.url()).searchParams.get("conversation");
  expect(secondId).not.toBe(firstId);
  await page.getByRole("link", { name: "Historia", exact: true }).click();
  await expect(page.locator(".history-title")).toHaveText(["Rozmowa B — fotel", "Rozmowa A — sofa"]);
  await expect(page.locator(".history-item time").first()).toHaveAttribute("datetime", /\d{4}-\d{2}-\d{2}T/);
  await page.getByRole("link", { name: /Rozmowa A — sofa/ }).click();
  await expect(page.locator(".message")).toHaveCount(4);
  await send("Trzecia wiadomość A");
  await page.reload();
  await expect(page.locator(".message p")).toHaveText(["Rozmowa A — sofa", "Odpowiedź: Rozmowa A — sofa", "Druga wiadomość A", "Odpowiedź: Druga wiadomość A", "Trzecia wiadomość A", "Odpowiedź: Trzecia wiadomość A"]);

  const loaded = await (await context.request.get(`/api/conversations?id=${firstId}`)).json();
  const retry = await context.request.post("/api/agent", { data: { mode: "chat", conversationId: firstId, messages: [loaded.conversation.messages.at(-2)] } });
  expect(retry.status()).toBe(200);
  await retry.text();
  await page.reload();
  await expect(page.locator(".message")).toHaveCount(6);
  await page.getByRole("link", { name: "Historia", exact: true }).click();
  await expect(page.locator(".history-item")).toHaveCount(2);
  await expect(page.locator(".history-item").last()).toContainText("Wiadomości: 6");
  await page.screenshot({ path: "test-results/history-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: "test-results/history-mobile.png", fullPage: true });
  await page.getByRole("link", { name: /Rozmowa B — fotel/ }).click();
  await page.reload();
  await expect(page.locator(".message p")).toHaveText(["Rozmowa B — fotel", "Odpowiedź: Rozmowa B — fotel"]);

  const owner = (await context.cookies()).find(cookie => cookie.name === "chat_owner");
  await context.clearCookies({ name: "chat_owner" });
  await context.addCookies([{ ...owner, value: "c".repeat(64) }]);
  expect((await context.request.get(`/api/conversations?id=${firstId}`)).status()).toBe(404);
  expect((await context.request.delete(`/api/conversations?id=${firstId}`)).status()).toBe(404);
  expect((await (await context.request.get("/api/conversations?list=1")).json()).conversations).toEqual([]);
  await context.addCookies([owner]);
  await page.goto("/history");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Usuń rozmowę: Rozmowa A — sofa", exact: true }).click();
  await expect(page.locator(".history-item")).toHaveCount(2);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Usuń rozmowę: Rozmowa A — sofa", exact: true }).click();
  await expect(page.locator(".history-item")).toHaveCount(1);
  await expect(page.locator(".history-title")).toHaveText(["Rozmowa B — fotel"]);
  await page.reload();
  await expect(page.locator(".history-item")).toHaveCount(1);
  expect((await context.request.get(`/api/conversations?id=${firstId}`)).status()).toBe(404);
  expect((await (await context.request.get(`/api/conversations?id=${secondId}`)).json()).conversation.messages).toHaveLength(2);
});
