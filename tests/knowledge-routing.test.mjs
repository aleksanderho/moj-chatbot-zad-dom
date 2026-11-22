import test from "node:test";
import assert from "node:assert/strict";
import { requiresKnowledgeSearch, knowledgeStepPolicy } from "../lib/knowledge-routing.ts";
const user = text => ({id:"u",role:"user",parts:[{type:"text",text}]});
test("pytania o ofertę i doprecyzowania wymagają świeżego wyszukiwania mimo wcześniejszego błędu",()=>{
 for(const text of ["Jaka jest cena sofy?","Sofa Bella","Jakie są zasady zwrotu?","Co oferuje firma?"]) assert.equal(requiresKnowledgeSearch([user(text)]),true,text);
 for(const text of ["Bella","140 cm","A z pojemnikiem?"]) assert.equal(requiresKnowledgeSearch([user("Jaka jest cena sofy?"),{id:"a",role:"assistant",parts:[{type:"text",text:"Nie udało się sprawdzić bazy."}]},user(text)]),true,text);
 for(const text of ["Dziękuję","Oblicz 12 razy 3","Jaka pogoda?"]) assert.equal(requiresKnowledgeSearch([user("Cena sofy?"),user(text)]),false,text);
 assert.deepEqual(knowledgeStepPolicy(true,0),{toolChoice:{type:"tool",toolName:"searchKnowledge"}});
 assert.deepEqual(knowledgeStepPolicy(true,1),{});
 assert.deepEqual(knowledgeStepPolicy(false,0),{});
});
