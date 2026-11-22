import { test, expect } from "@playwright/test";

test("lista, etapy, blokada wysyłki, potwierdzenia i błąd", async ({page,context})=>{
  await context.request.post("/api/travel/session");
  const document={id:10,title:"Cennik",created_at:"2026-11-22T10:00:00Z",chunks:2};
  let documents=[document],deletes=0;
  await page.route("**/api/documents",async route=>{
    if(route.request().method()==="DELETE") {deletes++;documents=[];await route.fulfill({json:{ok:true}});return;}
    await route.fulfill({json:{documents}});
  });
  await page.addInitScript(()=>{
    const original=window.fetch;
    window.fetch=async (url,options)=>{
      if(String(url)==="/api/documents" && options?.method==="POST") {
        const body=JSON.parse(options.body);
        window.importBodies??=[];window.importBodies.push(body);
        const encoder=new TextEncoder();
        const stream=new ReadableStream({async start(controller){
          for(const stage of ["split","embedding","save"]) {
            controller.enqueue(encoder.encode(JSON.stringify({type:"progress",stage})+"\n"));
            await new Promise(resolve=>setTimeout(resolve,500));
            if(body.title==="Błąd" && stage==="embedding") {
              controller.enqueue(encoder.encode(JSON.stringify({type:"error",stage,error:"Sprawdź saldo OpenRouter i spróbuj ponownie."})+"\n"));controller.close();return;
            }
          }
          controller.enqueue(encoder.encode(JSON.stringify({type:"complete",title:body.title,chunks:2})+"\n"));controller.close();
        }});
        return new Response(stream,{headers:{"Content-Type":"application/x-ndjson"}});
      }
      return original(url,options);
    };
  });
  await page.goto("/upload");
  await expect(page.getByRole("heading",{name:"Cennik",exact:true})).toBeVisible();
  await expect(page.getByText("Fragmenty: 2")).toBeVisible();
  await page.getByRole("button",{name:"Dodaj do bazy wiedzy"}).click();
  await expect(page.getByText("Wpisz tytuł dokumentu.")).toBeVisible();
  await page.getByLabel("Tytuł",{exact:true}).fill("Cennik");
  await page.getByLabel("Treść",{exact:true}).fill("Nowa treść.");
  page.once("dialog",dialog=>dialog.dismiss());
  await page.getByRole("button",{name:"Dodaj do bazy wiedzy"}).click();
  expect(await page.evaluate(()=>window.importBodies?.length??0)).toBe(0);
  page.once("dialog",dialog=>dialog.accept());
  await page.getByRole("button",{name:"Dodaj do bazy wiedzy"}).click();
  for(const label of ["Dzielę tekst…","Tworzę embeddingi…","Zapisuję…"]) {
    await expect(page.getByRole("status")).toHaveText(label);
    await expect(page.getByRole("button",{name:"Operacja w toku…"})).toBeDisabled();
  }
  await expect(page.getByRole("status")).toHaveText("Zapisano dokument „Cennik”: 2 fragmentów");
  expect(await page.evaluate(()=>window.importBodies[0].expected)).toEqual([{id:10,created_at:document.created_at}]);
  await page.getByLabel("Tytuł",{exact:true}).fill("Błąd");
  await page.getByLabel("Treść",{exact:true}).fill("Zachowaj treść.");
  await page.getByRole("button",{name:"Dodaj do bazy wiedzy"}).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("Etap: Tworzę embeddingi… Sprawdź saldo");
  await expect(page.getByLabel("Treść",{exact:true})).toHaveValue("Zachowaj treść.");
  await expect(page.getByRole("status")).toHaveCount(0);
  for(const width of [1440,768,390,320]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.screenshot({path:"test-results/upload-versions-mobile.png",fullPage:true});
  page.once("dialog",dialog=>dialog.dismiss());
  await page.getByRole("button",{name:"Usuń: Cennik"}).click();
  expect(deletes).toBe(0);
  page.once("dialog",dialog=>dialog.accept());
  await page.getByRole("button",{name:"Usuń: Cennik"}).click();
  await expect(page.getByText("Nie dodano jeszcze dokumentów.")).toBeVisible();
  expect(deletes).toBe(1);
});

test("brak sesji chroni stronę i wszystkie operacje",async({page,request})=>{
  await page.goto("/upload");await expect(page).toHaveURL(/session=expired/);
  expect((await request.get("/api/documents")).status()).toBe(401);
  expect((await request.post("/api/documents",{data:{title:"X",text:"Y"}})).status()).toBe(401);
  expect((await request.delete("/api/documents",{data:{id:10}})).status()).toBe(401);
});
