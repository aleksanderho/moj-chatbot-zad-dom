import {test,expect} from "@playwright/test";

test("etykieta i dokładny fragment tylko wykorzystanego źródła",async({page})=>{
 await page.route("**/api/conversations**",route=>route.fulfill({json:{conversation:{id:"78b55ab0-dab5-4e4d-a784-890674f579ef",messages:[{id:"answer",role:"assistant",parts:[
 {type:"tool-searchKnowledge",toolCallId:"s",state:"output-available",input:{question:"Cena i rabat?"},output:{ok:true,fragments:[
 {sourceId:"s-0",title:"Cennik",content:"Pakiet Start kosztuje 490 zł netto miesięcznie.\nDokładny tekst źródła.",similarity:0.6683},
 {sourceId:"s-1",title:"Niewykorzystany",content:"Inny temat.",similarity:0.8},
 {sourceId:"s-2",title:"Słabe dopasowanie",content:"Inny temat.",similarity:0.2}]}},
 {type:"text",text:"Start kosztuje 490 zł netto miesięcznie. [[kb:s-0]] O rabacie: Nie mam tej informacji w bazie wiedzy. 📎 Źródło: Cennik"}
 ]}]}}}));
 await page.goto("/");
 await expect(page.getByText("1. 📚 baza wiedzy",{exact:true})).toBeVisible();
 await expect(page.getByText("Podobieństwo: 66,8%",{exact:true})).toBeVisible();
 await expect(page.getByText("Niewykorzystany",{exact:true})).toHaveCount(0);
 await expect(page.getByText("Słabe dopasowanie",{exact:true})).toHaveCount(0);
 await expect(page.locator(".knowledge-sources blockquote")).not.toBeVisible();
 await page.getByText("Pokaż fragment",{exact:true}).click();
 await expect(page.locator(".knowledge-sources blockquote")).toHaveText("Pakiet Start kosztuje 490 zł netto miesięcznie.\nDokładny tekst źródła.");
 await expect(page.locator(".knowledge-sources blockquote")).toBeVisible();
 await page.getByText("Pokaż fragment",{exact:true}).click();
 await expect(page.locator(".knowledge-sources blockquote")).not.toBeVisible();
 await page.setViewportSize({width:390,height:844});
 await page.getByText("Pokaż fragment",{exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:"test-results/knowledge-sources.png",fullPage:true});
});
