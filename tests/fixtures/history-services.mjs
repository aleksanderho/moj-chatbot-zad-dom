// Ładowane wyłącznie przez testowy serwer Playwright, nigdy przez aplikację.
const conversations = [];
const messages = [];
const profile = { id: 1, name: null, preferences: {} };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
  if (url.hostname === "openrouter.ai") {
    const body = JSON.parse(options.body);
    if (url.pathname.endsWith("/embeddings")) return Response.json({ object: "list", model: body.model, data: [{ object: "embedding", index: 0, embedding: Array(1536).fill(0.1) }], usage: { prompt_tokens: 5, total_tokens: 5 } });
    const last = body.messages.at(-1);
    const systemContent = body.messages[0].content;
    const systemText = typeof systemContent === "string" ? systemContent : systemContent.map(part => part.text ?? "").join("\n");
    const text = typeof last.content === "string" ? last.content : last.content.filter(part => part.type === "text").map(part => part.text).join("");
    let content = `Odpowiedź: ${text}`;
    const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: "mock-reply", object: "chat.completion.chunk", model: "test/model", created: 1, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    if (last.role === "user" && text === "Jaka jest cena planu w bazie?") {
      return new Response(chunk({ role: "assistant", tool_calls: [{ index: 0, id: "knowledge-call", type: "function", function: { name: "searchKnowledge", arguments: JSON.stringify({ question: text }) } }] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
    }
    if (last.role === "user" && text === "Mam na imię Ola.") {
      if (!body.tools.some(tool => tool.function?.name === "zapiszProfil")) throw new Error("Brak narzędzia profilu");
      return new Response(chunk({ role: "assistant", tool_calls: [{ index: 0, id: "profile-call", type: "function", function: { name: "zapiszProfil", arguments: JSON.stringify({ name: "Ola", nameQuote: text, preferences: [] }) } }] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
    }
    if (last.role === "user" && text === "Lubię pierogi.") {
      return new Response(chunk({ role: "assistant", tool_calls: [{ index: 0, id: "food-call", type: "function", function: { name: "zapiszProfil", arguments: JSON.stringify({ preferences: [{ key: "ulubione_jedzenie", value: "pierogi", quote: text }] }) } }] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
    }
    if (last.role === "tool") {
      const result = JSON.parse(last.content);
      if (result.ok && result.fragments) {
        content = `Plan kosztuje 490 zł netto. [[kb:${result.fragments[0].sourceId}]] 📎 Źródło: Cennik`;
      } else if (result.ok) {
        if (result.remembered.name && !systemText.includes('"name":"Ola"')) throw new Error("Profil nie został odświeżony po narzędziu");
        content = result.remembered.name ? "Zapamiętałem: imię — Ola." : "Zapamiętałem: ulubione jedzenie — pierogi.";
      } else content = "Nie zapisano profilu.";
    }
    if (last.role === "user" && text === "Jak mam na imię?") {
      if (!systemText.includes('"name":"Ola"')) throw new Error("Brak profilu w nowej rozmowie");
      content = "Masz na imię Ola.";
    }
    return new Response(chunk({ role: "assistant", content: content.slice(0, 10) }) + chunk({ content: content.slice(10) }) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
  }
  if (url.hostname !== "database.example.test") return realFetch(input, options);
  const table = url.pathname.split("/").at(-1);
  if (table === "match_chunks") return Response.json([{ title: "Cennik", content: "Plan kosztuje 490 zł netto.\nWersja dokumentu z dnia zakupu.", similarity: 0.6789 }]);
  if (table === "user_profiles") {
    let matches = true;
    const expected = url.searchParams.get("preferences");
    if (expected) matches = JSON.stringify(profile.preferences) === expected.slice(3);
    if (options.method === "PATCH" && matches) Object.assign(profile, JSON.parse(options.body));
    return Response.json(new Headers(options.headers).get("accept")?.includes("vnd.pgrst.object") ? profile : matches ? [profile] : []);
  }
  if (table === "save_user_profile") {
    const body = JSON.parse(options.body);
    profile.name = body.p_name ?? profile.name;
    Object.assign(profile.preferences, body.p_preferences);
    return Response.json(profile);
  }
  if (table === "delete_owned_conversation") {
    const body = JSON.parse(options.body);
    const index = conversations.findIndex(row => row.id === body.p_conversation_id && row.owner_id === body.p_owner_id);
    if (index === -1) return Response.json(false);
    conversations.splice(index, 1);
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].conversation_id === body.p_conversation_id) messages.splice(i, 1);
    return Response.json(true);
  }
  const records = table === "conversations" ? conversations : messages;
  if (options.method === "POST") {
    const body = JSON.parse(options.body);
    const values = Array.isArray(body) ? body : [body];
    for (const value of values) {
      if (records.some(row => row.id === value.id)) continue;
      records.push({ ...value, created_at: new Date(Date.now() + records.length).toISOString(), position: records.length + 1 });
    }
    return new Response(null, { status: 201 });
  }
  let selected = records.filter(row => [...url.searchParams].every(([key, value]) => !value.startsWith("eq.") || String(row[key]) === value.slice(3)));
  const order = url.searchParams.get("order");
  if (order) {
    const [column, direction] = order.split(",")[0].split(".");
    selected = selected.toSorted((a, b) => (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (direction === "desc" ? -1 : 1));
  }
  const offset = Number(url.searchParams.get("offset") ?? 0);
  selected = selected.slice(offset, url.searchParams.has("limit") ? offset + Number(url.searchParams.get("limit")) : undefined);
  if (url.searchParams.get("select")?.includes("messages(count)")) {
    selected = selected.map(row => ({ ...row, messages: [{ count: messages.filter(message => message.conversation_id === row.id).length }] }));
  }
  return Response.json(selected);
};

