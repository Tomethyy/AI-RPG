import { test } from "node:test";
import assert from "node:assert/strict";
import { newGame, migrate, publicState, SCHEMA_VERSION } from "../src/schema.js";
import { applyNewFacts, findEntity, relevantEntities } from "../src/ledger.js";
import { validateTurn, costUSD, buildPrompt, OUTPUT_SCHEMA } from "../src/ai.js";

const good = () => ({
  narration: ["You ask. She answers.", ""],
  options: [
    { text: "Ask about the satchel", kind: "social", stat: "wits", difficulty: 30 },
    { text: "Ask about the satchel", kind: "social", stat: "wits", difficulty: 10 },
    { text: "Check the stable", kind: "explore", stat: "luck", difficulty: 2 },
    { text: "Leave", kind: "weird", stat: "grit", difficulty: 12 },
  ],
  classification: "allowed",
  state_changes: [{ actor: "pc", kind: "hp", amount: -2, text: "", reason: "cut" }, { actor: "ghost", kind: "hp", amount: 5, text: "", reason: "" }],
  new_facts: [{ entity: "Maren", type: "npc", fact: "Sews seals", location: "", was: "" }, { entity: "", type: "npc", fact: "x", location: "", was: "" }],
  quest_flags: ["met_maren"],
});

test("validateTurn normalizes and clamps", () => {
  const { turn, errors } = validateTurn(good(), newGame());
  assert.deepEqual(errors, []);
  assert.equal(turn.narration.length, 1);
  assert.equal(turn.options.length, 3); // duplicate dropped
  assert.equal(turn.options[0].difficulty, 18);
  assert.equal(turn.options[1].difficulty, 6);
  assert.equal(turn.options[1].stat, "wits");
  assert.equal(turn.options[2].kind, "other");
  assert.equal(turn.state_changes.length, 1); // unknown actor dropped
  assert.equal(turn.new_facts.length, 1);
});

test("validateTurn rejects too few options and empty narration", () => {
  const raw = { ...good(), narration: [], options: good().options.slice(0, 2) };
  const { turn, errors } = validateTurn(raw, newGame());
  assert.equal(turn, null);
  assert.equal(errors.length, 2);
  assert.equal(validateTurn(null, newGame()).turn, null);
});

test("new_facts create, dedupe and link entities", () => {
  const s = newGame();
  const added = applyNewFacts(s, [
    { entity: "Maren", type: "npc", fact: "Sews seals onto satchels", location: "" },
    { entity: "maren", type: "npc", fact: "sews seals onto satchels.", location: "Gull's Landing" },
    { entity: "Gull's Landing", type: "location", fact: "Ferry landing", location: "Rusted Ford" },
  ], 2);
  assert.equal(added, 2);
  const maren = findEntity(s, "Maren");
  assert.equal(maren.facts.length, 1);
  const gull = findEntity(s, "Gull's Landing", "location");
  assert.equal(maren.location_id, gull.id);
  assert.ok(gull.connections.includes("location-the-rusted-ford"));
  assert.ok(s.ledger.entities["location-the-rusted-ford"].connections.includes(gull.id));
});

test("retrieval ranks the current place first and matches whole words only", () => {
  const s = newGame();
  for (let i = 0; i < 30; i++) applyNewFacts(s, [{ entity: `Drover ${i}`, type: "npc", fact: "Drinks", location: "The Rusted Ford" }], 2);
  applyNewFacts(s, [{ entity: "Ash", type: "item", fact: "grey", location: "Far Hill" }], 2);
  const list = relevantEntities(s, "I poke the ashes");
  assert.equal(list.length, 20);
  assert.ok(!list.some((e) => e.name === "Ash"));
  assert.equal(list[0].name, "The Rusted Ford");
  assert.ok(relevantEntities(s, "Ask Drover 7 about the ash").slice(0, 3).some((e) => e.name === "Ash"));
});

test("prompt size stays flat as the ledger grows", () => {
  const s = newGame();
  const size = () => JSON.stringify(buildPrompt(s, { kind: "custom", text: "Look" }, null)).length;
  const before = size();
  for (let i = 0; i < 500; i++) applyNewFacts(s, [{ entity: `Thing ${i}`, type: "lore", fact: "A fact ".repeat(10), location: "" }], i);
  for (let i = 0; i < 50; i++) applyNewFacts(s, [{ entity: `Local ${i}`, type: "npc", fact: "fact ".repeat(20) + i, location: "The Rusted Ford" }], i);
  assert.ok(size() < before + 6000, `prompt grew from ${before} to ${size()}`);
});

test("cost and schema basics", () => {
  assert.equal(costUSD("claude-sonnet-5-5", { input_tokens: 1e6 }), 2);
  assert.equal(costUSD("claude-haiku-5-5", { output_tokens: 1e6 }), 0.5);
  assert.equal(OUTPUT_SCHEMA.additionalProperties, false);
  assert.equal(migrate(newGame()).v, SCHEMA_VERSION);
  assert.throws(() => migrate({ v: SCHEMA_VERSION + 1 }));
  const pub = publicState(newGame());
  assert.equal(typeof pub.scene.options[0], "string"); // no stats or difficulty leak to the phone
});
