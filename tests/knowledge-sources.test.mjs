import test from "node:test";
import assert from "node:assert/strict";
import { knowledgeSources, withoutKnowledgeMarkers } from "../app/knowledge-sources.ts";
import { KNOWLEDGE_MIN_SIMILARITY } from "../lib/knowledge-config.ts";

const fragments=[
 {sourceId:"s-0",title:"Cennik",content:"Plan kosztuje 490 zł.\nCena netto.",similarity:0.67},
 {sourceId:"s-1",title:"Regulamin",content:"Inny fragment.",similarity:0.8},
 {sourceId:"s-2",title:"Słaby",content:"Nieistotny.",similarity:KNOWLEDGE_MIN_SIMILARITY-0.01},
];
test("źródła to tylko cytowane, wystarczająco podobne wyniki narzędzia",()=>{
 const parts=[{type:"tool-searchKnowledge",toolCallId:"s",state:"output-available",input:{},output:{ok:true,fragments}}, {type:"text",text:"490 zł. [[kb:s-0]] Brak informacji o rabacie. [[kb:s-2]] [[kb:fake]]"}];
 assert.deepEqual(knowledgeSources(parts),[fragments[0]]);
 assert.deepEqual(knowledgeSources([{type:"text",text:"[[kb:s-0]]"}]),[]);
 assert.equal(withoutKnowledgeMarkers("Cena [[kb:s-0]]"),"Cena ");
 assert.equal(withoutKnowledgeMarkers("Cena [[kb:s-"),"Cena ");
});
