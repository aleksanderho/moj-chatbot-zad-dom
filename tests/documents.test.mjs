import test from "node:test";
import assert from "node:assert/strict";
import { GET, POST, DELETE } from "../app/api/documents/route.ts";
import { splitDocument } from "../lib/document-chunks.ts";
import { issueSession } from "../app/travel-session.mjs";

test("podział zachowuje akapity i granice zdań", () => {
  assert.deepEqual(splitDocument(" Jeden.\r\n\r\nDwa.\n \nTrzy. "),["Jeden.","Dwa.","Trzy."]);
  const text="To jest zdanie o cenie pakietu. ".repeat(40).trim();
  const chunks=splitDocument(text);
  assert.ok(chunks.every(c=>c.length<=800 && c.endsWith(".")));
  assert.equal(chunks.join(" "),text);
});

test("sesja, lista, potwierdzenie, jeden embedMany, etapy i atomowy zapis", async () => {
  process.env.TRAVEL_SESSION_SECRET="test-session";
  process.env.SUPABASE_URL="https://database.example.test";
  process.env.SUPABASE_SECRET_KEY="test-secret";
  process.env.OPENROUTER_API_KEY="test-key";
  process.env.OPENROUTER_EMBEDDING_MODEL="openai/text-embedding-3-small";
  const old={id:10,title:"Cennik",created_at:"2026-11-22T10:00:00+00:00",chunks:[{count:2}]};
  const original=globalThis.fetch;
  let calls=[], failModel=false, failSave=false, conflict=false, missing=false;
  globalThis.fetch=async (input,options={})=>{
    const url=new URL(typeof input==="string"?input:input.url??String(input));
    const body=options.body?JSON.parse(options.body):null;
    calls.push({url,body,method:options.method});
    if(url.hostname!=="database.example.test") {
      assert.equal(body.model,process.env.OPENROUTER_EMBEDDING_MODEL);
      if(failModel) return Response.json({error:{message:"failed"}},{status:503});
      return Response.json({object:"list",model:body.model,data:body.input.map((_,index)=>({object:"embedding",index,embedding:Array(1536).fill(index+1)})),usage:{prompt_tokens:10,total_tokens:10}});
    }
    if(url.pathname.endsWith("/documents")) return Response.json(url.searchParams.has("id")?[]:[old]);
    if(url.pathname.endsWith("/chunks")) {
      return Response.json(url.searchParams.has("id")?[]:[{id:11,document_id:10,content:"Stara wersja."},{id:12,document_id:20,content:"Zaległy fragment."}]);
    }
    if(url.pathname.endsWith("/save_knowledge_document")) {
      if(failSave) return Response.json({code:missing?"PGRST202":"P0001",message:conflict?"knowledge_version_conflict":"save failed"},{status:400});
      return Response.json({documentId:30,title:body.p_title,chunks:body.p_chunks.length});
    }
    if(url.pathname.endsWith("/delete_knowledge_document")) return Response.json(true);
    throw new Error("Unexpected request");
  };
  const request=(method,body,session=true,stream=false)=>new Request("http://localhost/api/documents",{method,headers:{...(session?{cookie:`travel_session=${issueSession()}`} : {}),...(stream?{accept:"application/x-ndjson"}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const input={title:"Cennik",text:"Pierwszy.\n\nDrugi.",expected:[{id:old.id,created_at:old.created_at}]};
  try {
    for(const [method,handler] of [["GET",GET],["POST",POST],["DELETE",DELETE]]) assert.equal((await handler(request(method,undefined,false))).status,401);
    assert.equal(calls.length,0);
    assert.equal((await POST(request("POST",{title:"",text:" "}))).status,400);
    assert.equal(calls.length,0);
    const listing=await (await GET(request("GET"))).json();
    assert.equal(listing.documents[0].chunks,2);
    calls=[];
    const refusal=await POST(request("POST",{title:"Cennik",text:"Nowy."}));
    assert.equal(refusal.status,409);
    assert.equal((await refusal.json()).documents[0].id,10);
    assert.ok(calls.every(c=>c.method==="GET"));
    calls=[];
    const response=await POST(request("POST",input,true,true));
    const events=(await response.text()).trim().split("\n").map(JSON.parse);
    assert.deepEqual(events.filter(e=>e.type==="progress").map(e=>e.stage),["split","embedding","save"]);
    assert.equal(events.at(-1).type,"complete");
    const model=calls.filter(c=>c.url.hostname!=="database.example.test");
    assert.equal(model.length,1);
    assert.deepEqual(model[0].body.input,["Pierwszy.","Drugi.","Zaległy fragment."]);
    const save=calls.find(c=>c.url.pathname.endsWith("/save_knowledge_document")).body;
    assert.deepEqual(save.p_expected,input.expected);
    assert.equal(save.p_chunks[1].embedding[0],2);
    assert.equal(save.p_pending[0].id,12);
    assert.equal(save.p_pending[0].embedding[0],3);
    assert.ok(!calls.some(c=>["PATCH","DELETE"].includes(c.method)));
    calls=[];failModel=true;
    const failure=(await (await POST(request("POST",input,true,true))).text()).trim().split("\n").map(JSON.parse);
    assert.equal(failure.at(-1).stage,"embedding");
    assert.equal(failure.at(-1).type,"error");
    assert.ok(!calls.some(c=>c.url.pathname.includes("/rpc/")));
    failModel=false;failSave=true;
    assert.equal((await POST(request("POST",input))).status,503);
    conflict=true;
    assert.equal((await POST(request("POST",input))).status,409);
    conflict=false;missing=true;
    assert.match((await (await POST(request("POST",input))).json()).error,/migrację/);
    calls=[];
    assert.equal((await DELETE(request("DELETE",input.expected[0]))).status,200);
    assert.equal(calls[0].body.p_id,10);
    assert.equal(calls[0].body.p_created_at,old.created_at);
  } finally {globalThis.fetch=original;}
});
