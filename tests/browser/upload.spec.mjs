import { test, expect } from "@playwright/test";

test("formularz: walidacja, sukces, błąd i układ mobilny", async ({ page, context }) => {
  await context.request.post("/api/travel/session");
  let writes = 0;
  await page.route("**/api/documents", async route => {
    writes++;
    const body = route.request().postDataJSON();
    await route.fulfill({ status: writes === 1 ? 201 : 503, contentType: "application/json", body: JSON.stringify(writes === 1 ? { title:body.title, chunks:2 } : {error:"Nie udało się zapisać dokumentu. Spróbuj ponownie za chwilę."}) });
  });
  await page.goto("/upload");
  await page.getByRole("button",{name:"Dodaj do bazy wiedzy"}).click();
  await expect(page.getByText("Wpisz tytuł dokumentu.")).toBeVisible();
  await expect(page.getByText("Wklej treść dokumentu.", {exact:true})).toBeVisible();
  expect(writes).toBe(0);
  await page.getByLabel("Tytuł",{exact:true}).fill("Cennik");
  await page.getByLabel("Treść",{exact:true}).fill("Pierwszy akapit.\n\nDrugi akapit.");
  await page.getByRole("button",{name:"Dodaj do bazy wiedzy"}).click();
  await expect(page.getByRole("status")).toHaveText("Zapisano dokument „Cennik”: 2 fragmentów");
  await page.getByLabel("Tytuł",{exact:true}).fill("Inny dokument");
  await page.getByLabel("Treść",{exact:true}).fill("Treść do zachowania.");
  await page.getByRole("button",{name:"Dodaj do bazy wiedzy"}).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("Nie udało się zapisać");
  await expect(page.getByLabel("Treść",{exact:true})).toHaveValue("Treść do zachowania.");
  await expect(page.getByLabel("Treść",{exact:true})).toHaveAttribute("maxlength","20000");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole("button",{name:"Dodaj do bazy wiedzy"})).toBeVisible();
  }
  await page.screenshot({path:"test-results/upload-mobile.png",fullPage:true});
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:"test-results/upload-desktop.png",fullPage:true});
  await page.getByRole("link",{name:"Wróć do czatu"}).click();
  await expect(page.getByRole("link",{name:"Baza wiedzy"})).toHaveAttribute("href","/upload");
});

test("bez sesji: przekierowanie strony i 401 endpointu", async ({page,request}) => {
  await page.goto("/upload");
  await expect(page).toHaveURL(/session=expired/);
  expect((await request.post("/api/documents",{data:{title:"X",text:"Y"}})).status()).toBe(401);
});


