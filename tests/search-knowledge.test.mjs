import test from "node:test";
import assert from "node:assert/strict";
import { createSearchKnowledgeTool } from "../lib/search-knowledge.ts";
import { createTaskBudget } from "../app/api/chat/task-budget.mjs";
import { issueSession } from "../app/travel-session.mjs";
import { POST } from "../app/api/agent/route.ts";
import { systemPrompt } from "../app/api/chat/instructions.mjs";

test("searchKnowledge: sesja, model, RPC, kolejność, pusta baza i błędy", async () => {
  process.env.TRAVEL_SESSION_SECRET="test-session";
  process.env.OPENROUTER_API_KEY="test-key";
  process.env.OPENROUTER_EMBEDDING_MODEL="openai/text-embedding-3-small";
  process.env.SUPABASE_URL="https://database.example.test";
  process.env.SUPABASE_SECRET_KEY="test-secret";
  const original=globalThis.fetch;
  const calls=[];
  let fail=false,empty=false,dimension=1536;
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(typeof input==="string"?input:input.url??String(input));
    const body=JSON.parse(options.body);
    calls.push({url,body});
    if(url.hostname!=="database.example.test") {
      assert.equal(body.model,"openai/text-embedding-3-small");
      assert.deepEqual(body.input,["Ile kosztuje plan?"]);
      return Response.json({object:"list",model:body.model,data:[{object:"embedding",index:0,embedding:Array(dimension).fill(0.1)}],usage:{prompt_tokens:5,total_tokens:5}});
    }
    assert.equal(url.pathname,"/rest/v1/rpc/match_chunks");
    assert.equal(body.match_count,3);
    assert.equal(body.query_embedding.length,1536);
    assert.equal(url.searchParams.get("similarity"),"not.is.null");
    if(fail)return Response.json({message:"secret error details"},{status:500});
    return Response.json(empty?[]:[{title:"Regulamin",content:"Zasady.",similarity:0.5},{title:"Cennik",content:"Plan kosztuje 490 zł.",similarity:0.9},{title:"Oferta",content:"Plan Start.",similarity:0.7}]);
  };
  const budget=createTaskBudget();
  const request=new Request("http://localhost/api/agent",{headers:{cookie:`travel_session=${issueSession()}`}});
  const invoke=(req=request)=>createSearchKnowledgeTool(req,budget).execute({question:"Ile kosztuje plan?"});
  try {
    assert.equal((await POST(new Request("http://localhost/api/agent",{method:"POST",body:"bad"}))).status,401);
    assert.equal((await invoke(new Request("http://localhost"))).ok,false);
    assert.equal(calls.length,0);
    const result=await invoke();
    assert.equal(result.ok,true);
    assert.deepEqual(result.fragments.map(f=>f.title),["Cennik","Oferta","Regulamin"]);
    assert.equal(calls.length,2);
    empty=true; assert.deepEqual((await invoke()).fragments,[]);
    empty=false;fail=true;
    const failure=await invoke(); assert.equal(failure.ok,false);assert.ok(!failure.message.includes("secret"));
    fail=false;dimension=2;calls.length=0;
    assert.equal((await invoke()).ok,false);assert.equal(calls.length,1);
  } finally {budget.dispose();globalThis.fetch=original;}
});

test("instrukcja wymaga źródeł i zakazuje uzupełniania faktów o firmie",()=>{
  const prompt=systemPrompt();
  assert.match(prompt,/przy KAŻDYM|Przy KAŻDYM/);
  assert.match(prompt,/Nie mam tej informacji w bazie wiedzy/);
  assert.match(prompt,/📎 Źródło/);
  assert.match(prompt,/Nie używaj webSearch do pytań o firmę/);
  assert.match(prompt,/Fragment na podobny temat to jeszcze nie odpowiedź/);
  assert.ok(!prompt.includes("BLIK, Przelewy24"));
});
