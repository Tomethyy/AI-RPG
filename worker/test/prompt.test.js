import { test } from "node:test";
import assert from "node:assert/strict";
import { newGame, migrate, RECENT_PROMPT } from "../src/schema.js";
import { applyNewFacts, findEntity } from "../src/ledger.js";
import { buildPrompt, BUDGET, estTokens, fit, RULES, rollText } from "../src/prompt.js";
import { WORLD } from "../src/world.js";
import { recordFailure, rollOption } from "../src/rules.js";
import { varyOptions } from "../src/ai.js";
import { summaryDue, summaryJob, adoptSummary, updateSummary, summaryPrompt } from "../src/summary.js";

const opt = (text, kind = "social") => ({ text, kind, stat: "wits", tier: "standard", edge: "none", edge_why: "" });
const record = (n, extra = {}) => ({
  n, action: { kind: "option", text: `Do thing ${n}` }, dice: { die: 10, mod: 1, dc: 10, label: "Wits", result: "success", success: true },
  narration: [`Turn ${n} narration. ` + "The rain keeps falling on the road and the drovers mutter. ".repeat(4)],
  options: [opt(`Option A${n}`), opt(`Option B${n}`, "explore"), opt(`Option C${n}`, "direct")], ...extra,
});

// A save that has been played for a long time: big ledger, long summary, full pack, long recent window.
function longSave(turn = 500) {
  const s = newGame();
  s.turn = turn;
  s.summary = { text: "Ash did many things. ".repeat(200), through_turn: turn - 12, requested_through: 0, requested_at: null };
  for (let i = 0; i < 400; i++) applyNewFacts(s, [{ entity: `Thing ${i}`, type: "lore", fact: "A long fact about it ".repeat(6), location: "", was: "" }], i);
  for (let i = 0; i < 60; i++) applyNewFacts(s, [{ entity: `Local ${i}`, type: "npc", fact: "fact ".repeat(30) + i, location: "The Rusted Ford", was: "" }], i);
  for (let i = 0; i < 40; i++) applyNewFacts(s, [{ entity: "The Rusted Ford", type: "location", fact: `Change number ${i} at the ford`, location: "", was: "" }], i);
  for (let i = 0; i < 80; i++) s.actors.pc.inventory.push({ id: `i${i}`, name: `Curious trinket number ${i}`, qty: 2, note: "" });
  s.recent = Array.from({ length: 12 }, (_, i) => record(turn - 11 + i));
  s.scene.narration = s.recent.at(-1).narration;
  s.scene.options = s.recent.at(-1).options;
  return s;
}

test("every section stays inside its budget, however long the campaign", () => {
  const short = buildPrompt(newGame(), { kind: "custom", text: "Look around" }, null);
  const long = buildPrompt(longSave(), { kind: "custom", text: "x".repeat(300) }, null);
  for (const sec of long.sections) if (sec.budget) assert.ok(sec.tokens <= sec.budget, `${sec.name}: ${sec.tokens} > ${sec.budget}`);
  const cap = Object.values(BUDGET).reduce((a, b) => a + b, 0) + estTokens(RULES) + estTokens(WORLD) + 100;
  assert.ok(long.est.total <= cap, `${long.est.total} > ${cap}`);
  assert.ok(long.est.total < 6500);
  assert.ok(short.est.total < long.est.total);
  // turn 500 and turn 5000 cost the same
  assert.ok(Math.abs(buildPrompt(longSave(5000), { kind: "custom", text: "Look around" }, null).est.total - buildPrompt(longSave(500), { kind: "custom", text: "Look around" }, null).est.total) < 30);
});

test("cache layout: static system prefix, stable summary block, volatile rest", () => {
  const s = longSave(40);
  const a = buildPrompt(s, { kind: "custom", text: "Look around" }, null);
  s.actors.pc.hp = 3;
  const b = buildPrompt(s, { kind: "custom", text: "Climb the wall" }, { die: 3, mod: 0, dc: 12, label: "Might", result: "failure", success: false });
  assert.equal(a.system[0].text, RULES);
  assert.deepEqual(a.system[1].cache_control, { type: "ephemeral" });
  const [stableA, volA] = a.messages[0].content;
  const [stableB, volB] = b.messages[0].content;
  assert.deepEqual(stableA.cache_control, { type: "ephemeral" });
  assert.equal(stableA.text, stableB.text); // hp, action and dice don't break the cache
  assert.notEqual(volA.text, volB.text);
  assert.ok(!stableA.text.includes("HP ") && volB.text.includes("Climb the wall"));
  assert.ok(estTokens(RULES) > 512 / 1.3); // with the world block, above the 512-token cache minimum
  assert.ok(a.system[1].text.includes("The Realm of Calder") && !a.system[1].text.includes("gritty"));
});

