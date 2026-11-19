import test from "node:test";
import assert from "node:assert/strict";
import { usedToolLabels } from "../app/tool-labels.ts";

const step = { type: "step-start" };
const tool = (name, id) => ({ type: `tool-${name}`, toolCallId: id, state: "output-available", input: {}, output: { ok: true } });
const source = id => ({ type: "source-url", sourceId: id, url: `https://example.org/${id}` });

test("etykiety zachowują kolejność i powtórne wywołania tego samego narzędzia", () => {
  assert.deepEqual(usedToolLabels([
    step, tool("aktualnyCzas", "t1"), step, tool("kalkulator", "t2"),
    step, tool("kalkulator", "t3"), step, tool("generujObraz", "t4"),
  ]), [
    { id: "t1", name: "aktualnyCzas" }, { id: "t2", name: "kalkulator" },
    { id: "t3", name: "kalkulator" }, { id: "t4", name: "generujObraz" },
  ]);
});

test("native search jest przed tworzeniem obrazu; kilka źródeł daje jedną etykietę w kroku", () => {
  assert.deepEqual(usedToolLabels([step, source("a"), source("b"), step, tool("generujObraz", "i1"), step, source("c")]).map(item => item.name), ["webSearch", "generujObraz", "webSearch"]);
});

test("jawne wyszukiwanie i jego źródła nie tworzą podwójnej etykiety", () => {
  assert.deepEqual(usedToolLabels([step, tool("webSearch", "s1"), source("a"), source("b")]), [{ id: "s1", name: "webSearch" }]);
  assert.deepEqual(usedToolLabels([{ type: "text", text: "Dzień dobry" }]), []);
});
