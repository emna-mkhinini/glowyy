import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "../src/agent.js";
import { toolImplementations, findIngredient } from "../src/tools.js";
import { createApp } from "../src/index.js";

// Fake Gemini client: returns the scripted responses in order and records each request.
function fakeAi(script) {
  const calls = [];
  return {
    calls,
    models: {
      async generateContent(req) {
        calls.push(structuredClone(req.contents));
        const next = script.shift();
        if (next.functionCalls) {
          return { functionCalls: next.functionCalls,
            candidates: [{ content: { role: "model", parts: next.functionCalls.map((fc) => ({ functionCall: fc })) } }] };
        }
        return { functionCalls: undefined, text: next.text };
      },
    },
  };
}

test("findIngredient matches aliases without accents", () => {
  assert.equal(findIngredient("Retinol").id, "retinol");
  assert.equal(findIngredient("acide azelaique").id, "azelaic_acid");
  assert.equal(findIngredient("BHA").id, "salicylic_acid");
  assert.equal(findIngredient("inconnu-xyz"), null);
});

test("compatibility flags retinol + glycolic acid", () => {
  const r = toolImplementations.check_ingredient_compatibility({ ingredients: ["rétinol", "acide glycolique", "niacinamide"] });
  assert.equal(r.compatible, false);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].severity, "high");
});

test("routine for oily acne-prone skin uses salicylic acid and SPF", () => {
  const r = toolImplementations.build_skincare_routine({ skin_type: "grasse", concerns: ["acne", "taches"] });
  assert.ok(r.night.some((s) => s.active?.includes("salicylique")));
  assert.ok(r.morning.at(-1).product.includes("SPF"));
  assert.ok(r.compatibility); // vitamin C + salicylic checked
});

test("routine avoids retinol for sensitive or pregnant users", () => {
  const sensitive = toolImplementations.build_skincare_routine({ skin_type: "sensible", concerns: ["rides"] });
  const pregnant = toolImplementations.build_skincare_routine({ skin_type: "normale", concerns: ["rides"], pregnant: true });
  for (const r of [sensitive, pregnant]) {
    assert.ok(!JSON.stringify(r.night).includes("Rétinol"));
    assert.ok(JSON.stringify(r.night).includes("Bakuchiol"));
  }
});

test("warning signs detect a changing mole and allergic swelling", () => {
  assert.equal(toolImplementations.check_warning_signs({ symptoms: "Mon grain de beauté saigne" }).see_doctor, true);
  assert.equal(toolImplementations.check_warning_signs({ symptoms: "lèvres gonflées après une crème" }).urgency, "urgence");
  assert.equal(toolImplementations.check_warning_signs({ symptoms: "peau un peu terne" }).see_doctor, false);
});

test("agent executes a tool call then returns the final answer", async () => {
  const ai = fakeAi([
    { functionCalls: [{ id: "c1", name: "build_skincare_routine", args: { skin_type: "mixte", concerns: ["pores"] } }] },
    { text: "Voici ta routine !" },
  ]);
  const out = await runAgent({ ai, model: "test", history: [{ role: "assistant", text: "Salut" }], message: "Routine peau mixte" });
  assert.equal(out.reply, "Voici ta routine !");
  assert.deepEqual(out.toolsUsed.map((t) => t.name), ["build_skincare_routine"]);
  const second = ai.calls[1];
  assert.equal(second[0].role, "model");                           // history mapped to Gemini roles
  const fnResponse = second.at(-1).parts[0].functionResponse;
  assert.equal(fnResponse.name, "build_skincare_routine");
  assert.ok(fnResponse.response.morning.length > 0);
});

test("agent sends the image as inlineData", async () => {
  const ai = fakeAi([{ text: "Je vois un peu de brillance." }]);
  await runAgent({ ai, model: "test", message: "", image: { mimeType: "image/jpeg", data: "AAAA" } });
  const parts = ai.calls[0].at(-1).parts;
  assert.equal(parts[0].inlineData.mimeType, "image/jpeg");
  assert.ok(parts[1].text.length > 0);
});

test("POST /api/chat returns the agent reply", async () => {
  const ai = fakeAi([{ text: "Bonjour !" }]);
  const server = createApp({ ai, model: "test" }).listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Salut", history: [] }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).reply, "Bonjour !");
    const bad = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: " " }),
    });
    assert.equal(bad.status, 400);
  } finally {
    server.close();
  }
});