test("the prompt carries the character, the three results and the failed approaches", () => {
  const s = newGame("main", undefined, { name: "Wren", background: "hunter", drive: "revenge", flaw: "greedy", law: "chaotic", good: "good", free: { grit: 1, charm: 1 }, talent: "keen-eye" });
  s.turn = 5;
  s.recent = [record(5)];
  const text = (p) => p.messages[0].content[1].text;
  const plain = buildPrompt(s, { kind: "custom", text: "Look around" }, null);
  for (const w of ["Wren", "Hunter", "charm +1", "Chaotic Good", "Drive: Someone wronged you", "Flaw: Greedy", "Keen Eye", "Pack 2/13 slots"]) assert.ok(text(plain).includes(w), w);
  assert.ok(!text(plain).includes("Failed approaches"));
  recordFailure(s, { kind: "option", text: "Pick the lock" }, { result: "failure" });
  assert.ok(text(buildPrompt(s, { kind: "custom", text: "Look around" }, null)).includes("Failed approaches (do not offer again unless something has clearly changed)\nPick the lock"));
  const d = rollOption(s, { text: "x", kind: "explore", stat: "wits", tier: "hard", edge: "advantage", edge_why: "lantern" });
  assert.match(rollText(d), /^d20 \d+ \(advantage, best of \d+ and \d+\) \+\d Wits = \d+ vs difficulty 13: (SUCCESS|FAILURE|SUCCESS AT A COST)/);
  assert.match(rollText({ die: 11, mod: 1, dc: 13, label: "Might", result: "cost" }), /SUCCESS AT A COST/);
  assert.match(rollText({ die: 20, mod: 1, dc: 13, label: "Might", result: "success", crit: 20 }), /NATURAL 20/);
  assert.match(rollText({ die: 5, mod: 1, dc: 13, label: "Might", success: false }), /FAILURE/); // a record from before Phase 5
  for (const w of ["SUCCESS AT A COST", "never decide, feel or speak for the player's character", "tier", "lasting truths", "Pace:"]) assert.ok(RULES.includes(w), w);
});

test("turns since the summary: newest verbatim, the rest in brief, none lost", () => {
  const s = newGame();
  s.turn = 19;
  s.summary.through_turn = 10;
  s.recent = Array.from({ length: 9 }, (_, i) => record(11 + i));
  const p = buildPrompt(s, { kind: "custom", text: "Look around" }, null);
  const brief = p.sections.find((x) => x.name === "Earlier, in brief").text;
  const turns = p.sections.find((x) => x.name === "Earlier turns").text;
  for (const n of [11, 12, 13, 14]) assert.ok(brief.includes(`Turn ${n}.`), `brief misses ${n}`);
  for (const n of [15, 16, 17, 18]) assert.ok(turns.includes(`Turn ${n}.`) && !brief.includes(`Turn ${n}.`), `verbatim misses ${n}`);
  assert.equal(RECENT_PROMPT - 1, 4);
  assert.ok(p.messages[0].content[1].text.includes("Player: Do thing 19")); // the current scene's action
});

test("fit cuts at a boundary and stays in budget", () => {
  const t = fit("word ".repeat(500), 20);
  assert.ok(estTokens(t) <= 20 && t.endsWith("…"));
  assert.equal(fit("short", 20), "short");
});

