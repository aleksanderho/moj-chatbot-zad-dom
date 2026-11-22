import { test, expect } from "@playwright/test";

test("źródła przechodzą przez zapis, F5, historię i ponowienie odpowiedzi", async ({page,context})=>{
 await page.goto("/?new=1");
 await expect(page.getByRole("button",{name:"Nowa rozmowa",exact:true})).toBeEnabled();
 await page.getByLabel("Wiadomość klienta",{exact:true}).fill("Jaka jest cena planu w bazie?");
 await page.getByRole("button",{name:"Wyślij",exact:true}).click();
 await expect(page.getByText("Podobieństwo: 67,9%",{exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"Nowa rozmowa",exact:true})).toBeEnabled();
 const id=new URL(page.url()).searchParams.get("conversation");
 const loaded=await (await context.request.get(`/api/conversations?id=${id}`)).json();
 const source=loaded.conversation.messages.at(-1).metadata.knowledgeSources[0];
 expect(source).toMatchObject({title:"Cennik",similarity:0.6789,content:"Plan kosztuje 490 zł netto.\nWersja dokumentu z dnia zakupu."});
 await page.reload();
 await expect(page.getByText("1. 📚 baza wiedzy",{exact:true})).toBeVisible();
 await expect(page.getByText("Podobieństwo: 67,9%",{exact:true})).toBeVisible();
 await page.getByText("Pokaż fragment",{exact:true}).click();
 await expect(page.locator(".knowledge-sources blockquote")).toHaveText(source.content);
 await expect(page.locator(".knowledge-sources blockquote")).toBeVisible();
 const replay=await context.request.post("/api/agent",{data:{mode:"chat",conversationId:id,messages:[loaded.conversation.messages.at(-2)]}});
 const stream=await replay.text();
 expect(stream).toContain('"knowledgeSources"');
 expect(stream).toContain('"similarity":0.6789');
 await page.getByRole("link",{name:"Historia",exact:true}).click();
 await page.getByRole("link",{name:/Jaka jest cena planu w bazie/}).click();
 await expect(page.getByText("Podobieństwo: 67,9%",{exact:true})).toBeVisible();
});