test("was: a described stranger who gets a name becomes one entity", () => {
  const s = newGame();
  applyNewFacts(s, [{ entity: "The woman by the hearth", type: "npc", fact: "Sews a seal onto a satchel", location: "", was: "" }], 1);
  applyNewFacts(s, [{ entity: "Maren", type: "npc", fact: "Gives her name as Maren", location: "", was: "the woman by the hearth" }], 2);
  const npcs = Object.values(s.ledger.entities).filter((e) => e.type === "npc");
  assert.equal(npcs.length, 1);
  assert.equal(npcs[0].name, "Maren");
  assert.deepEqual(npcs[0].aliases, ["The woman by the hearth"]);
  assert.equal(npcs[0].facts.length, 2);
  assert.equal(findEntity(s, "woman by the hearth").name, "Maren");

  // Both already exist as separate records: merged into the older one, references re-pointed.
  applyNewFacts(s, [{ entity: "The hooded rider", type: "npc", fact: "Rode past at dusk", location: "Gull's Landing", was: "" }], 3);
  applyNewFacts(s, [{ entity: "Corven", type: "npc", fact: "A toll collector", location: "", was: "" }], 4);
  applyNewFacts(s, [{ entity: "Corven", type: "npc", fact: "Was the hooded rider", location: "", was: "The hooded rider" }], 5);
  const corven = findEntity(s, "Corven");
  assert.equal(Object.values(s.ledger.entities).filter((e) => e.type === "npc").length, 2);
  assert.equal(corven.first_turn, 3);
  assert.equal(corven.facts.length, 3);
  assert.equal(corven.location_id, findEntity(s, "Gull's Landing").id);
  assert.equal(s.counters.merges, 1);

  // A place renamed: the scene follows it.
  applyNewFacts(s, [{ entity: "Harrow Toll", type: "location", fact: "Its real name", location: "", was: "The Rusted Ford" }], 6);
  assert.equal(s.ledger.entities[s.scene.location_id].name, "Harrow Toll");
  assert.ok(findEntity(s, "Rusted Ford", "location"));

  // An unknown earlier description still becomes an alias.
  applyNewFacts(s, [{ entity: "Tam", type: "npc", fact: "A drover", location: "", was: "the drover with the scar" }], 7);
  assert.equal(findEntity(s, "drover with the scar").name, "Tam");
});

test("option variety: recent repeats dropped while 3 remain, low variety counted", () => {
  const s = newGame();
  s.recent = [record(1, { options: [opt("Search the stable for tracks", "explore")] })];
  const r = varyOptions(s, [opt("Ask the woman about the bridge"), opt("Search the stable for tracks", "explore"), opt("Kick the door", "direct"), opt("Wait", "cautious")]);
  assert.equal(r.dropped, 1); // both the first and second repeat a recent option, but only one may go
  assert.equal(r.options.length, 3);
  assert.ok(!r.low);
  const r2 = varyOptions(s, [opt("Ask the woman about the bridge"), opt("Ask the woman about her satchel"), opt("Ask the drovers")]);
  assert.equal(r2.dropped, 0); // never below 3
  assert.ok(r2.low);
});

test("summary: due after a batch, one run at a time, adopted from its own key", async () => {
  const s = newGame();
  s.turn = 9;
  assert.equal(summaryDue(s), null);
  s.turn = 10;
  assert.deepEqual(summaryDue(s), { from: 1, to: 5 });
  s.recent = Array.from({ length: 10 }, (_, i) => record(1 + i));
  const job = summaryJob(s, summaryDue(s));
  assert.equal(job.records.length, 5);
  assert.equal(summaryDue(s), null); // in flight
  assert.ok(summaryDue(s, Date.now() + 130_000)); // a lost run is retried later
  assert.ok(summaryPrompt(job, job.records).includes("Turn 5. Player: Do thing 5"));

  const kv = new Map();
  const env = { GAME: { get: async (k, t) => (kv.has(k) ? (t === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => kv.set(k, v) } };
  kv.set(`sum:${s.id}`, JSON.stringify({ text: "Ash arrived at the ford.", through_turn: 5 }));
  await adoptSummary(env, s);
  assert.equal(s.summary.through_turn, 5);
  assert.equal(s.summary.text, "Ash arrived at the ford.");
  assert.equal(s.counters.summaries, 1);
  s.turn = 14;
  assert.equal(summaryDue(s), null);
  s.turn = 15;
  assert.deepEqual(summaryDue(s), { from: 6, to: 10 });
});

test("summary failure keeps the old summary and records the error", async () => {
  const kv = new Map();
  const env = { ANTHROPIC_API_KEY: "x", ANTHROPIC_BASE_URL: "http://127.0.0.1:9", GAME: { get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v) => kv.set(k, v) } };
  const job = { id: "g", from: 1, to: 5, text: "Old.", through: 0, records: [record(1)], language: "English", pc: "Ash", quest: "Q" };
  let spent = 0;
  await updateSummary(env, job, async (usd) => (spent += usd));
  const stored = JSON.parse(kv.get("sum:g"));
  assert.equal(stored.text, "Old.");
  assert.equal(stored.through_turn, 0);
  assert.ok(stored.error);
  assert.equal(spent, 0);
});

test("v2 saves migrate forward", () => {
  const s = newGame();
  s.v = 2;
  s.summary = { text: "", through_turn: 0 };
  s.counters = { ai_turns: 3, fallbacks: 0, retries: 0, dc: {}, dc_clamped: 0 };
  migrate(s);
  assert.equal(s.v, 6);
  assert.equal(s.summary.requested_through, 0);
  assert.equal(s.counters.ai_turns, 3);
  assert.deepEqual(s.counters.kinds, {});
});
